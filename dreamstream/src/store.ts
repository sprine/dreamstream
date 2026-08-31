import type { DreamSpec } from './contract';

/**
 * Everything that survives a reload, and nothing else. All of it lives in
 * this browser's localStorage on this origin — the API key never leaves the
 * machine except in requests to Google's own endpoint.
 */

const NS = 'dreamstream.v1';
const key = (name: string) => `${NS}.${name}`;

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // corrupt or unavailable storage is not worth crashing over
  }
}

function write(name: string, value: unknown): void {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* private mode, quota, disabled storage — the app still works, it just forgets */
  }
}

export interface Knobs {
  speed: number;
  hue: number;
  glow: number;
}

export const DEFAULT_KNOBS: Knobs = { speed: 1, hue: 0, glow: 1 };
export const DEFAULT_MODEL = 'gemini-2.5-flash';

export const store = {
  apiKey: {
    get: () => read<string>('apiKey', ''),
    set: (v: string) => write('apiKey', v.trim()),
    clear: () => localStorage.removeItem(key('apiKey')),
  },
  model: {
    get: () => read<string>('model', DEFAULT_MODEL),
    set: (v: string) => write('model', v),
  },
  knobs: {
    get: () => ({ ...DEFAULT_KNOBS, ...read<Partial<Knobs>>('knobs', {}) }),
    set: (v: Knobs) => write('knobs', v),
  },
  /** Dreams the user chose to keep, newest first. */
  shelf: {
    get: () => read<DreamSpec[]>('shelf', []),
    set: (v: DreamSpec[]) => write('shelf', v.slice(0, 60)),
  },
  /** The dream that was on screen when the tab closed. */
  last: {
    get: () => read<DreamSpec | null>('last', null),
    set: (v: DreamSpec | null) => write('last', v),
  },
};
