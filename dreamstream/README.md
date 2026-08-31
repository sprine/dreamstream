# dreamstream

Describe an idea. Gemini writes an animation. It lands on your Stream Deck.

```
npm install
npm run dev
```

Then open the settings gear, paste a [Gemini API key](https://aistudio.google.com/apikey),
and type something like *a lava lamp in a submarine*.

The key is stored in this browser's `localStorage` and is sent to Google's API
and nowhere else. There is no server, no build step you have to think about,
and no account.

## What it does

You describe a dream. Gemini answers with a [Dream](./CONTRACT.md) — a name, a
palette, a tempo, and a small pure function that maps a position on the panel
and a moment in time to a colour. The engine evaluates that function across the
whole panel every frame and paints it onto the hardware.

Because the animation is a *function of the whole panel* rather than fifteen
independent icons, things flow across keys: waves travel, rain falls down
columns, a blast expands from the middle. Pressing a physical key sends a
ripple outward through whatever is playing.

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

## The contract

Everything renderable is a Dream, and there is exactly one definition of what
that means: [CONTRACT.md](./CONTRACT.md). Gemini is held to it by a response
schema, a denylist, a terminating-sweep probe in a Web Worker, and a repair
loop that hands its own failures back to it. Nothing that fails validation
reaches the renderer.

Open the **Contract** panel to read the spec, see the field currently playing,
edit it, and apply it. Hand-written fields go through exactly the same
validation as generated ones — that is the test of whether the contract is
real.

## Keys

| | |
|---|---|
| `/` | jump to the prompt |
| `⏎` | conjure |
| `⌘⏎` | remix what is playing |
| `⌘S` | keep it on the shelf |
| `space` | pause |

## Layout

```
src/contract.ts   the Dream type, its schema, and the only path to a runnable field
src/dreams.ts     built-ins and prompt seeds; held to the same contract
src/gemini.ts     structured-output request, error mapping, repair loop
src/deck.ts       WebHID: one panel image where supported, per-key writes where not
src/engine.ts     one field evaluation per frame, feeding preview and hardware
src/store.ts      localStorage: key, model, shelf, knobs
src/main.ts       wiring
```

`contract.ts` depends on nothing. Everything else depends on it.

## Requirements

Chrome, Edge or Opera on desktop — WebHID is not in Safari or Firefox. Close
the official Elgato software first; it holds the device open.
