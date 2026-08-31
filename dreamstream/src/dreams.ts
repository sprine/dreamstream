import type { DreamSpec } from './contract';
import type { KeySpec, SceneSpec } from './layout';

/**
 * Dreams that ship with the app. They go through the same validator as
 * anything Gemini writes — if a built-in ever broke the contract, the app
 * would say so at startup rather than quietly rendering nothing.
 */
const spec = (d: Omit<DreamSpec, 'version' | 'prompt'>): DreamSpec => ({ ...d, version: '1.0', prompt: '' });

/** Always running. The panel is never dark and never dead. */
export const IDLE: DreamSpec = spec({
  name: 'Aurora Drift',
  vibe: 'slow violet curtains, breathing',
  palette: ['#7C5CFF', '#48C6FF', '#FF5FA2', '#1B1633'],
  bpm: 42,
  field: `const band = M.sin(u * 2.4 + t * 0.35) * 0.35 + M.sin(v * 3.1 - t * 0.22) * 0.3;
const curtain = M.exp(-M.pow((v - 0.5 + band * 0.55) * 2.6, 2));
const shimmer = 0.5 + 0.5 * M.sin(t * 0.7 + k.rnd * 6.283);
return [250 + band * 55 + u * 28, 74, 5 + curtain * 34 * (0.72 + shimmer * 0.28) + k.press * 34];`,
});

/** Shown on the hardware while Gemini is thinking. The deck does the waiting. */
export const CONJURING: DreamSpec = spec({
  name: 'Conjuring',
  vibe: 'something is arriving',
  palette: ['#7C5CFF', '#FFD166', '#FF5FA2'],
  bpm: 108,
  field: `const sweep = (t * 0.62) % 1;
const d = (u * 0.62 + v * 0.38) - sweep;
const beam = M.exp(-d * d * 34);
const pulse = 0.5 + 0.5 * M.sin(t * 3.6 + k.rnd * 6.283);
return [284 - beam * 96, 88, 4 + beam * 54 + pulse * 6];`,
});

/** Terse helper so the built-in layout reads as a grid rather than a wall of JSON. */
const k = (icon: string, label?: string, note?: string, accent?: string, badge?: string): KeySpec => {
  const key: KeySpec = { icon };
  if (label) key.label = label;
  if (note) key.note = note;
  if (accent) key.accent = accent;
  if (badge) key.badge = badge;
  return key;
};

/**
 * Ships with a layout so the icon side of the app is visible before anyone
 * has pasted an API key. Its field is deliberately dim: glyphs come first
 * once a layout is worn.
 */
export const PRESENTER: SceneSpec = {
  ...spec({
    name: 'Lectern',
    vibe: 'a dark room, a lit screen',
    palette: ['#4DE8C2', '#2B3A67', '#101830', '#FF6B6B'],
    bpm: 30,
    field: `const glow = M.exp(-M.pow((v - 0.32) * 2.2, 2)) * (0.5 + 0.5 * M.sin(t * 0.22 + u * 1.6));
const floor = M.exp(-M.pow((v - 1.05) * 2.8, 2)) * 0.5;
return [196 + glow * 20, 46, 4 + glow * 11 + floor * 7 + k.press * 30];`,
  }),
  layout: {
    version: '1.0',
    name: 'Presentation Remote',
    purpose: 'run a talk without looking down',
    keys: [
      k('blank'), k('chevron-left', 'Prev', 'Previous slide'), k('presentation', '', 'Start presenting', '#4DE8C2', 'play'), k('chevron-right', 'Next', 'Next slide'), k('blank'),
      k('timer', 'Timer', 'Start the talk timer'), k('file-text', 'Notes', 'Speaker notes'), k('mouse-pointer-2', 'Laser', 'Laser pointer'), k('square', 'Blank', 'Blank the screen'), k('maximize', 'Full', 'Full screen'),
      k('blank'), k('volume-2', '', 'Volume'), k('mic', '', 'Microphone'), k('blank'), k('x', 'Exit', 'Leave the presentation', '#FF6B6B'),
    ],
  },
};

export const STARTERS: SceneSpec[] = [
  PRESENTER,
  IDLE,
  spec({
    name: 'Ember Tide',
    vibe: 'coals turning over in the dark',
    palette: ['#FF6B35', '#FFD166', '#C1121F', '#2B0F0A'],
    bpm: 58,
    field: `const heat = M.sin(u * 3.2 - t * 0.8) * 0.5 + M.sin(v * 2.1 + t * 0.55) * 0.5;
const core = M.pow(M.max(0, heat), 1.6);
const spark = M.pow(M.max(0, M.sin(t * 2.1 + k.rnd * 6.283)), 14) * k.rnd;
return [15 + core * 36, 92, 7 + core * 40 + spark * 28 + k.press * 30];`,
  }),
  spec({
    name: 'Signal Rain',
    vibe: 'green weather falling down the columns',
    palette: ['#4DE8C2', '#48C6FF', '#0B1F1B'],
    bpm: 96,
    field: `const lane = k.rnd;
const head = ((t * (0.55 + lane * 1.15) + lane * 3.1) % 1.6) * 1.15;
const tail = head - v;
const trail = tail >= 0 ? M.exp(-tail * 7.5) : 0;
const hum = 0.5 + 0.5 * M.sin(t * 0.4 + u * 3.2);
return [166 + hum * 26, 68 + trail * 26, 4 + trail * 54 + k.press * 32];`,
  }),
  spec({
    name: 'Koi Pond',
    vibe: 'orange shapes turning under still water',
    palette: ['#FF8A3D', '#FFD166', '#2A6F6B', '#0C2523'],
    bpm: 34,
    field: `const koi = (px, py, sp, ph) => {
  const cx = 0.5 + 0.34 * M.sin(t * sp + ph);
  const cy = 0.5 + 0.28 * M.sin(t * sp * 0.73 + ph * 1.7);
  return M.exp(-(M.pow(px - cx, 2) + M.pow(py - cy, 2)) * 26);
};
const fish = M.max(koi(u, v, 0.42, 0), koi(u, v, 0.31, 2.4));
const ripple = 0.5 + 0.5 * M.sin((u * 5 + v * 4) - t * 0.5);
return [fish > 0.08 ? 26 : 178, 74, 6 + ripple * 9 + fish * 46 + k.press * 30];`,
  }),
];

/** Prompt suggestions. Shuffled on every load so the shelf never feels static. */
export const SEEDS = [
  'a presentation remote',
  'a deck for reviewing pull requests',
  'controls for a live stream',
  'a kitchen timer and shopping list',
  'a DJ rig',
  'a lava lamp in a submarine',
  'morse code from a friendly ship',
  'a slow thunderstorm over a city at 3am',
  'bioluminescent plankton in a tide pool',
  'the inside of a kaleidoscope',
  'a calm heartbeat',
  'sunrise on a planet with two suns',
  'static from a forgotten radio station',
  'fireflies in tall grass',
  'a dragon exhaling, slowly',
  'confetti cannon, forever',
  'northern lights over a frozen lake',
  'a jellyfish thinking about something',
  'the deep sea, very deep',
  'a candle in a draughty room',
  'traffic seen from a plane at night',
];
