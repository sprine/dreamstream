import type { DreamSpec } from './contract';
import type { LandingName } from './landing';

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
  /** Dreams the user chose to keep, oldest first — the order of the dots. */
  shelf: {
    get: () => {
      const v = read<unknown[]>('shelf', []);
      // A corrupt or hand-edited array can still hold a null/non-object
      // element; every reader downstream assumes a DreamSpec-shaped object.
      return Array.isArray(v) ? (v.filter((s) => !!s && typeof s === 'object') as DreamSpec[]) : [];
    },
    /**
     * Capped at the tail: the dots run oldest-first, so an overflow has to
     * evict the oldest, not silently drop the one just kept. Returns what
     * was actually stored, so the caller's copy cannot drift past the cap.
     */
    set: (v: DreamSpec[]): DreamSpec[] => {
      const capped = v.slice(-60);
      write('shelf', capped);
      return capped;
    },
  },
  /** The dream that was on screen when the tab closed. */
  last: {
    get: () => read<DreamSpec | null>('last', null),
    set: (v: DreamSpec | null) => write('last', v),
  },
  /** How a new dream arrives on the panel. Null until chosen, which means the Cauldron. */
  landing: {
    get: (): LandingName | null => {
      const v = read<unknown>('landing', null);
      return v === 'cauldron' || v === 'crossfade' ? v : null; // anything else falls back to the motion-preference default
    },
    set: (v: LandingName) => write('landing', v),
  },
};
