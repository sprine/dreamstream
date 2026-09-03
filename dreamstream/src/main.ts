import { validate, serialise, compile, type Dream } from './contract';
import { renderKeys, validateLayout, type Scene, type SceneSpec } from './layout';
import { IDLE, CONJURING, STARTERS, SEEDS } from './dreams';
import { conjure, listFlashModels } from './gemini';
import { Deck } from './deck';
import { Engine } from './engine';
import { store, DEFAULT_MODEL, type Knobs } from './store';
import { BLANK } from './icons';
import { openKeyEditor, closeKeyEditor, type KeyPatch } from './keyEditor';
import { LANDINGS, type LandingName } from './landing';
import { initHome, type HomeHandle } from './home';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const ui = {
  keys: $<HTMLDivElement>('keys'),
  shell: document.querySelector<HTMLDivElement>('.shell')!,
  name: $<HTMLHeadingElement>('dreamName'),
  vibe: $<HTMLParagraphElement>('dreamVibe'),
  meta: $<HTMLParagraphElement>('dreamMeta'),
  composer: $<HTMLFormElement>('composer'),
  prompt: $<HTMLInputElement>('prompt'),
  conjure: $<HTMLButtonElement>('conjureBtn'),
  remix: $<HTMLButtonElement>('remixBtn'),
  status: $<HTMLParagraphElement>('status'),
  seeds: $<HTMLDivElement>('seeds'),
  keep: $<HTMLButtonElement>('keepBtn'),
  play: $<HTMLButtonElement>('playBtn'),
  deckBtn: $<HTMLButtonElement>('deckBtn'),
  deckDot: $<HTMLSpanElement>('deckDot'),
  deckLabel: $<HTMLSpanElement>('deckLabel'),
  settingsDlg: $<HTMLDialogElement>('settingsDlg'),
  landingBtn: $<HTMLButtonElement>('landingBtn'),
  landingDlg: $<HTMLDialogElement>('landingDlg'),
  landingOptions: $<HTMLDivElement>('landingOptions'),
  landingNote: $<HTMLParagraphElement>('landingNote'),
  replayLanding: $<HTMLButtonElement>('replayLanding'),
  apiKey: $<HTMLInputElement>('apiKey'),
  model: $<HTMLInputElement>('model'),
  modelList: $<HTMLDataListElement>('modelList'),
  modelHint: $<HTMLElement>('modelHint'),
  sliders: {
    speed: $<HTMLInputElement>('speed'),
    hue: $<HTMLInputElement>('hue'),
    glow: $<HTMLInputElement>('glow'),
  },
  outputs: {
    speed: $<HTMLOutputElement>('speedOut'),
    hue: $<HTMLOutputElement>('hueOut'),
    glow: $<HTMLOutputElement>('glowOut'),
  },
};

// --- state -----------------------------------------------------------------

let deck: Deck | null = null;
let busy = false;
let cancelBusy: AbortController | null = null;
let shelf: SceneSpec[] = store.shelf.get();
/** The dots under the panel: built-ins, then kept dreams. Live from boot(). */
let home: HomeHandle | null = null;
let conjuring: Dream | null = null;
/** What is playing, including anything worn on the keys. */
let scene: Scene | null = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
/** Reduce Motion picks the default; a choice made here outranks it, since the Cauldron is the point. */
let landing: LandingName = store.landing.get() ?? (reducedMotion.matches ? 'crossfade' : 'cauldron');

const engine = new Engine({
  mount: ui.keys,
  onFieldError: (dream, message) => {
    say(`"${dream.name}" broke mid-flight: ${message}`, 'bad');
    // Dropping the field can leave nothing playing; the panel should never go dead.
    if (!engine.current) void load(IDLE).then((s) => show(s, { fade: false }));
  },
});

// --- presentation ----------------------------------------------------------

function say(text: string, kind: '' | 'bad' | 'busy' = ''): void {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

/** Re-themes the whole app around a scene. The transition lives in CSS. */
function wear({ dream, layout }: Scene): void {
  const root = document.documentElement.style;
  const p = dream.palette;
  for (let i = 0; i < 4; i++) root.setProperty(`--c${i + 1}`, p[i % p.length] ?? '#7C5CFF');
  ui.name.textContent = layout ? layout.name : dream.name;
  ui.vibe.textContent = layout ? `${layout.purpose} · over ${dream.name}` : dream.vibe;
  // Restart the entrance animation so a new name arrives rather than just appearing.
  ui.name.style.animation = 'none';
  void ui.name.offsetWidth;
  ui.name.style.animation = '';
}

/** The quiet readout under the name: grid, tempo, how the loop is doing. */
function paintMeta(): void {
  if (!scene) return;
  const { cols, rows } = engine.grid;
  const fps = Math.round(engine.fps);
  ui.meta.textContent = `${cols}×${rows} · ${scene.dream.bpm} bpm${fps ? ` · ${fps} fps` : ''}`;
}
setInterval(() => {
  paintMeta();
}, 1000);

/**
 * Serialisable form: a dream, plus a layout when it is wearing one. The layout
 * is copied, not referenced — a kept dream has to be a snapshot, or editing a
 * key would silently rewrite the entry it was kept as and there would be
 * nothing left to compare against.
 */
const flatten = (s: Scene): SceneSpec =>
  s.layout ? { ...serialise(s.dream), layout: structuredClone(s.layout) } : serialise(s.dream);

async function show(next: Scene, { fade = true }: { fade?: boolean } = {}): Promise<void> {
  closeKeyEditor();
  scene = next;
  // A fade is a scene *arriving*; a cut is a re-fit or an edit, and those do not land.
  engine.play(next.dream, { fade, landing: fade && cauldronOn() });
  engine.setOverlays(next.layout ? await renderKeys(next.layout) : []);
  wear(next);
  paintMeta();
  labelKeys(next);
  store.last.set(flatten(next));
  home?.sync();
  syncKeepButton();
  syncEditAvailability();
}

// --- key editing -------------------------------------------------------

/**
 * Editing lives on the right-click, which nothing about a key advertises —
 * so the status line says so once when a scene with keys arrives, and every
 * key repeats it on hover. It has to be on the key itself: a `title` on the
 * panel is shadowed by the per-key ones `labelKeys` sets, so it would show
 * everywhere except over the keys it is about.
 */
const EDIT_HINT = 'Right-click a key to edit its icon, label and glyph.';
const EDIT_HINT_SHORT = 'right-click to edit';

function syncEditAvailability(): void {
  if (scene?.layout) ui.shell.title = EDIT_HINT;
  else {
    ui.shell.removeAttribute('title');
    closeKeyEditor();
  }
}

/** Re-rasterises whatever is worn and persists the edit, same as any other scene change. */
async function refreshLayoutRender(): Promise<void> {
  const target = scene;
  if (!target?.layout) return;
  const overlays = await renderKeys(target.layout);
  if (scene !== target) return; // a different scene landed while overlays were rendering
  engine.setOverlays(overlays);
  labelKeys(target);
  store.last.set(flatten(target));
  // An edit can put a kept dream out of step with its dot, so Keep has to
  // become Save the moment the key changes, not on the next scene change.
  syncKeepButton();
}

function applyKeyPatch(index: number, patch: KeyPatch): void {
  const key = scene?.layout?.keys[index];
  if (!key) return;
  if (patch.icon !== undefined) key.icon = patch.icon;
  if ('label' in patch) { if (patch.label) key.label = patch.label; else delete key.label; }
  if ('badge' in patch) { if (patch.badge) key.badge = patch.badge; else delete key.badge; }
  if ('accent' in patch) { if (patch.accent) key.accent = patch.accent; else delete key.accent; }
  if ('note' in patch) { if (patch.note) key.note = patch.note; else delete key.note; }
  void refreshLayoutRender();
}

function clearKey(index: number): void {
  if (!scene?.layout?.keys[index]) return;
  scene.layout.keys[index] = { icon: BLANK };
  void refreshLayoutRender();
  closeKeyEditor();
}

/** Hovering a key should say what it is for, and that you can change it. */
function labelKeys({ layout }: Scene): void {
  [...ui.keys.children].forEach((el, i) => {
    const key = layout?.keys[i];
    const text = key && key.icon !== 'blank' ? [key.label, key.note].filter(Boolean).join(' — ') || key.icon : '';
    // Every key of an editable layout carries the hint, blank ones included —
    // a blank key is the one you are most likely to want to fill in.
    const title = layout ? [text, EDIT_HINT_SHORT].filter(Boolean).join(' · ') : text;
    if (title) el.setAttribute('title', title);
    else el.removeAttribute('title');
  });
}

// --- dream sources ---------------------------------------------------------

/**
 * Turns a stored or built-in spec into something playable, against the grid
 * that is actually connected. Built-ins go through exactly the same validation
 * as anything Gemini writes.
 */
async function load(spec: SceneSpec): Promise<Scene> {
  const { cols, rows } = engine.grid;
  const dream = await validate(spec, cols, rows);
  const layout = spec.layout ? validateLayout(spec.layout, cols * rows) : null;
  return { dream, layout };
}

async function loadOrIdle(spec: SceneSpec | null): Promise<Scene> {
  if (!spec) return load(IDLE);
  try {
    return await load(spec);
  } catch {
    return load(IDLE);
  }
}

// --- conjuring -------------------------------------------------------------

async function summon(idea: string, { remix = false } = {}): Promise<void> {
  if (busy) return;
  const text = idea.trim();
  if (!text) {
    ui.prompt.focus();
    return;
  }
  const apiKey = store.apiKey.get();
  if (!apiKey) {
    say('Add a Gemini API key in Settings first.', 'bad');
    openSettings();
    return;
  }

  const fallback = scene;
  busy = true;
  const controller = new AbortController();
  cancelBusy = controller;
  ui.conjure.textContent = 'Cancel';
  ui.remix.disabled = true;
  say(remix ? 'Reworking it' : 'Dreaming', 'busy');
  // The hardware itself becomes the progress indicator: the cauldron starts
  // stirring and holds there until the answer lands — or, without it, the
  // conjuring beam sweeps the panel.
  if (!(cauldronOn() && engine.brew()) && conjuring) engine.play(conjuring);

  try {
    const basis = remix ? fallback : undefined;
    const next = await conjure(text, {
      apiKey,
      model: store.model.get() || DEFAULT_MODEL,
      grid: engine.grid,
      basis: basis ?? undefined,
      onRepair: (attempt) => say(attempt === 1 ? 'Almost — adjusting' : 'One more pass', 'busy'),
      signal: controller.signal,
    });
    await show(next);
    say(next.layout ? `${next.layout.name} · ${next.layout.purpose} · ${EDIT_HINT}` : `${next.dream.name} · ${next.dream.vibe}`);
    ui.prompt.value = '';
  } catch (err) {
    if (fallback) await show(fallback, { fade: false });
    const message = err instanceof Error ? err.message : String(err);
    say(message, message === 'Cancelled.' ? '' : 'bad');
  } finally {
    busy = false;
    cancelBusy = null;
    ui.conjure.textContent = 'Conjure';
    ui.remix.disabled = false;
  }
}

// --- kept dreams -----------------------------------------------------------

/** Every dream the dots hold: the built-ins that shipped, then yours. */
const allDreams = (): SceneSpec[] => [...STARTERS, ...shelf];

const keptSpec = (): SceneSpec | undefined => {
  const field = scene?.dream.field;
  return field === undefined ? undefined : shelf.find((s) => s.field === field);
};

/**
 * Keep is a toggle — but only for a dream that is stored exactly as it is
 * playing. Edit the keys of one you already kept and the button becomes Save,
 * because pressing "forget" is not what anyone means by that gesture.
 */
function keepState(): 'builtin' | 'new' | 'kept' | 'edited' {
  if (!scene) return 'new';
  if (STARTERS.some((s) => s.field === scene!.dream.field)) return 'builtin';
  const existing = keptSpec();
  if (!existing) return 'new';
  return JSON.stringify(existing) === JSON.stringify(flatten(scene)) ? 'kept' : 'edited';
}

function syncKeepButton(): void {
  const state = keepState();
  // Left enabled when built-in: a disabled button gets no hover and no click,
  // so it could not explain itself. toggleKeep() says why instead.
  ui.keep.classList.toggle('on', state === 'kept' || state === 'edited');
  ui.keep.textContent = state === 'kept' ? 'Kept ✓' : state === 'edited' ? 'Save' : 'Keep';
  ui.keep.title = {
    builtin: 'Built in — it is already one of the dots above',
    new: 'Add this dream to the dots above',
    kept: 'Forget this dream and drop its dot',
    edited: 'Save your edits over the version on its dot',
  }[state];
}

/** Loads and plays a dream from the dots, exactly like pressing its dot. */
async function playSpec(spec: SceneSpec): Promise<void> {
  try {
    await show(await load(spec));
    say(spec.layout ? `${spec.layout.name} · ${spec.layout.purpose} · ${EDIT_HINT}` : `${spec.name} · ${spec.vibe}`);
  } catch (err) {
    say(err instanceof Error ? err.message : 'that dream will not load', 'bad');
  }
}

function toggleKeep(): void {
  if (!scene) return;
  const name = scene.layout?.name ?? scene.dream.name;
  const state = keepState();
  if (state === 'builtin') {
    say(`${name} is built in — it is already one of the dots above.`);
    return;
  }
  const existing = keptSpec();
  if (state === 'edited' && existing) {
    // Key edits live on `scene.layout` and were only ever written to `last`.
    // Without this they could never reach the dot they came from.
    shelf = shelf.map((s) => (s === existing ? flatten(scene!) : s));
    say(`Saved your edits to ${name}.`);
  } else if (existing) {
    shelf = shelf.filter((s) => s !== existing);
    say(`Forgot ${name}.`);
  } else {
    shelf = [...shelf, flatten(scene)];
    say(`Kept ${name} — it is the last dot under the panel.`);
  }
  shelf = store.shelf.set(shelf);
  home?.sync();
  syncKeepButton();
}

// --- device ----------------------------------------------------------------

function paintDeckButton(): void {
  const live = deck?.alive ?? false;
  ui.deckDot.className = `dot${live ? ' live' : ''}`;
  ui.deckBtn.classList.toggle('on', live);
  ui.deckLabel.textContent = live ? deck!.info.name : 'Connect deck';
  ui.deckBtn.title = live ? `${deck!.info.keys} keys · ${deck!.info.panelWrite ? 'panel writes' : 'per-key writes'} · click to release` : 'Connect a Stream Deck over WebHID';
}

const deckHandlers = {
  onPress: (col: number, row: number) => engine.ripple(col, row),
  onRotate: (index: number, delta: number) => {
    // Dial 0 rides the speed, any other dial rides the hue.
    const slider = index === 0 ? ui.sliders.speed : ui.sliders.hue;
    const step = index === 0 ? 6 : 5;
    slider.value = String(Number(slider.value) + delta * step);
    slider.dispatchEvent(new Event('input'));
  },
  onLost: (reason: string) => {
    deck = null;
    engine.detach();
    paintDeckButton();
    say(`Deck disconnected — ${reason}.`, 'bad');
  },
};

async function adopt(d: Deck | null, announce: boolean): Promise<void> {
  if (!d) return;
  deck = d;
  engine.attach(d);
  paintDeckButton();
  // The grid may have changed shape, so what is playing is re-fitted to it.
  await show(await loadOrIdle(scene ? flatten(scene) : null), { fade: false });
  if (announce) say(`${d.info.name} · ${d.info.cols}×${d.info.rows}. Press a key.`);
}

async function toggleDeck(): Promise<void> {
  if (deck?.alive) {
    await deck.close();
    deck = null;
    engine.detach();
    paintDeckButton();
    say('Deck released. The preview keeps dreaming.');
    return;
  }
  try {
    await adopt(await Deck.request(deckHandlers), true);
  } catch (err) {
    say(err instanceof Error ? err.message : 'could not open the deck', 'bad');
  }
}

// --- knobs -----------------------------------------------------------------

function readKnobs(): Knobs {
  return {
    speed: Number(ui.sliders.speed.value) / 100,
    hue: Number(ui.sliders.hue.value),
    glow: Number(ui.sliders.glow.value) / 100,
  };
}

function applyKnobs(persist = true): void {
  const k = readKnobs();
  engine.setKnobs(k);
  ui.outputs.speed.textContent = `${k.speed.toFixed(1)}×`;
  ui.outputs.hue.textContent = `${Math.round(k.hue)}°`;
  ui.outputs.glow.textContent = `${Math.round(k.glow * 100)}%`;
  if (persist) store.knobs.set(k);
}

// --- landing ---------------------------------------------------------------

/** Why the Cauldron cannot run here, or empty when it can. */
function cauldronBlocked(): string {
  return Engine.landingSupported ? '' : 'This browser has no WebGL2, so dreams crossfade instead.';
}

const cauldronOn = (): boolean => landing === 'cauldron' && !cauldronBlocked();

function paintLandingControls(): void {
  const blocked = cauldronBlocked();
  ui.landingBtn.textContent = LANDINGS[cauldronOn() ? 'cauldron' : 'crossfade'].title;
  ui.landingBtn.classList.toggle('on', cauldronOn());
  for (const el of ui.landingOptions.querySelectorAll<HTMLButtonElement>('.option')) {
    const name = el.dataset['landing'] as LandingName;
    el.setAttribute('aria-checked', String(name === landing));
    el.disabled = name === 'cauldron' && !!blocked;
  }
  ui.landingNote.className = 'err quiet';
  ui.landingNote.textContent =
    blocked || (reducedMotion.matches ? 'Reduce Motion is on in your system settings, so Crossfade is the default. Choosing the Cauldron here is respected.' : '');
  ui.replayLanding.disabled = !cauldronOn();
}

function setLanding(name: LandingName): void {
  landing = name;
  store.landing.set(name);
  paintLandingControls();
}

/** Lands what is playing again, on itself. The way to watch it without waiting for a dream. */
function replayLanding(): void {
  if (!cauldronOn()) return;
  if (engine.replay()) say(`${scene?.layout?.name ?? scene?.dream.name ?? 'It'} lands again.`);
}

// --- settings --------------------------------------------------------------

async function refreshModels(): Promise<void> {
  const key = ui.apiKey.value.trim() || store.apiKey.get();
  if (!key) {
    ui.modelHint.textContent = 'Add a key first, then this can list the models it reaches.';
    return;
  }
  ui.modelHint.textContent = 'Asking Google what your key can use…';
  try {
    const models = await listFlashModels(key);
    ui.modelList.replaceChildren(...models.map((m) => Object.assign(document.createElement('option'), { value: m })));
    ui.modelHint.textContent = models.length ? `${models.length} Flash models available. Click the field to choose.` : 'No Flash models found for this key.';
  } catch (err) {
    ui.modelHint.textContent = err instanceof Error ? err.message : 'could not list models';
  }
}

// --- wiring ----------------------------------------------------------------

ui.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  if (busy) {
    cancelBusy?.abort();
    return;
  }
  void summon(ui.prompt.value);
});
ui.remix.addEventListener('click', () => void summon(ui.prompt.value || 'take it somewhere new', { remix: true }));
ui.keep.addEventListener('click', toggleKeep);
ui.deckBtn.addEventListener('click', () => void toggleDeck());
function openSettings(): void {
  ui.apiKey.value = store.apiKey.get();
  ui.model.value = store.model.get();
  ui.settingsDlg.showModal();
}
$('settingsBtn').addEventListener('click', openSettings);
ui.landingBtn.addEventListener('click', () => {
  paintLandingControls();
  ui.landingDlg.showModal();
});
ui.landingOptions.addEventListener('click', (e) => {
  const option = (e.target as HTMLElement).closest<HTMLButtonElement>('.option');
  const name = option?.dataset['landing'];
  if (name === 'cauldron' || name === 'crossfade') setLanding(name);
});
ui.replayLanding.addEventListener('click', () => {
  ui.landingDlg.close();
  replayLanding();
});
reducedMotion.addEventListener('change', paintLandingControls);
$('refreshModels').addEventListener('click', () => void refreshModels());
$('forgetKey').addEventListener('click', () => {
  store.apiKey.clear();
  ui.apiKey.value = '';
  say('Key forgotten.');
});

ui.apiKey.addEventListener('change', () => store.apiKey.set(ui.apiKey.value));
ui.model.addEventListener('change', () => store.model.set(ui.model.value.trim() || DEFAULT_MODEL));

ui.play.addEventListener('click', () => {
  engine.paused = !engine.paused;
  ui.play.textContent = engine.paused ? '▶' : '❚❚';
  ui.play.setAttribute('aria-label', engine.paused ? 'Play' : 'Pause');
});

for (const slider of Object.values(ui.sliders)) slider.addEventListener('input', () => applyKnobs());

/** The key under an event, or null if the pointer was on the bezel. */
function keyAt(e: Event): { target: HTMLElement; index: number } | null {
  const target = e.target as HTMLElement;
  const index = Number(target.dataset['index']);
  return Number.isFinite(index) ? { target, index } : null;
}

// Pressing a preview key ripples it, exactly as pressing the real one does.
ui.keys.addEventListener('pointerdown', (e) => {
  // The right button edits, and on macOS so does ctrl+click — which arrives
  // as button 0. Neither may also ripple.
  if (e.button !== 0 || e.ctrlKey) return;
  const hit = keyAt(e);
  if (!hit) return;
  engine.ripple(hit.index % engine.grid.cols, Math.floor(hit.index / engine.grid.cols));
});

// Right-click edits that key — the same gesture that opens "properties"
// everywhere else, so the panel stays a panel and not a mode.
ui.keys.addEventListener('contextmenu', (e) => {
  const hit = keyAt(e);
  if (!hit) return;
  const key = scene?.layout?.keys[hit.index];
  if (!key) {
    // No editor to offer, so Chrome's own menu is left alone rather than
    // swallowed for nothing; the status line explains why there is none.
    say('These keys are pure animation. Ask for an app or a set of controls to get keys you can edit.');
    return;
  }
  e.preventDefault();
  openKeyEditor(hit.target, hit.index, key, {
    onChange: (patch) => applyKeyPatch(hit.index, patch),
    onClear: () => clearKey(hit.index),
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeKeyEditor();
});

// ⌘⏎ remixes from anywhere. Plain ⏎ conjures via the composer's own submit,
// so it needs no handler here — and nothing else is bound, which keeps Space,
// / and r doing what the browser says they do.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
  if (document.querySelector('dialog[open]')) return;
  e.preventDefault();
  void summon(ui.prompt.value || 'take it somewhere new', { remix: true });
});

function paintSeeds(): void {
  const picks = [...SEEDS].sort(() => Math.random() - 0.5).slice(0, 4);
  ui.seeds.replaceChildren(
    ...picks.map((seed) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost';
      b.textContent = seed;
      b.addEventListener('click', () => {
        ui.prompt.value = seed;
        void summon(seed);
      });
      return b;
    }),
  );
}

// --- boot ------------------------------------------------------------------

async function boot(): Promise<void> {
  const knobs = store.knobs.get();
  ui.sliders.speed.value = String(Math.round(knobs.speed * 100));
  ui.sliders.hue.value = String(knobs.hue);
  ui.sliders.glow.value = String(Math.round(knobs.glow * 100));
  applyKnobs(false);

  conjuring = (await load(CONJURING)).dream;
  await show(await loadOrIdle(store.last.get()), { fade: false });
  engine.start();

  paintSeeds();
  paintDeckButton();
  paintLandingControls();

  // A deck the user already granted reopens with no dialog and no ceremony.
  await adopt(await Deck.reopen(deckHandlers).catch(() => null), false);

  if (!Deck.supported) say('This browser has no WebHID — the preview works, the hardware will not.');
  else if (!deck) say(store.apiKey.get() ? 'Describe a dream, or press a key to ripple it.' : 'Add a Gemini API key in Settings to start dreaming.');
  else say(`${deck.info.name} reconnected. Press a key.`);

  home = initHome({
    dreams: allDreams,
    builtinCount: () => STARTERS.length,
    loadExample: (spec) => void playSpec(spec),
    openSettings,
    hasApiKey: () => !!store.apiKey.get(),
    playingField: () => scene?.dream.field,
  });
  // Adding a key and closing Settings should skip the rest of the pitch,
  // same as a returning visitor who already had one.
  ui.settingsDlg.addEventListener('close', () => home?.refresh());
}

void boot().catch((err) => say(err instanceof Error ? err.message : 'failed to start', 'bad'));

// Leaving the panel lit after the tab closes would be rude.
window.addEventListener('pagehide', () => void deck?.close());

export { compile }; // re-exported so the contract module is reachable from the console
