import type { Dream, FieldKey } from './contract';
import type { Deck } from './deck';
import { invalidateSamples } from './deck';

/**
 * The renderer. Once per frame it evaluates the active field into one small
 * canvas — one pixel per sample, cols*S by rows*S — and that single image
 * feeds both the on-screen preview and the hardware. Rendering small and
 * letting the browser's bilinear scaling do the enlargement is what makes a
 * 72-pixel key look like a window onto something continuous rather than a
 * blocky tile.
 */

/** Samples per key along each axis. 10 is well past the point of visible improvement at this size. */
const S = 10;

/** How long a new dream takes to cross-fade over the old one. */
const FADE_SECONDS = 0.9;

/** Speed of a press ripple across the panel, in keys per second. */
const RIPPLE_SPEED = 6.5;
const RIPPLE_LIFE = 2.2;

/** A frame slower than this means the field is pathological, whatever the probe said. */
const FRAME_BUDGET_MS = 250;

/**
 * Paces the render loop.
 *
 * requestAnimationFrame stops entirely in a hidden tab, which would freeze the
 * panel the moment you switch to another app — precisely when a Stream Deck
 * earns its place on the desk. So while the tab is hidden and a deck is
 * attached, the loop is driven by a worker's interval instead, which Chrome
 * does not throttle. With no deck attached a hidden tab simply parks: nobody
 * is looking at the preview, so nothing should burn CPU to draw it.
 */
const HIDDEN_FPS_MS = 33;

const TICKER_SOURCE = `let id = 0;
self.onmessage = (e) => {
  clearInterval(id);
  id = e.data > 0 ? setInterval(() => self.postMessage(0), e.data) : 0;
};`;

class Ticker {
  #worker: Worker;
  #waiters: (() => void)[] = [];
  #hidden = false;

  constructor() {
    this.#worker = new Worker(URL.createObjectURL(new Blob([TICKER_SOURCE], { type: 'text/javascript' })));
    this.#worker.onmessage = () => {
      const waiting = this.#waiters;
      this.#waiters = [];
      for (const resolve of waiting) resolve();
    };
  }

  set hidden(value: boolean) {
    if (value === this.#hidden) return;
    this.#hidden = value;
    this.#worker.postMessage(value ? HIDDEN_FPS_MS : 0);
    if (!value) {
      const waiting = this.#waiters;
      this.#waiters = [];
      for (const resolve of waiting) resolve();
    }
  }

  next(): Promise<void> {
    return this.#hidden
      ? new Promise<void>((resolve) => this.#waiters.push(resolve))
      : new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export interface Knobs {
  speed: number;
  hue: number;
  glow: number;
}

export interface EngineOptions {
  /** Container the preview key grid is built inside. */
  mount: HTMLElement;
  /** Called when a dream has to be abandoned mid-flight. */
  onFieldError: (dream: Dream, message: string) => void;
}

interface Ripple {
  col: number;
  row: number;
  born: number;
}

export class Engine {
  #mount: HTMLElement;
  #onFieldError: EngineOptions['onFieldError'];

  #cols = 5;
  #rows = 3;

  #low = document.createElement('canvas');
  #lowCtx: CanvasRenderingContext2D;
  #image!: ImageData;
  /** Persistent RGB used to low-pass the output; this is the motion blur that makes it silky. */
  #smooth!: Float32Array;
  #primed = false;

  #cells: { ctx: CanvasRenderingContext2D; sx: number; sy: number }[] = [];

  #current: Dream | null = null;
  #previous: Dream | null = null;
  #fade = 1;

  /** Dream time, scaled by the speed knob. What fields see as `t`. */
  #clock = 0;
  /** The outgoing dream's own time, so it plays on undisturbed while it fades out. */
  #prevClock = 0;
  /** Real seconds. Ripples use this so touch feels the same at any speed. */
  #wall = 0;

  #knobs: Knobs = { speed: 1, hue: 0, glow: 1 };
  #ripples: Ripple[] = [];
  #rnd = new Float32Array(0);
  #press = new Float32Array(0);

  #deck: Deck | null = null;
  #ticker = new Ticker();
  #running = false;
  #paused = false;

  #k: FieldKey = { col: 0, row: 0, i: 0, cols: 5, rows: 3, rnd: 0, beat: 0, press: 0 };

  constructor({ mount, onFieldError }: EngineOptions) {
    this.#mount = mount;
    this.#onFieldError = onFieldError;
    const ctx = this.#low.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.#lowCtx = ctx;
    this.setGrid(5, 3);
    document.addEventListener('visibilitychange', this.#retime);
  }

  // --- shape -------------------------------------------------------------

  setGrid(cols: number, rows: number): void {
    if (cols === this.#cols && rows === this.#rows && this.#cells.length) return;
    this.#cols = cols;
    this.#rows = rows;
    this.#low.width = cols * S;
    this.#low.height = rows * S;
    this.#image = this.#lowCtx.createImageData(this.#low.width, this.#low.height);
    this.#smooth = new Float32Array(this.#low.width * this.#low.height * 3);
    this.#primed = false;

    const keys = cols * rows;
    this.#rnd = new Float32Array(keys);
    this.#press = new Float32Array(keys);
    for (let i = 0; i < keys; i++) this.#rnd[i] = ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;

    this.#buildPreview();
  }

  #buildPreview(): void {
    this.#mount.style.setProperty('--cols', String(this.#cols));
    this.#mount.replaceChildren();
    this.#cells = [];
    for (let row = 0; row < this.#rows; row++) {
      for (let col = 0; col < this.#cols; col++) {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        canvas.className = 'key';
        canvas.dataset['index'] = String(row * this.#cols + col);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        this.#mount.appendChild(canvas);
        this.#cells.push({ ctx, sx: col * S, sy: row * S });
      }
    }
  }

  // --- state -------------------------------------------------------------

  get current(): Dream | null {
    return this.#current;
  }

  get grid(): { cols: number; rows: number } {
    return { cols: this.#cols, rows: this.#rows };
  }

  get paused(): boolean {
    return this.#paused;
  }

  set paused(v: boolean) {
    this.#paused = v;
  }

  /** Swaps in a dream. The old one keeps rendering underneath until the fade completes. */
  play(dream: Dream, { fade = true }: { fade?: boolean } = {}): void {
    if (dream === this.#current) return;
    this.#previous = fade ? this.#current : null;
    this.#current = dream;
    this.#fade = fade && this.#previous ? 0 : 1;
    this.#prevClock = this.#clock;
    this.#clock = 0;
  }

  setKnobs(k: Knobs): void {
    this.#knobs = k;
  }

  attach(deck: Deck): void {
    this.#deck = deck;
    this.setGrid(deck.info.cols, deck.info.rows);
    this.#retime();
  }

  detach(): void {
    this.#deck = null;
    this.#retime();
  }

  /** Background rendering is only worth doing when real hardware is watching. */
  #retime = (): void => {
    this.#ticker.hidden = document.hidden && this.#deck?.alive === true;
  };

  /** A real key was pressed. Send a ring outward from it. */
  ripple(col: number, row: number): void {
    this.#ripples.push({ col, row, born: this.#wall });
    if (this.#ripples.length > 24) this.#ripples.shift();
  }

  // --- the loop ----------------------------------------------------------

  start(): void {
    if (this.#running) return;
    this.#running = true;
    void this.#loop();
  }

  stop(): void {
    this.#running = false;
  }

  /**
   * Self-paced: the next frame is not requested until the current frame's HID
   * writes have actually landed, so the loop can never outrun the hardware.
   */
  async #loop(): Promise<void> {
    let last = performance.now();
    while (this.#running) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      this.#wall += dt;
      if (!this.#paused) {
        this.#clock += dt * this.#knobs.speed;
        this.#prevClock += dt * this.#knobs.speed;
      }
      if (this.#fade < 1) this.#fade = Math.min(1, this.#fade + dt / FADE_SECONDS);

      this.#expireRipples();
      this.#renderFrame(dt);

      if (this.#deck?.alive) {
        invalidateSamples();
        await this.#deck.paint(this.#low);
      }
      await this.#ticker.next();
    }
  }

  #expireRipples(): void {
    if (!this.#ripples.length) return;
    this.#ripples = this.#ripples.filter((r) => this.#wall - r.born < RIPPLE_LIFE);
  }

  /** Press energy per key: an expanding, decaying ring from each recent press. */
  #computePress(): void {
    this.#press.fill(0);
    if (!this.#ripples.length) return;
    for (const rip of this.#ripples) {
      const age = this.#wall - rip.born;
      const front = age * RIPPLE_SPEED;
      const decay = Math.exp(-age * 1.9);
      for (let row = 0; row < this.#rows; row++) {
        for (let col = 0; col < this.#cols; col++) {
          const d = Math.hypot(col - rip.col, row - rip.row);
          const edge = d - front;
          const w = Math.exp(-(edge * edge) / 0.55) * decay;
          const i = row * this.#cols + col;
          if (w > (this.#press[i] ?? 0)) this.#press[i] = w;
        }
      }
    }
  }

  #renderFrame(dt: number): void {
    const dream = this.#current;
    if (!dream) return;

    this.#computePress();

    const started = performance.now();
    try {
      this.#evaluate(dream, this.#previous, dt);
    } catch (err) {
      this.#abandon(dream, err instanceof Error ? err.message : String(err));
      return;
    }
    if (performance.now() - started > FRAME_BUDGET_MS) {
      this.#abandon(dream, 'the field is too slow to animate');
      return;
    }

    this.#lowCtx.putImageData(this.#image, 0, 0);
    // Skipping the preview only saves work when the loop is running for a deck;
    // with no deck a hidden tab has already parked, so the first frame should land.
    if (document.hidden && this.#deck) return;
    for (const cell of this.#cells) {
      cell.ctx.drawImage(this.#low, cell.sx, cell.sy, S, S, 0, 0, 96, 96);
    }
  }

  #evaluate(dream: Dream, prev: Dream | null, dt: number): void {
    const { width: W, height: H } = this.#low;
    const data = this.#image.data;
    const smooth = this.#smooth;
    const k = this.#k;
    const { hue: hueShift, glow } = this.#knobs;

    const t = this.#clock;
    const prevT = this.#prevClock;
    const mix = this.#fade;
    const blending = prev !== null && mix < 1;

    k.cols = this.#cols;
    k.rows = this.#rows;
    const beat = (t * (dream.bpm / 60)) % 1;

    // Strobing fields get heavier temporal smoothing. Everything gets a little,
    // because a low-resolution panel reads better with a hint of motion blur.
    const tau = dream.light.flicker > 20 ? 0.09 : 0.03;
    const alpha = this.#primed ? 1 - Math.exp(-dt / tau) : 1;

    for (let y = 0; y < H; y++) {
      const row = (y / S) | 0;
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const col = (x / S) | 0;
        const i = row * this.#cols + col;

        k.col = col;
        k.row = row;
        k.i = i;
        k.rnd = this.#rnd[i] ?? 0;
        k.beat = beat;
        k.press = this.#press[i] ?? 0;

        const u = (x + 0.5) / W;
        let [r, g, b] = shade(dream.fn(u, v, t, k, Math), hueShift, glow, k.press);

        if (blending) {
          k.beat = (prevT * (prev.bpm / 60)) % 1;
          const [pr, pg, pb] = shade(prev.fn(u, v, prevT, k, Math), hueShift, glow, k.press);
          r = pr + (r - pr) * mix;
          g = pg + (g - pg) * mix;
          b = pb + (b - pb) * mix;
        }

        const s = (y * W + x) * 3;
        const sr = (smooth[s] ?? 0) + (r - (smooth[s] ?? 0)) * alpha;
        const sg = (smooth[s + 1] ?? 0) + (g - (smooth[s + 1] ?? 0)) * alpha;
        const sb = (smooth[s + 2] ?? 0) + (b - (smooth[s + 2] ?? 0)) * alpha;
        smooth[s] = sr;
        smooth[s + 1] = sg;
        smooth[s + 2] = sb;

        const p = (y * W + x) * 4;
        data[p] = sr;
        data[p + 1] = sg;
        data[p + 2] = sb;
        data[p + 3] = 255;
      }
    }
    this.#primed = true;
  }

  /** A field that misbehaves at runtime is dropped, not tolerated. */
  #abandon(dream: Dream, message: string): void {
    this.#current = this.#previous;
    this.#previous = null;
    this.#fade = 1;
    this.#onFieldError(dream, message);
  }
}

/**
 * HSL from the field to RGB for the panel, applying the hue and glow knobs and
 * a small guaranteed response to touch — so that even a dream which ignores
 * k.press still answers when you press a key.
 */
function shade(hsl: readonly [number, number, number], hueShift: number, glow: number, press: number): [number, number, number] {
  let h = (hsl[0] + hueShift) % 360;
  if (h < 0) h += 360;
  const s = clamp(hsl[1] + press * 8, 0, 100) / 100;
  const l = clamp((hsl[2] + press * 12) * glow, 0, 100) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const xx = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = xx; }
  else if (h < 120) { r = xx; g = c; }
  else if (h < 180) { g = c; b = xx; }
  else if (h < 240) { g = xx; b = c; }
  else if (h < 300) { r = xx; b = c; }
  else { r = c; b = xx; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
