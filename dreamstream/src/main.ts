import { validate, serialise, compile, FIELD_DOC, CONTRACT_VERSION, type Dream } from './contract';
import { renderKeys, validateLayout, type Scene, type SceneSpec } from './layout';
import { IDLE, CONJURING, STARTERS, SEEDS } from './dreams';
import { conjure, listFlashModels } from './gemini';
import { Deck } from './deck';
import { Engine } from './engine';
import { store, DEFAULT_MODEL, type Knobs } from './store';
import { BLANK } from './icons';
import { openKeyEditor, closeKeyEditor, type KeyPatch } from './keyEditor';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

const ui = {
  keys: $<HTMLDivElement>('keys'),
  name: $<HTMLHeadingElement>('dreamName'),
  vibe: $<HTMLParagraphElement>('dreamVibe'),
  meta: $<HTMLParagraphElement>('dreamMeta'),
  composer: $<HTMLFormElement>('composer'),
  prompt: $<HTMLInputElement>('prompt'),
  conjure: $<HTMLButtonElement>('conjureBtn'),
  remix: $<HTMLButtonElement>('remixBtn'),
  status: $<HTMLParagraphElement>('status'),
  seeds: $<HTMLDivElement>('seeds'),
  shelf: $<HTMLElement>('shelf'),
  keep: $<HTMLButtonElement>('keepBtn'),
  play: $<HTMLButtonElement>('playBtn'),
  editBtn: $<HTMLButtonElement>('editBtn'),
  deckBtn: $<HTMLButtonElement>('deckBtn'),
  deckDot: $<HTMLSpanElement>('deckDot'),
  deckLabel: $<HTMLSpanElement>('deckLabel'),
  settingsDlg: $<HTMLDialogElement>('settingsDlg'),
  contractDlg: $<HTMLDialogElement>('contractDlg'),
  apiKey: $<HTMLInputElement>('apiKey'),
  model: $<HTMLInputElement>('model'),
  modelList: $<HTMLDataListElement>('modelList'),
  modelHint: $<HTMLElement>('modelHint'),
  contractDoc: $<HTMLPreElement>('contractDoc'),
  layoutLine: $<HTMLParagraphElement>('layoutLine'),
  fieldSrc: $<HTMLTextAreaElement>('fieldSrc'),
  fieldErr: $<HTMLParagraphElement>('fieldErr'),
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
let shelf: SceneSpec[] = store.shelf.get();
let conjuring: Dream | null = null;
/** What is playing, including anything worn on the keys. */
let scene: Scene | null = null;
/** Clicking a key opens its editor instead of rippling it. */
let editMode = false;

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

/** The quiet readout under the name: grid, tempo, and how the loop is doing. */
function paintMeta(): void {
  if (!scene) return;
  const { cols, rows } = engine.grid;
  const fps = Math.round(engine.fps);
  ui.meta.textContent = `${cols}×${rows} · ${scene.dream.bpm} bpm${fps ? ` · ${fps} fps` : ''}`;
}
setInterval(paintMeta, 1000);

/** Serialisable form: a dream, plus a layout when it is wearing one. */
const flatten = (s: Scene): SceneSpec =>
  s.layout ? { ...serialise(s.dream), layout: s.layout } : serialise(s.dream);

async function show(next: Scene, opts: { fade?: boolean } = {}): Promise<void> {
  closeKeyEditor();
  scene = next;
  engine.play(next.dream, opts);
  engine.setOverlays(next.layout ? await renderKeys(next.layout) : []);
  wear(next);
  paintMeta();
  labelKeys(next);
  store.last.set(flatten(next));
  paintShelf();
  syncEditAvailability();
}

// --- key editing -------------------------------------------------------

function syncEditAvailability(): void {
  const has = !!scene?.layout;
  ui.editBtn.disabled = !has;
  ui.editBtn.title = has
    ? 'Click a key to edit its icon, label and glyph'
    : 'Ask for an app or a set of controls to get keys you can edit';
  if (!has && editMode) setEditMode(false);
}

function setEditMode(on: boolean): void {
  editMode = on;
  ui.editBtn.classList.toggle('on', on);
  ui.keys.classList.toggle('editing', on);
  if (!on) closeKeyEditor();
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

/** Hovering a key should say what it is for; the glyph alone cannot. */
function labelKeys({ layout }: Scene): void {
  [...ui.keys.children].forEach((el, i) => {
    const key = layout?.keys[i];
    const text = key && key.icon !== 'blank' ? [key.label, key.note].filter(Boolean).join(' — ') || key.icon : '';
    if (text) el.setAttribute('title', text);
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
    ui.settingsDlg.showModal();
    return;
  }

  const fallback = scene;
  busy = true;
  ui.conjure.disabled = true;
  ui.remix.disabled = true;
  say(remix ? 'Reworking it' : 'Dreaming', 'busy');
  if (conjuring) engine.play(conjuring); // the hardware itself becomes the progress indicator

  try {
    const basis = remix ? fallback : undefined;
    const next = await conjure(text, {
      apiKey,
      model: store.model.get() || DEFAULT_MODEL,
      grid: engine.grid,
      basis: basis ?? undefined,
      onRepair: (attempt) => say(attempt === 1 ? 'Almost — adjusting' : 'One more pass', 'busy'),
    });
    await show(next);
    say(next.layout ? `${next.layout.name} · ${next.layout.purpose}` : `${next.dream.name} · ${next.dream.vibe}`);
    ui.prompt.value = '';
  } catch (err) {
    if (fallback) await show(fallback, { fade: false });
    say(err instanceof Error ? err.message : String(err), 'bad');
  } finally {
    busy = false;
    ui.conjure.disabled = false;
    ui.remix.disabled = false;
  }
}

// --- shelf -----------------------------------------------------------------

function paintShelf(): void {
  const entries: { spec: SceneSpec; builtin: boolean }[] = [
    ...STARTERS.map((spec) => ({ spec, builtin: true })),
    ...shelf.map((spec) => ({ spec, builtin: false })),
  ];
  const playing = scene?.dream.field;

  ui.shelf.replaceChildren(
    ...entries.map(({ spec, builtin }) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `card${spec.field === playing ? ' on' : ''}`;
      card.title = spec.layout ? `${spec.layout.name} — ${spec.layout.purpose}` : spec.vibe;

      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      for (const c of spec.palette.slice(0, 4)) {
        const i = document.createElement('i');
        i.style.background = c;
        swatch.append(i);
      }
      card.append(swatch, document.createTextNode(spec.layout ? spec.layout.name : spec.name));
      if (spec.layout) {
        const tag = document.createElement('i');
        tag.className = 'tag';
        tag.textContent = 'keys';
        card.append(tag);
      }

      if (!builtin) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'x';
        x.textContent = '×';
        x.title = 'Forget this dream';
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          shelf = shelf.filter((s) => s !== spec);
          store.shelf.set(shelf);
          paintShelf();
        });
        card.append(x);
      }

      card.addEventListener('click', async () => {
        try {
          await show(await load(spec));
          say(spec.layout ? `${spec.layout.name} · ${spec.layout.purpose}` : `${spec.name} · ${spec.vibe}`);
        } catch (err) {
          say(err instanceof Error ? err.message : 'that dream will not load', 'bad');
        }
      });
      return card;
    }),
  );
}

function keep(): void {
  if (!scene) return;
  const spec = flatten(scene);
  const name = scene.layout?.name ?? scene.dream.name;
  if (shelf.some((s) => s.field === spec.field) || STARTERS.some((s) => s.field === spec.field)) {
    say(`${name} is already on the shelf.`);
    return;
  }
  shelf = [spec, ...shelf];
  store.shelf.set(shelf);
  paintShelf();
  say(`Kept ${name}.`);
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

// --- contract panel --------------------------------------------------------

function openContract(): void {
  ui.contractDoc.textContent = `Dream v${CONTRACT_VERSION}\n\n${FIELD_DOC}`;
  ui.fieldSrc.value = scene?.dream.field ?? '';
  ui.fieldErr.textContent = '';
  const layout = scene?.layout;
  ui.layoutLine.textContent = layout
    ? `Wearing "${layout.name}" — ${layout.keys.filter((k) => k.icon !== 'blank').length} of ${layout.keys.length} keys carry a glyph. Copy JSON to see them.`
    : 'No layout. Ask for an app or a set of controls and the keys get icons.';
  ui.contractDlg.showModal();
}

async function applyField(): Promise<void> {
  if (!scene) return;
  ui.fieldErr.textContent = '';
  try {
    const dream = await validate(
      { ...serialise(scene.dream), field: ui.fieldSrc.value, prompt: 'hand-written' },
      engine.grid.cols,
      engine.grid.rows,
    );
    await show({ dream, layout: scene.layout }, { fade: false });
    say(`Applied your edit to ${dream.name}.`);
    ui.contractDlg.close();
  } catch (err) {
    ui.fieldErr.textContent = err instanceof Error ? err.message : String(err);
  }
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
  void summon(ui.prompt.value);
});
ui.remix.addEventListener('click', () => void summon(ui.prompt.value || 'take it somewhere new', { remix: true }));
ui.keep.addEventListener('click', keep);
ui.deckBtn.addEventListener('click', () => void toggleDeck());
$('settingsBtn').addEventListener('click', () => {
  ui.apiKey.value = store.apiKey.get();
  ui.model.value = store.model.get();
  ui.settingsDlg.showModal();
});
$('contractBtn').addEventListener('click', openContract);
ui.editBtn.addEventListener('click', () => setEditMode(!editMode));
$('applyField').addEventListener('click', () => void applyField());
$('copyDream').addEventListener('click', () => {
  if (!scene) return;
  void navigator.clipboard.writeText(JSON.stringify(flatten(scene), null, 2));
  say(`Copied ${scene.layout?.name ?? scene.dream.name} as JSON.`);
});
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

// Clicking a preview key ripples exactly as pressing the real one does —
// unless edit mode is on, in which case it opens that key's editor instead.
ui.keys.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  const index = Number(target.dataset['index']);
  if (!Number.isFinite(index)) return;
  const key = editMode ? scene?.layout?.keys[index] : undefined;
  if (key) {
    openKeyEditor(target, index, key, {
      onChange: (patch) => applyKeyPatch(index, patch),
      onClear: () => clearKey(index),
    });
    return;
  }
  engine.ripple(index % engine.grid.cols, Math.floor(index / engine.grid.cols));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editMode) setEditMode(false);
});

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key === '/' && !typing) {
    e.preventDefault();
    ui.prompt.focus();
  } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    void summon(ui.prompt.value || 'take it somewhere new', { remix: true });
  } else if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    keep();
  } else if (e.code === 'Space' && !typing) {
    e.preventDefault();
    ui.play.click();
  }
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
  paintShelf();
  paintDeckButton();

  // A deck the user already granted reopens with no dialog and no ceremony.
  await adopt(await Deck.reopen(deckHandlers).catch(() => null), false);

  if (!Deck.supported) say('This browser has no WebHID — the preview works, the hardware will not.');
  else if (!deck) say(store.apiKey.get() ? 'Describe a dream, or press a key to ripple it.' : 'Add a Gemini API key in Settings to start dreaming.');
  else say(`${deck.info.name} reconnected. Press a key.`);
}

void boot().catch((err) => say(err instanceof Error ? err.message : 'failed to start', 'bad'));

// Leaving the panel lit after the tab closes would be rude.
window.addEventListener('pagehide', () => void deck?.close());

export { compile }; // re-exported so the contract module is reachable from the console
