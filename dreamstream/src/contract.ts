/**
 * The Dream Contract — the only interface between imagination and light.
 *
 * A Dream is pure data plus one pure function body describing colour across a
 * grid of physical keys over time. Because that is all it is, a Dream can be
 * written by a language model, by a person editing a textarea, or by another
 * program, and the engine cannot tell which. Everything downstream depends on
 * this module; this module depends on nothing.
 */

export const CONTRACT_VERSION = '1.0';

/** Arguments handed to every field function, in order. */
export const FIELD_ARGS = ['u', 'v', 't', 'k', 'M'] as const;

/** Per-key state passed as `k`. Reused between calls — a field must not retain it. */
export interface FieldKey {
  /** Integer column of the key this sample belongs to. */
  col: number;
  /** Integer row of the key this sample belongs to. */
  row: number;
  /** Key index, row-major. */
  i: number;
  cols: number;
  rows: number;
  /** Stable 0..1 noise for this key. Same value every frame. */
  rnd: number;
  /** 0..1 sawtooth at the dream's bpm. */
  beat: number;
  /** 0..1 energy from a real, physical key press rippling outward. */
  press: number;
}

/** hue 0..360, saturation 0..100, lightness 0..100 */
export type Hsl = readonly [number, number, number];

export type FieldFn = (u: number, v: number, t: number, k: FieldKey, M: Math) => Hsl;

/** What a field's probe sweep revealed about its output. */
export interface LightStats {
  lo: number;
  hi: number;
  /** Largest lightness jump between consecutive frames. High means strobing. */
  flicker: number;
}

/** A dream as it travels over the wire and sits in storage. */
export interface DreamSpec {
  version: string;
  name: string;
  vibe: string;
  /** Three to five #rrggbb anchors. These re-theme the entire app. */
  palette: string[];
  bpm: number;
  /** The body of the field function. */
  field: string;
  /** What was typed to summon it. Empty for built-ins. */
  prompt: string;
}

/** A validated dream: proven to compile, terminate, and return finite colour. */
export interface Dream extends DreamSpec {
  fn: FieldFn;
  light: LightStats;
}

/**
 * Identifiers rebound to `undefined` in the closure wrapping a field body.
 * A field describes colour; it has no business reaching the network, the page
 * or storage. This is a barrier, not a sandbox — see CONTRACT.md.
 */
const SHADOWED = [
  'window', 'document', 'globalThis', 'self', 'top', 'parent', 'frames',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'Image',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches',
  'navigator', 'location', 'history', 'screen', 'console',
  'Function', 'importScripts', 'postMessage', 'require', 'process',
  'open', 'alert', 'prompt', 'confirm', 'setTimeout', 'setInterval', 'crypto',
] as const;

/**
 * Syntax with no place in a field and every place in an escape attempt.
 * `eval` and `arguments` are here rather than in SHADOWED because strict mode
 * forbids them as parameter names, so this is the only way to deny them.
 * `while`/`do` are included so that a terminating probe sweep is strong
 * evidence the field terminates for every input, not just the sampled ones.
 */
const FORBIDDEN = /\b(eval|arguments|constructor|__proto__|prototype|import|while|do|debugger|yield|async|await|new)\b/;

const MAX_FIELD_LENGTH = 4000;
const PROBE_TIMEOUT_MS = 900;

export const PALETTE_FALLBACK = ['#7C5CFF', '#FF5FA2', '#FFD166', '#4DE8C2', '#48C6FF'];

export class ContractError extends Error {
  override name = 'ContractError';
}

/** Human- and model-readable description of what a field receives. */
export const FIELD_DOC = `(u, v, t, k, M) => [h, s, l]

  u       0..1 across the panel, continuous and sub-key
  v       0..1 down the panel, continuous and sub-key
  t       seconds since the dream began (already speed-scaled)
  k.col   integer column of this key         k.cols   total columns
  k.row   integer row of this key            k.rows   total rows
  k.i     key index, row-major               k.rnd    stable 0..1 noise per key
  k.beat  0..1 sawtooth at the dream's bpm   k.press  0..1 energy from a real press
  M       Math

  returns [hue 0..360, saturation 0..100, lightness 0..100]`;

/** The schema Gemini must satisfy. Lives beside the validator so the two cannot drift. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: "Two or three evocative words. The dream's name." },
    vibe: { type: 'STRING', description: 'One short lowercase line describing how it feels.' },
    palette: {
      type: 'ARRAY',
      description: 'Three to five #rrggbb anchor colours drawn from the dream.',
      items: { type: 'STRING' },
    },
    bpm: { type: 'NUMBER', description: 'Tempo of the motion, 20 to 180.' },
    field: { type: 'STRING', description: 'The body of the field function. Must return [h, s, l].' },
  },
  required: ['name', 'vibe', 'palette', 'bpm', 'field'],
  propertyOrdering: ['name', 'vibe', 'palette', 'bpm', 'field'],
} as const;

// --- compilation -----------------------------------------------------------

/** Throws on anything the contract forbids. Cheap, synchronous, first line of defence. */
function lint(body: string): void {
  if (typeof body !== 'string' || !body.trim()) throw new ContractError('field is empty');
  if (body.length > MAX_FIELD_LENGTH) {
    throw new ContractError(`field is ${body.length} characters, the limit is ${MAX_FIELD_LENGTH}`);
  }
  const hit = FORBIDDEN.exec(body);
  if (hit) throw new ContractError(`field may not use "${hit[1]}"`);
  if (!/\breturn\b/.test(body)) throw new ContractError('field never returns');
}

/**
 * Turns a field body into a callable closed over a scope where every shadowed
 * identifier is `undefined`. The result sees Math and its own arguments.
 */
export function compile(body: string): FieldFn {
  lint(body);
  const factory = new Function(
    ...SHADOWED,
    `"use strict"; return function field(${FIELD_ARGS.join(', ')}) {\n${body}\n};`,
  ) as (...shadow: undefined[]) => FieldFn;
  return factory(...SHADOWED.map(() => undefined));
}

// --- probing ---------------------------------------------------------------
// A field runs thousands of times per frame on the main thread, so it is first
// swept in a worker that can be terminated. That is the only way to survive a
// body which never returns.

const PROBE_SOURCE = `
const SHADOWED = ${JSON.stringify(SHADOWED)};
const ARGS = ${JSON.stringify(FIELD_ARGS)};
self.onmessage = (e) => {
  const { body, cols, rows } = e.data;
  try {
    const factory = new Function(...SHADOWED, '"use strict"; return function(' + ARGS.join(',') + '){\\n' + body + '\\n};');
    const field = factory(...SHADOWED.map(() => undefined));
    const k = { col: 0, row: 0, i: 0, cols, rows, rnd: 0.5, beat: 0, press: 0 };
    const sample = (t) => {
      k.i = k.row * cols + k.col;
      k.rnd = ((k.i * 2654435761) % 997) / 997;
      k.beat = (t * 1.5) % 1;
      const out = field((k.col + 0.5) / cols, (k.row + 0.5) / rows, t, k, Math);
      if (!Array.isArray(out) || out.length !== 3) {
        throw new Error('field must return an array of three numbers, got ' + JSON.stringify(out));
      }
      for (const n of out) {
        if (typeof n !== 'number' || !isFinite(n)) throw new Error('field returned ' + n + ', which is not a finite number');
      }
      return out;
    };

    // Coverage: every key, a wide span of time, with and without a press.
    let lo = 100, hi = 0;
    for (let s = 0; s < 300; s++) {
      const t = s * 0.05;
      k.col = s % cols;
      k.row = ((s / cols) | 0) % rows;
      k.press = s % 19 === 0 ? 1 : 0;
      const l = sample(t)[2];
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }

    // Flicker: one fixed key stepped at real frame intervals, so the number
    // means "how much this key's brightness jumps between consecutive frames"
    // rather than how much two different keys differ.
    let flicker = 0, prev = null;
    k.col = cols >> 1;
    k.row = rows >> 1;
    k.press = 0;
    for (let f = 0; f < 180; f++) {
      const l = sample(f / 60)[2];
      if (prev !== null) flicker = Math.max(flicker, Math.abs(l - prev));
      prev = l;
    }

    self.postMessage({ ok: true, lo, hi, flicker });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};`;

/** Resolves with light statistics; rejects if the body throws or hangs. */
export function probe(body: string, cols = 5, rows = 3): Promise<LightStats> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([PROBE_SOURCE], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new ContractError('field never finished — it is looping forever'))),
      PROBE_TIMEOUT_MS,
    );
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { ok: boolean; error?: string } & LightStats;
      finish(() => (data.ok ? resolve({ lo: data.lo, hi: data.hi, flicker: data.flicker }) : reject(new ContractError(data.error ?? 'field failed'))));
    };
    worker.onerror = (e) => finish(() => reject(new ContractError(e.message || 'field failed to load')));
    worker.postMessage({ body, cols, rows });
  });
}

// --- validation ------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Normalises anything dream-shaped into a Dream that is safe to render, or
 * throws with a message specific enough to hand straight back to the model.
 */
export async function validate(raw: unknown, cols = 5, rows = 3): Promise<Dream> {
  if (!raw || typeof raw !== 'object') throw new ContractError('response was not a dream object');
  const r = raw as Partial<DreamSpec>;

  const palette = (Array.isArray(r.palette) ? r.palette : []).filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 5);
  const bpm = Number(r.bpm);
  const field = String(r.field ?? '');

  lint(field);
  const light = await probe(field, cols, rows);

  return {
    version: CONTRACT_VERSION,
    name: clean(r.name, 40) || 'Untitled Dream',
    vibe: clean(r.vibe, 90) || 'no words for it',
    palette: palette.length >= 3 ? palette : PALETTE_FALLBACK,
    bpm: Number.isFinite(bpm) ? Math.min(180, Math.max(20, bpm)) : 72,
    field,
    prompt: clean(r.prompt, 240),
    fn: compile(field),
    light,
  };
}

/** Strips the compiled function so a dream can be JSON round-tripped. */
export function serialise(d: Dream | DreamSpec): DreamSpec {
  const { version, name, vibe, palette, bpm, field, prompt } = d;
  return { version, name, vibe, palette, bpm, field, prompt };
}
