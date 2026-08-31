import { requestStreamDecks, getStreamDecks } from '@elgato-stream-deck/webhid';
import type {
  StreamDeckWeb,
  StreamDeckButtonControlDefinition,
  StreamDeckEncoderControlDefinition,
  Dimension,
} from '@elgato-stream-deck/webhid';

/**
 * The physical panel, reduced to one verb: paint(lowResCanvas).
 *
 * The engine renders a single small image for the whole panel — one pixel per
 * field sample — and hands it here. This module owns every detail of how that
 * becomes light: whether the model can take one panel-wide image or needs
 * fifteen separate key writes, what resolution each key wants, and which keys
 * are full screens versus single RGB lamps.
 */

export interface DeckInfo {
  name: string;
  cols: number;
  rows: number;
  keys: number;
  /** True when the device accepts one image for the entire panel. */
  panelWrite: boolean;
}

export interface DeckHandlers {
  onPress?: (col: number, row: number) => void;
  onRotate?: (index: number, delta: number) => void;
  onLost?: (reason: string) => void;
}

type LcdButton = StreamDeckButtonControlDefinition & { feedbackType: 'lcd'; pixelSize: Dimension };

const isButton = (c: { type: string }): c is StreamDeckButtonControlDefinition => c.type === 'button';
const isEncoder = (c: { type: string }): c is StreamDeckEncoderControlDefinition => c.type === 'encoder';
const isLcdButton = (c: StreamDeckButtonControlDefinition): c is LcdButton => c.feedbackType === 'lcd';

/** A scratch canvas per distinct size. Allocating these per frame would thrash. */
const scratch = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();
function canvasOf(w: number, h: number) {
  const cacheKey = `${w}x${h}`;
  let entry = scratch.get(cacheKey);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    entry = { canvas, ctx };
    scratch.set(cacheKey, entry);
  }
  return entry;
}

export class Deck {
  readonly info: DeckInfo;

  #sd: StreamDeckWeb;
  #buttons: StreamDeckButtonControlDefinition[];
  #encoders: StreamDeckEncoderControlDefinition[];
  #panel: Dimension | null;
  #alive = true;
  #frame = 0;

  private constructor(sd: StreamDeckWeb, handlers: DeckHandlers) {
    this.#sd = sd;
    this.#buttons = sd.CONTROLS.filter(isButton);
    this.#encoders = sd.CONTROLS.filter(isEncoder);

    // Encoders sit in their own row beneath the keys; the key grid is only
    // as tall as the buttons themselves.
    const cols = Math.max(...this.#buttons.map((b) => b.column)) + 1;
    const rows = Math.max(...this.#buttons.map((b) => b.row)) + 1;

    this.#panel = safely(() => sd.calculateFillPanelDimensions({ withPadding: true })) ?? null;

    this.info = { name: sd.PRODUCT_NAME, cols, rows, keys: this.#buttons.length, panelWrite: this.#panel !== null };

    sd.on('down', (control) => {
      if (control.type === 'button') handlers.onPress?.(control.column, control.row);
    });
    sd.on('rotate', (control, amount) => handlers.onRotate?.(control.index, amount));
    sd.on('error', () => this.#lost('the deck reported an error', handlers));

    this.#handlers = handlers;
  }

  #handlers: DeckHandlers;

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  /** Opens a deck the user already granted, with no dialog. Returns null if there is none. */
  static async reopen(handlers: DeckHandlers = {}): Promise<Deck | null> {
    if (!Deck.supported) return null;
    const decks = await getStreamDecks().catch(() => []);
    return decks[0] ? Deck.#adopt(decks[0], handlers) : null;
  }

  /** Shows the browser's device picker. Must be called from a user gesture. */
  static async request(handlers: DeckHandlers = {}): Promise<Deck | null> {
    if (!Deck.supported) throw new Error('This browser has no WebHID. Chrome, Edge or Opera on desktop will work.');
    const decks = await requestStreamDecks();
    return decks[0] ? Deck.#adopt(decks[0], handlers) : null;
  }

  static async #adopt(sd: StreamDeckWeb, handlers: DeckHandlers): Promise<Deck> {
    const deck = new Deck(sd, handlers);
    // Hardware brightness stays at full; the Glow knob dims in software so the
    // on-screen preview and the panel always agree.
    await sd.setBrightness(100).catch(() => {});
    await sd.clearPanel().catch(() => {});
    return deck;
  }

  #lost(reason: string, handlers: DeckHandlers = this.#handlers): void {
    if (!this.#alive) return;
    this.#alive = false;
    handlers.onLost?.(reason);
  }

  get alive(): boolean {
    return this.#alive;
  }

  /**
   * Paints one frame. `low` is a canvas of exactly cols*S by rows*S pixels;
   * the browser's bilinear scaling does the smoothing on the way up, which is
   * what stops each key looking like a block of flat colour.
   */
  async paint(low: HTMLCanvasElement): Promise<void> {
    if (!this.#alive) return;
    try {
      await (this.#panel ? this.#paintPanel(low, this.#panel) : this.#paintKeys(low));
      if (this.#encoders.length && this.#frame++ % 8 === 0) await this.#paintEncoders(low);
    } catch (err) {
      this.#lost(err instanceof Error ? err.message : 'the deck stopped responding');
    }
  }

  /** One HID image for the whole panel, gaps included, so the field stays continuous across keys. */
  async #paintPanel(low: HTMLCanvasElement, dim: Dimension): Promise<void> {
    const { canvas, ctx } = canvasOf(dim.width, dim.height);
    ctx.drawImage(low, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    await this.#sd.fillPanelBuffer(pixels, { format: 'rgba', withPadding: true });
  }

  /** Fallback for models without a panel write, and for keys that are lamps rather than screens. */
  async #paintKeys(low: HTMLCanvasElement): Promise<void> {
    const cellW = low.width / this.info.cols;
    const cellH = low.height / this.info.rows;
    const jobs: Promise<void>[] = [];

    for (const button of this.#buttons) {
      const sx = button.column * cellW;
      const sy = button.row * cellH;
      if (isLcdButton(button)) {
        const { width: w, height: h } = button.pixelSize;
        const { ctx } = canvasOf(w, h);
        ctx.drawImage(low, sx, sy, cellW, cellH, 0, 0, w, h);
        jobs.push(this.#sd.fillKeyBuffer(button.index, ctx.getImageData(0, 0, w, h).data, { format: 'rgba' }));
      } else if (button.feedbackType === 'rgb') {
        const [r, g, b] = samplePixel(low, sx + cellW / 2, sy + cellH / 2);
        jobs.push(this.#sd.fillKeyColor(button.index, r, g, b));
      }
    }
    await Promise.all(jobs);
  }

  /** Stream Deck+ dials glow with whatever is directly above them. */
  async #paintEncoders(low: HTMLCanvasElement): Promise<void> {
    const cellW = low.width / this.info.cols;
    await Promise.all(
      this.#encoders.map((enc) => {
        const [r, g, b] = samplePixel(low, (enc.column + 0.5) * cellW, low.height - 1);
        return enc.hasLed ? this.#sd.setEncoderColor(enc.index, r, g, b) : Promise.resolve();
      }),
    );
  }

  async close(): Promise<void> {
    this.#alive = false;
    await this.#sd.clearPanel().catch(() => {});
    await this.#sd.close().catch(() => {});
  }
}

const pixelCache = new WeakMap<HTMLCanvasElement, { data: Uint8ClampedArray; stamp: number }>();
let stamp = 0;

/** Marks the canvas dirty so the next samplePixel re-reads it. Called once per frame. */
export function invalidateSamples(): void {
  stamp++;
}

/** Reads one pixel, re-using a single per-frame readback of the whole low-res canvas. */
function samplePixel(low: HTMLCanvasElement, x: number, y: number): [number, number, number] {
  let entry = pixelCache.get(low);
  if (!entry || entry.stamp !== stamp) {
    const ctx = low.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [0, 0, 0];
    entry = { data: ctx.getImageData(0, 0, low.width, low.height).data, stamp };
    pixelCache.set(low, entry);
  }
  const px = Math.min(low.width - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(low.height - 1, Math.max(0, Math.floor(y)));
  const i = (py * low.width + px) * 4;
  return [entry.data[i] ?? 0, entry.data[i + 1] ?? 0, entry.data[i + 2] ?? 0];
}

function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
