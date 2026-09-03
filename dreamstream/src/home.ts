/**
 * The entry experience. Most visitors have never touched Gemini and just
 * want to see the thing move, so the panel itself is the pitch: it autoplays
 * through the built-in dreams on its own, no prompt box or API key in sight.
 * "Describe your own" reveals the composer for the minority who have a key
 * and want to write one — and stays revealed, since a returning visitor who
 * already has a key doesn't need the pitch again.
 */
import type { SceneSpec } from './layout';
import './home.css';

export interface HomeHooks {
  /** Built-in dreams to cycle through — already validated, never a broken example. */
  examples: SceneSpec[];
  /** Loads and plays one, exactly like clicking a shelf card. */
  loadExample(spec: SceneSpec): void;
  /** Opens the real Settings dialog. */
  openSettings(): void;
  hasApiKey(): boolean;
}

export interface HomeHandle {
  /** Call after Settings closes: re-checks the key and, if one now exists, skips straight past the pitch. */
  refresh(): void;
}

const CYCLE_MS = 5200;

export function initHome(hooks: HomeHooks): HomeHandle {
  const root = document.getElementById('homeIntro');
  if (!root) return { refresh: () => {} };

  const hero = document.createElement('div');
  hero.className = 'homeHero';
  hero.innerHTML = `<h1>This is what a dream looks like.</h1>
    <p>Sit back — it cycles through a few on its own. Got a Gemini key? Describe your own below.</p>`;
  root.append(hero);

  const dots = document.createElement('div');
  dots.className = 'homeDots';
  const dotEls = hooks.examples.map((spec, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'homeDot';
    d.title = spec.layout ? spec.layout.name : spec.name;
    d.addEventListener('click', () => jumpTo(i));
    dots.append(d);
    return d;
  });

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

  let index = -1;
  let timer = 0;

  const jumpTo = (i: number, { restart = true } = {}): void => {
    index = i;
    hooks.loadExample(hooks.examples[i]!);
    for (const [n, d] of dotEls.entries()) d.classList.toggle('on', n === i);
    if (restart) rearm();
  };
  const rearm = (): void => {
    window.clearTimeout(timer);
    if (document.body.classList.contains('homeRevealed')) return;
    timer = window.setTimeout(() => jumpTo((index + 1) % hooks.examples.length), CYCLE_MS);
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

  return {
    refresh: () => {
      syncKeyLink();
      if (hooks.hasApiKey()) revealNow();
    },
  };
}
