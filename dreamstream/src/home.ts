/**
 * The entry experience, and the only shelf. Most visitors have never touched
 * Gemini and just want to see the thing move, so the panel itself is the
 * pitch: it autoplays through the built-in dreams on its own, no prompt box
 * or API key in sight. "Describe your own" reveals the composer for the
 * minority who have a key and want to write one — and stays revealed, since
 * a returning visitor who already has a key doesn't need the pitch again.
 *
 * The dots outlive the pitch. Once revealed they stop cycling and become the
 * picker: built-ins first, then whatever you have kept, so a dream you saved
 * sits in the same row as the ones that shipped.
 */
import type { SceneSpec } from './layout';
import './home.css';

export interface HomeHooks {
  /** Everything the dots hold, in order: built-ins first, then kept dreams. */
  dreams(): SceneSpec[];
  /** How many of those are built in — the rest are the visitor's own. */
  builtinCount(): number;
  /** Loads and plays one, exactly like pressing its dot. */
  loadExample(spec: SceneSpec): void;
  /** Opens the real Settings dialog. */
  openSettings(): void;
  hasApiKey(): boolean;
  /** The field of whatever is playing, so its dot can light up. */
  playingField(): string | undefined;
}

export interface HomeHandle {
  /** Call after Settings closes: re-checks the key and, if one now exists, skips straight past the pitch. */
  refresh(): void;
  /** Call whenever the dream list or what is playing changes. */
  sync(): void;
}

const CYCLE_MS = 5200;

export function initHome(hooks: HomeHooks): HomeHandle {
  const root = document.getElementById('homeIntro');
  if (!root) return { refresh: () => {}, sync: () => {} };

  const hero = document.createElement('div');
  hero.className = 'homeHero';
  hero.innerHTML = `<h1>This is what a dream looks like.</h1>
    <p>Sit back — it cycles through a few on its own. Got a Gemini key? Describe your own below.</p>`;
  root.append(hero);

  const dots = document.createElement('div');
  dots.className = 'homeDots';

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'ghost homeReveal';
  reveal.textContent = 'Describe your own →';

  const keyLine = document.createElement('p');
  keyLine.className = 'homeKeyLine';
  const keyLink = document.createElement('button');
  keyLink.type = 'button';
  keyLink.className = 'link';
  keyLink.addEventListener('click', hooks.openSettings);
  keyLine.append(keyLink);

  const syncKeyLink = (): void => {
    keyLink.textContent = hooks.hasApiKey() ? 'Gemini key added ✓' : 'Have a Gemini key? Add it →';
  };
  syncKeyLink();

  document.querySelector('.stage')?.after(dots, reveal, keyLine);

  let timer = 0;

  /** Where the playing dream sits in the row, or -1 when it is something just conjured. */
  const playingIndex = (): number => {
    const field = hooks.playingField();
    return field === undefined ? -1 : hooks.dreams().findIndex((s) => s.field === field);
  };

  const paintDots = (): void => {
    const list = hooks.dreams();
    const builtins = hooks.builtinCount();
    const on = playingIndex();
    dots.replaceChildren(
      ...list.map((spec, i) => {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = `homeDot${i >= builtins ? ' kept' : ''}${i === on ? ' on' : ''}`;
        const name = spec.layout ? spec.layout.name : spec.name;
        d.title = i >= builtins ? `${name} — kept` : name;
        d.setAttribute('aria-label', d.title);
        d.addEventListener('click', () => jumpTo(i));
        return d;
      }),
    );
  };

  const jumpTo = (i: number): void => {
    const spec = hooks.dreams()[i];
    if (!spec) return;
    hooks.loadExample(spec);
    rearm();
  };

  const rearm = (): void => {
    window.clearTimeout(timer);
    if (document.body.classList.contains('homeRevealed')) return;
    timer = window.setTimeout(() => {
      const list = hooks.dreams();
      jumpTo(list.length ? (playingIndex() + 1) % list.length : 0);
    }, CYCLE_MS);
  };

  const revealNow = (): void => {
    document.body.classList.add('homeRevealed');
    window.clearTimeout(timer);
  };

  reveal.addEventListener('click', () => {
    revealNow();
    (document.getElementById('prompt') as HTMLInputElement | null)?.focus();
  });

  // A returning visitor who already has a key doesn't need the pitch again.
  if (hooks.hasApiKey()) revealNow();
  else jumpTo(0);
  paintDots();

  return {
    refresh: () => {
      syncKeyLink();
      if (hooks.hasApiKey()) revealNow();
    },
    sync: paintDots,
  };
}
