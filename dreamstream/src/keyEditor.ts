import { BLANK, ICON_NAMES, loadIcon } from './icons';
import type { KeySpec } from './layout';

/**
 * A floating, non-modal editor for one key: pick an icon by clicking it
 * rather than describing it, type a label, tint it, clear it. Edit mode
 * (main.ts) decides when a key click opens this instead of rippling; this
 * module only knows how to draw and position itself.
 *
 * `null` in a patch means "clear this field" — distinct from the field being
 * absent, which means "untouched".
 */
export type KeyPatch = Partial<{
  icon: string;
  label: string | null;
  badge: string | null;
  accent: string | null;
  note: string | null;
}>;

export interface KeyEditorHandlers {
  onChange: (patch: KeyPatch) => void;
  onClear: () => void;
}

const ICONS = [...ICON_NAMES].sort();

let pop: HTMLDivElement | null = null;
let titleEl: HTMLSpanElement;
let labelInput: HTMLInputElement;
let noteInput: HTMLInputElement;
let accentInput: HTMLInputElement;
let searchInput: HTMLInputElement;
let iconGrid: HTMLDivElement;
let badgeGrid: HTMLDivElement;
let handlers: KeyEditorHandlers | null = null;

/** Dragging a native colour input fires `input` on every tick — coalesce those into one apply. */
function debounce(fn: (value: string) => void, ms: number): (value: string) => void {
  let t: number | undefined;
  return (value: string) => {
    window.clearTimeout(t);
    t = window.setTimeout(() => fn(value), ms);
  };
}

function labelSpan(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

function textField(name: string, placeholder: string, maxLength: number): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'ke-field';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  row.append(labelSpan(name), input);
  return { row, input };
}

function iconButton(name: string, kind: 'icon' | 'badge'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = name === BLANK ? 'ke-icon ke-blank' : 'ke-icon';
  btn.dataset['name'] = name;
  btn.title = name;
  btn.textContent = name === BLANK ? '—' : '';
  if (name !== BLANK) {
    void loadIcon(name, '#f5f5f7', 40).then((img) => {
      if (img) btn.prepend(img.cloneNode(true) as HTMLImageElement);
    });
  }
  btn.addEventListener('click', () => {
    for (const b of btn.parentElement?.children ?? []) b.classList.remove('on');
    btn.classList.add('on');
    handlers?.onChange(kind === 'icon' ? { icon: name } : { badge: name === BLANK ? null : name });
  });
  return btn;
}

function buildGrid(kind: 'icon' | 'badge'): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'ke-grid';
  grid.append(iconButton(BLANK, kind), ...ICONS.map((name) => iconButton(name, kind)));
  return grid;
}

function applySearch(term: string): void {
  const q = term.trim().toLowerCase();
  for (const grid of [iconGrid, badgeGrid]) {
    for (const btn of grid.children) {
      const name = (btn as HTMLElement).dataset['name'] ?? '';
      (btn as HTMLElement).hidden = q.length > 0 && name !== BLANK && !name.includes(q);
    }
  }
}

function highlight(key: KeySpec): void {
  for (const btn of iconGrid.children) btn.classList.toggle('on', (btn as HTMLElement).dataset['name'] === key.icon);
  for (const btn of badgeGrid.children) btn.classList.toggle('on', (btn as HTMLElement).dataset['name'] === (key.badge ?? BLANK));
}

function ensure(): HTMLDivElement {
  if (pop) return pop;

  const p = document.createElement('div');
  p.className = 'key-editor';
  p.hidden = true;

  const head = document.createElement('div');
  head.className = 'ke-head';
  titleEl = document.createElement('span');
  titleEl.className = 'ke-title';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ke-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeKeyEditor);
  head.append(titleEl, close);

  const label = textField('label', 'optional caption', 12);
  const note = textField('note', 'what this key does', 80);
  labelInput = label.input;
  noteInput = note.input;
  labelInput.addEventListener('input', () => handlers?.onChange({ label: labelInput.value.trim() || null }));
  noteInput.addEventListener('input', () => handlers?.onChange({ note: noteInput.value.trim() || null }));

  const accentRow = document.createElement('label');
  accentRow.className = 'ke-field ke-accent-row';
  accentInput = document.createElement('input');
  accentInput.type = 'color';
  accentInput.className = 'ke-accent';
  accentInput.value = '#ffffff';
  const accentClear = document.createElement('button');
  accentClear.type = 'button';
  accentClear.className = 'ghost';
  accentClear.textContent = 'none';
  accentRow.append(labelSpan('accent'), accentInput, accentClear);
  const emitAccent = debounce((value) => handlers?.onChange({ accent: value }), 80);
  accentInput.addEventListener('input', () => emitAccent(accentInput.value));
  accentClear.addEventListener('click', () => {
    accentInput.value = '#ffffff';
    handlers?.onChange({ accent: null });
  });

  searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'ke-search';
  searchInput.placeholder = 'search icons…';
  searchInput.addEventListener('input', () => applySearch(searchInput.value));
  const iconField = document.createElement('div');
  iconField.className = 'ke-field';
  iconField.append(labelSpan('icon'), searchInput, (iconGrid = buildGrid('icon')));

  const badgeField = document.createElement('div');
  badgeField.className = 'ke-field';
  badgeField.append(labelSpan('badge'), (badgeGrid = buildGrid('badge')));

  const foot = document.createElement('div');
  foot.className = 'ke-foot';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'ghost danger';
  clear.textContent = 'Clear key';
  clear.addEventListener('click', () => handlers?.onClear());
  foot.append(clear);

  p.append(head, label.row, note.row, accentRow, iconField, badgeField, foot);
  document.body.append(p);

  document.addEventListener('pointerdown', (e) => {
    if (p.hidden) return;
    const t = e.target as Element;
    if (p.contains(t) || t.closest?.('.key')) return;
    closeKeyEditor();
  }, true);

  pop = p;
  return p;
}

function position(anchor: HTMLElement, p: HTMLDivElement): void {
  const r = anchor.getBoundingClientRect();
  p.style.visibility = 'hidden';
  p.hidden = false;
  const pw = p.offsetWidth;
  const ph = p.offsetHeight;
  const left = Math.max(12, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - 12));
  const spaceBelow = window.innerHeight - r.bottom;
  const top = spaceBelow > ph + 16 ? r.bottom + 10 : Math.max(12, r.top - ph - 10);
  p.style.left = `${left}px`;
  p.style.top = `${top}px`;
  p.style.visibility = 'visible';
}

export function openKeyEditor(anchor: HTMLElement, index: number, key: KeySpec, h: KeyEditorHandlers): void {
  const p = ensure();
  handlers = h;
  titleEl.textContent = `Key ${index + 1}`;
  labelInput.value = key.label ?? '';
  noteInput.value = key.note ?? '';
  accentInput.value = key.accent ?? '#ffffff';
  searchInput.value = '';
  applySearch('');
  highlight(key);
  position(anchor, p);
}

export function closeKeyEditor(): void {
  if (pop) pop.hidden = true;
  handlers = null;
}

export function isKeyEditorOpen(): boolean {
  return !!pop && !pop.hidden;
}
