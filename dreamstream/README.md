# dreamstream

Describe an idea. Gemini writes an animation and lays out the icons. It lands
on your Stream Deck.

```
npm install
npm run dev
```

Then open the settings gear, paste a [Gemini API key](https://aistudio.google.com/apikey),
and type something like *a lava lamp in a submarine* — or *a presentation
remote*, and you get the controls for one.

The key is stored in this browser's `localStorage` and is sent to Google's API
and nowhere else. There is no server, no build step you have to think about,
and no account.

## What it does

Describe a **mood** and you get a Dream: a name, a palette, a tempo, and a
small pure function mapping a position on the panel and a moment in time to a
colour. The engine evaluates it across the whole panel every frame. Because
the animation is a function of the *whole panel* rather than fifteen
independent tiles, things flow across keys — waves travel, rain falls down
columns, a blast expands from the middle. Pressing a physical key sends a
ripple outward through whatever is playing.

Describe an **application** — *a presentation remote*, *a deck for reviewing
pull requests*, *a DJ rig* — and you also get a Layout: real icons on the keys,
grouped and labelled, over a deliberately dimmed animation so the glyphs stay
readable.

### The icons are chosen, not drawn

A language model asked to emit SVG path data produces shapes nobody
recognises. It is excellent at *choosing* and terrible at *drawing*, so it
never draws. It picks from a closed vocabulary of 370 curated
[Lucide](https://lucide.dev) icons — every name it can choose is guaranteed to
exist and guaranteed to render. Misses are caught and repaired: `presentaton`
becomes `presentation`, `next` becomes `chevron-right`, and an invented name is
handed back to Gemini to fix.

Creativity goes into the composition — which icons, how they group, what gets
an accent, what stays blank, what the animation behind them is doing.
Recognisability is not traded away to get it.

Run `npm run icons` to regenerate the vocabulary; it is defined in one place,
`scripts/build-icons.mjs`.

## Without a Stream Deck

Everything works. The on-screen preview is the same render, the same field
evaluation, one frame at a time — clicking a preview key ripples exactly as
pressing a real one does. Connect a deck later and the running dream moves to
it, re-fitted to that model's grid.

## With one

Press **Connect deck** once. After that the browser remembers, and the deck
reopens silently on every load. Presses ripple. Stream Deck+ dials ride the
Speed and Hue knobs, and the dial LEDs glow with whatever is above them. When
you switch to another app the tab goes hidden and `requestAnimationFrame`
stops — so the render loop moves onto a worker-driven clock and the panel keeps
animating, which is the entire reason a Stream Deck sits on a desk.

## The landing

A new dream does not just appear. By default it arrives through the
**Cauldron**: the keys you have crouch, hop and juggle over a brew that swirls
them into itself, coals smouldering beneath and smoke rising; then they burn
away at the edges and the new layout falls flat like a heavy tile, in a cloud
of dust that settles. While Gemini is thinking the panel simply keeps
stirring, and the answer lands when it comes.

It is one WebGL2 fragment shader (`src/landing.ts`) fed two pictures — the
panel as it was and the panel as it is becoming — and it plays on the hardware
exactly as it does on screen. Press `r` to land what is playing again, or open
**Landing** in the header to switch to a plain crossfade. If your system has
Reduce Motion on, the crossfade is the default; choosing the Cauldron there is
still respected.

## The contracts

Two, and they compose: a **Dream** is the animation, a **Layout** is what is
drawn on top. Both are defined in one place, [CONTRACT.md](./CONTRACT.md).
Gemini is held to them by a response schema, a denylist, a terminating-sweep
probe in a Web Worker, a closed icon vocabulary, and a repair loop that hands
its own failures back to it. Nothing that fails validation reaches the
renderer.

Open the **Contract** panel to read the spec, see the field currently playing,
edit it, and apply it. Hand-written fields go through exactly the same
validation as generated ones — that is the test of whether the contract is
real. Copy JSON gives you the whole scene, icons included.

## Keys

| | |
|---|---|
| `/` | jump to the prompt |
| `⏎` | conjure |
| `⌘⏎` | remix what is playing |
| `⌘S` | keep it on the shelf |
| `space` | pause |
| `r` | land it again |

## Layout

```
src/contract.ts   the Dream type, its schema, and the only path to a runnable field
src/layout.ts     the Layout type: icon-per-key validation and key rasterising
src/icons.ts      the closed icon vocabulary, name resolution, SVG rasterising
src/dreams.ts     built-ins and prompt seeds; held to the same contracts
src/gemini.ts     structured-output request, error mapping, repair loop
src/deck.ts       WebHID: one panel image for animations, per-key writes for glyphs
src/engine.ts     one field evaluation per frame, feeding preview and hardware
src/landing.ts    the Cauldron: a WebGL2 shader between the panel as it was and as it is becoming
src/store.ts      localStorage: key, model, shelf, knobs
src/main.ts       wiring
scripts/          regenerates src/icons.json from lucide-static
```

`contract.ts` depends on nothing. `icons.ts` depends only on its generated
data. Everything else depends on those.

## Requirements

Chrome, Edge or Opera on desktop — WebHID is not in Safari or Firefox. Close
the official Elgato software first; it holds the device open.
