import { BLANK, ICON_GROUPS, RENDER_SIZE, loadIcon, resolveIcon } from './icons';
import type { Dream, DreamSpec } from './contract';

/**
 * The Layout Contract — what is drawn *on* the keys, over whatever the Dream
 * is doing behind them.
 *
 * A Layout is deliberately not free-form artwork. It is a choice of icon per
 * key from a fixed vocabulary, plus a label, an optional corner badge and an
 * optional accent. Composition is where the creativity lives; the glyphs
 * themselves stay recognisable because they are real Lucide icons rather than
 * geometry a model invented.
 */

export const LAYOUT_VERSION = '1.0';

export interface KeySpec {
  /** A name from the icon vocabulary, or "blank" for animation only. */
  icon: string;
  /** Short caption under the glyph. Ten characters is about the readable limit. */
  label?: string;
  /** A smaller second glyph in the top-right corner, for qualifying an action. */
  badge?: string;
  /** #rrggbb tint for this key's glyph. Used sparingly, it creates hierarchy. */
  accent?: string;
  /** What the key is for. Shown on hover; never drawn. */
  note?: string;
}

export interface LayoutSpec {
  version: string;
  name: string;
  purpose: string;
  /** Row-major, one entry per key. */
  keys: KeySpec[];
}

/** A dream plus what is drawn on top of it. The unit the app plays and stores. */
export interface Scene {
  dream: Dream;
  layout: LayoutSpec | null;
}

/** The serialisable form. Dreams saved before layouts existed simply lack the field. */
export interface SceneSpec extends DreamSpec {
  layout?: LayoutSpec;
}

export class LayoutError extends Error {
  override name = 'LayoutError';
}

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (s: unknown, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The icon vocabulary as the model is shown it. */
export const VOCABULARY_TEXT = Object.entries(ICON_GROUPS)
  .map(([group, names]) => `${group}:\n  ${names.join(' ')}`)
  .join('\n');

export const LAYOUT_SCHEMA = {
  type: 'OBJECT',
  description: 'Icons drawn on the keys. Include only when the idea is an application, a workflow, or a set of controls.',
  properties: {
    name: { type: 'STRING', description: 'What this set of controls is, e.g. "Presentation Remote".' },
    purpose: { type: 'STRING', description: 'One short line describing what it is for.' },
    keys: {
      type: 'ARRAY',
      description: 'Exactly one entry per key, row-major, left to right then top to bottom.',
      items: {
        type: 'OBJECT',
        properties: {
          icon: { type: 'STRING', description: 'A name from the vocabulary, or "blank" for an empty key.' },
          label: { type: 'STRING', description: 'Optional caption, at most 10 characters.' },
          badge: { type: 'STRING', description: 'Optional small corner glyph from the same vocabulary.' },
          accent: { type: 'STRING', description: 'Optional #rrggbb tint for this glyph.' },
          note: { type: 'STRING', description: 'What this key does.' },
        },
        required: ['icon'],
        propertyOrdering: ['icon', 'label', 'badge', 'accent', 'note'],
      },
    },
  },
  required: ['name', 'purpose', 'keys'],
  propertyOrdering: ['name', 'purpose', 'keys'],
} as const;

/**
 * Normalises a layout onto a specific grid, resolving every icon name against
 * the vocabulary. Unresolvable names are collected and thrown together so the
 * repair loop can fix all of them in one round trip.
 */
export function validateLayout(raw: unknown, count: number): LayoutSpec {
  if (!raw || typeof raw !== 'object') throw new LayoutError('layout was not an object');
  const r = raw as Partial<LayoutSpec>;
  if (!Array.isArray(r.keys)) throw new LayoutError('layout.keys must be an array');

  const unknown: string[] = [];
  const keys: KeySpec[] = [];

  for (let i = 0; i < count; i++) {
    const entry = (r.keys[i] ?? {}) as Partial<KeySpec>;
    const icon = resolveIcon(entry.icon ?? BLANK);
    if (!icon) {
      unknown.push(String(entry.icon));
      continue;
    }
    const key: KeySpec = { icon };
    const label = clean(entry.label, 12);
    const note = clean(entry.note, 80);
    // A badge is decoration: a bad one is dropped rather than failing the layout.
    const badge = entry.badge ? resolveIcon(entry.badge) : null;
    const accent = typeof entry.accent === 'string' && HEX.test(entry.accent) ? entry.accent : null;
    if (label) key.label = label;
    if (note) key.note = note;
    if (badge && badge !== BLANK) key.badge = badge;
    if (accent) key.accent = accent;
    keys.push(key);
  }

  if (unknown.length) {
    throw new LayoutError(
      `these are not icons in the vocabulary: ${[...new Set(unknown)].join(', ')}. Use only names from the list.`,
    );
  }

  return {
    version: LAYOUT_VERSION,
    name: clean(r.name, 40) || 'Untitled Layout',
    purpose: clean(r.purpose, 90) || '',
    keys,
  };
}

// --- drawing ---------------------------------------------------------------

const GLYPH_PLAIN = 0.58;
const GLYPH_WITH_LABEL = 0.46;

/**
 * Rasterises each key into its own transparent canvas, once per layout. The
 * result is composited over the animation every frame, which costs one
 * drawImage per key rather than re-drawing glyphs sixty times a second.
 *
 * Returns null for keys that carry nothing, so the animation shows through
 * completely rather than being dimmed by an empty scrim.
 */
export async function renderKeys(layout: LayoutSpec, size = RENDER_SIZE): Promise<(HTMLCanvasElement | null)[]> {
  return Promise.all(layout.keys.map((key) => renderKey(key, size)));
}

async function renderKey(key: KeySpec, size: number): Promise<HTMLCanvasElement | null> {
  const hasGlyph = key.icon !== BLANK;
  if (!hasGlyph && !key.label) return null;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const colour = key.accent ?? '#ffffff';
  const centre = size / 2;

  // A soft well behind the glyph. Without it a white icon disappears whenever
  // the animation underneath turns pale.
  const scrim = ctx.createRadialGradient(centre, centre, 0, centre, centre, size * 0.66);
  scrim.addColorStop(0, 'rgba(0,0,0,0.46)');
  scrim.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, size, size);

  ctx.shadowColor = 'rgba(0,0,0,0.75)';
  ctx.shadowBlur = size * 0.055;
  ctx.shadowOffsetY = size * 0.012;

  if (hasGlyph) {
    const glyph = await loadIcon(key.icon, colour, RENDER_SIZE);
    if (glyph) {
      const box = size * (key.label ? GLYPH_WITH_LABEL : GLYPH_PLAIN);
      const y = key.label ? size * 0.42 : centre;
      ctx.drawImage(glyph, centre - box / 2, y - box / 2, box, box);
    }
  }

  if (key.badge) {
    const badge = await loadIcon(key.badge, colour, RENDER_SIZE);
    if (badge) {
      const box = size * 0.26;
      ctx.drawImage(badge, size - box - size * 0.07, size * 0.07, box, box);
    }
  }

  if (key.label) {
    ctx.font = `650 ${Math.round(size * 0.125)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = key.accent ?? '#ffffff';
    ctx.letterSpacing = `${size * 0.004}px`;
    ctx.fillText(key.label, centre, size * (hasGlyph ? 0.84 : 0.57), size * 0.9);
  }

  return canvas;
}
