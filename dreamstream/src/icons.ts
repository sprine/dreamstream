import data from './icons.json';

/**
 * The icon vocabulary.
 *
 * A model asked to invent SVG path data produces shapes nobody recognises, so
 * it is never asked to. It picks from this closed, curated set of Lucide
 * icons — every name it can choose is guaranteed to exist and guaranteed to
 * render. `scripts/build-icons.mjs` regenerates icons.json from lucide-static
 * and is the only place the list is defined.
 */

const GEOMETRY = data.geometry as Record<string, string>;

/** Grouped names, exactly as offered to the model. */
export const ICON_GROUPS = data.groups as Record<string, string[]>;

/** The reserved name for a key that shows only the animation. */
export const BLANK = 'blank';

export const ICON_NAMES: string[] = Object.keys(GEOMETRY);
const NAME_SET = new Set(ICON_NAMES);

/**
 * Words a model reaches for that are not Lucide names. Cheaper and more
 * predictable than making it guess twice.
 */
const SYNONYMS: Record<string, string> = {
  next: 'chevron-right', previous: 'chevron-left', prev: 'chevron-left',
  forward: 'chevron-right', back: 'chevron-left', backward: 'chevron-left',
  advance: 'chevron-right', 'next-slide': 'chevron-right', 'prev-slide': 'chevron-left',
  stop: 'square', record: 'circle-dot', rec: 'circle-dot',
  none: BLANK, empty: BLANK, blank: BLANK, black: BLANK, nothing: BLANK, spacer: BLANK,
  slide: 'presentation', slides: 'presentation', deck: 'presentation',
  laser: 'mouse-pointer-2', 'laser-pointer': 'mouse-pointer-2', cursor: 'mouse-pointer-2',
  notes: 'file-text', 'speaker-notes': 'file-text', script: 'file-text',
  fullscreen: 'maximize', 'exit-fullscreen': 'minimize', escape: 'minimize',
  mute: 'volume-off', unmute: 'volume-2', sound: 'volume-2', audio: 'volume-2',
  delete: 'trash-2', remove: 'trash-2', bin: 'trash-2',
  gear: 'settings', preferences: 'settings', config: 'settings',
  close: 'x', cancel: 'x', confirm: 'check', ok: 'check', done: 'check',
  add: 'plus', new: 'plus', more: 'ellipsis',
  screen: 'monitor', display: 'monitor', present: 'presentation',
  chat: 'message-square', comment: 'message-square', question: 'circle-help',
  warning: 'triangle-alert', error: 'circle-alert', alert: 'triangle-alert',
  refresh: 'refresh-cw', reload: 'refresh-cw', sync: 'refresh-cw',
  build: 'hammer', run: 'play', debug: 'bug', commit: 'git-commit-horizontal',
  light: 'sun', dark: 'moon', brightness: 'sun', timer: 'timer', stopwatch: 'timer',
};

const normalise = (raw: string) =>
  raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length] ?? 99;
}

/**
 * Maps whatever the model wrote onto a real icon, or null if nothing is close.
 * Exact name, then synonym, then a singular/plural nudge, then nearest spelling.
 */
export function resolveIcon(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = normalise(raw);
  if (!name) return null;
  if (name === BLANK) return BLANK;
  if (NAME_SET.has(name)) return name;
  if (SYNONYMS[name]) return SYNONYMS[name];

  for (const variant of [name.replace(/s$/, ''), `${name}s`, name.replace(/-icon$/, '')]) {
    if (NAME_SET.has(variant)) return variant;
    if (SYNONYMS[variant]) return SYNONYMS[variant];
  }

  let best: string | null = null;
  let bestScore = 3; // beyond two edits the guess is worse than admitting failure
  for (const candidate of ICON_NAMES) {
    const d = distance(name, candidate);
    if (d < bestScore) {
      bestScore = d;
      best = candidate;
    }
  }
  return best;
}

// --- drawing ---------------------------------------------------------------

/**
 * Icons are rendered by handing the original Lucide markup to the browser's
 * own SVG rasteriser, so strokes, joins and caps are exactly as designed
 * rather than approximated by hand-rolled canvas geometry.
 */
const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement | null>>();

export const RENDER_SIZE = 144;

function svgFor(name: string, colour: string, size: number): string {
  const geometry = GEOMETRY[name] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" color="${colour}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${geometry}</svg>`;
}

/** Resolves to a rasterised icon, or null if it could not be drawn. */
export function loadIcon(name: string, colour: string, size = RENDER_SIZE): Promise<HTMLImageElement | null> {
  if (name === BLANK || !GEOMETRY[name]) return Promise.resolve(null);
  const key = `${name}|${colour}|${size}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const job = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image(size, size);
    img.onload = () => {
      cache.set(key, img);
      pending.delete(key);
      resolve(img);
    };
    img.onerror = () => {
      pending.delete(key);
      resolve(null);
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(name, colour, size))}`;
  });
  pending.set(key, job);
  return job;
}
