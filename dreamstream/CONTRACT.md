# The Contracts

There are two, and they compose. A **Dream** is the animation. A **Layout**
is what is drawn on top of it. A dream can play alone; a layout always rides
on one.

---

# The Dream Contract, v1.0

Everything this app renders is a **Dream**. Gemini writes them, the built-ins
are them, and you can hand-write one in the Contract panel. The engine cannot
tell which is which, and that is the point: there is one interface, and every
author goes through it.

## Shape

```jsonc
{
  "version": "1.0",
  "name":    "Ember Tide",              // 2-3 words
  "vibe":    "coals turning over",      // one lowercase line
  "palette": ["#FF6B35", "#FFD166", "#C1121F"],  // 3-5 hex; re-themes the app
  "bpm":     58,                        // 20-180, tempo of the motion
  "field":   "return [15, 92, 40];",    // the body of the field function
  "prompt":  "a dying campfire"         // what summoned it; "" for built-ins
}
```

`palette` is not decoration. The app interpolates its entire colour scheme to
those values when a dream lands, so choose them as a set.

## The field function

```
(u, v, t, k, M) => [h, s, l]
```

| | |
|---|---|
| `u` | `0..1` across the panel, continuous and sub-key |
| `v` | `0..1` down the panel, continuous and sub-key |
| `t` | seconds since the dream began, already scaled by the Speed knob |
| `k.col`, `k.row` | integer coordinates of the key this sample belongs to |
| `k.i` | key index, row-major |
| `k.cols`, `k.rows` | grid dimensions of the connected hardware |
| `k.rnd` | stable `0..1` noise for this key — the same value every frame |
| `k.beat` | `0..1` sawtooth at the dream's `bpm` |
| `k.press` | `0..1` energy from a real key press, rippling outward |
| `M` | `Math` |

Returns `[hue 0..360, saturation 0..100, lightness 0..100]`.

`u` and `v` are continuous across the *whole panel*, including the physical
gaps between keys. A field that varies smoothly with them reads as one living
surface; a field that only varies with `k.col` reads as fifteen blinking
squares. Prefer the former — it is the difference between an animation and a
light show.

## What the engine promises

- The field is evaluated on a `10 x 10` grid per key, every frame, and the
  result is scaled up bilinearly. You are painting a continuous surface, not
  pixels.
- One evaluation feeds both the on-screen preview and the hardware, so they
  can never disagree.
- Output is low-pass filtered between frames — more aggressively for fields
  the probe found to be strobing.
- `k.press` is added to lightness on top of whatever you do with it, so a
  dream that ignores presses still answers when a key is pressed.
- While the tab is hidden and a deck is connected, rendering continues on a
  worker-driven clock. The panel keeps going when you switch apps.

## What a field must promise

- **Pure and deterministic** given `(u, v, t, k, M)`. No state between calls.
- **Returns three finite numbers.** Not an object, not a string, not `NaN`.
- **Terminates.** No loops of any kind.
- **Does not retain `k`.** It is one mutable object reused across every sample
  in a frame.
- Under 4000 characters.

## Validation

Nothing reaches the renderer without passing all three stages:

1. **Lint** — a denylist rejects `eval`, `arguments`, `constructor`,
   `__proto__`, `prototype`, `import`, `while`, `do`, `new`, `async`, `await`,
   `yield` and `debugger`, and requires a `return`.
2. **Probe** — the body is compiled and swept in a Web Worker: every key
   across a wide span of `t`, with and without a press, then one key stepped
   at 1/60s intervals to measure flicker. The worker is terminated after
   900ms, which is the only reliable way to survive a body that never returns.
3. **Compile** — the body is closed over a scope where `window`, `document`,
   `fetch`, `localStorage`, `navigator` and about thirty other globals are
   bound to `undefined`.

When Gemini fails any of these, the error is handed straight back to it and it
gets two more attempts. A broken field never reaches the renderer, and a field
that misbehaves at runtime anyway is dropped mid-frame rather than tolerated.

## Trust model

Be honest about what stage 3 is: **a barrier, not a sandbox.** Shadowing
identifiers removes every casual route out of a field, and the denylist closes
`constructor`, which is the well-known way back to `Function`. A determined
attacker with a novel escape is a different problem.

This is acceptable here because of who the author is: you, or a model you
chose, paid for, and pointed at a prompt you wrote. It would not be acceptable
if dreams were shared between users. **If you ever add importing dreams from
other people, move field execution into a Worker with no DOM access and treat
this section as the reason.**

`eval` and `arguments` are in the denylist rather than the shadow list because
strict mode forbids them as parameter names — they cannot be shadowed at all.

---

# The Layout Contract, v1.0

What is drawn *on* the keys — the icons for a presentation remote, a review
deck, a DJ rig.

```jsonc
{
  "version": "1.0",
  "name":    "Presentation Remote",
  "purpose": "run a talk without looking down",
  "keys": [                          // row-major, exactly cols * rows entries
    { "icon": "blank" },
    { "icon": "chevron-left",  "label": "Prev", "note": "Previous slide" },
    { "icon": "presentation",  "badge": "play", "accent": "#4DE8C2",
      "note": "Start presenting" },
    // ...
  ]
}
```

| field | |
|---|---|
| `icon` | a name from the vocabulary, or `"blank"` for animation only |
| `label` | optional caption, at most 12 characters |
| `badge` | optional small corner glyph, for qualifying an action |
| `accent` | optional `#rrggbb` tint for this key's glyph |
| `note` | what the key does; shown on hover, never drawn |

## Why the model does not draw

**A language model asked to emit SVG path data produces shapes nobody
recognises.** It is very good at *choosing*, and very bad at *drawing*. So it
never draws: it picks from a closed vocabulary of 370 curated
[Lucide](https://lucide.dev) icons, and every name it can choose is guaranteed
to exist and guaranteed to render.

Creativity lives in the composition — which icons, how they are grouped, what
gets an accent, what stays blank, and what the animation behind them is doing.
Recognisability is not traded away to get it.

The vocabulary is defined once, in `scripts/build-icons.mjs`, and baked into
`src/icons.json` by `npm run icons`. It is exactly the list the model is shown,
so the prompt and the validator cannot disagree.

## Resolution

Names are matched in order: exact, then synonym (`next` → `chevron-right`,
`stop` → `square`, `laser` → `mouse-pointer-2`), then singular/plural, then
nearest spelling within two edits (`presentaton` → `presentation`). Anything
still unresolved is collected and thrown as one error naming all of them, so
the repair loop fixes them in a single round trip.

A bad `badge` or a non-hex `accent` is decoration: it is dropped rather than
failing the whole layout. A bad `icon` is not.

## Fitting the grid

`keys` is normalised to exactly `cols * rows` — padded with blanks, truncated
if too long. Generation is always grid-aware, so this only matters when a
stored layout moves to different hardware; moving a 5×3 layout onto a 3×2 deck
keeps the first six keys in reading order rather than re-flowing them.

## Rendering

Each key is rasterised once per layout into its own transparent canvas, then
composited over the animation every frame — one `drawImage` per key rather
than redrawing glyphs sixty times a second. A pressed key's glyph swells
slightly, so touch registers on the icon and not only in the ripple underneath.

A soft dark scrim sits behind each glyph. Without it a white icon vanishes
whenever the animation beneath it turns pale.

Keys carrying a layout are written to the hardware individually rather than as
one panel image: glyphs must land at each key's native resolution and exact
position, which per-key writes give without having to guess where a padded
panel image puts each key. Pure animations still take the single-image fast
path.

---

## Versioning

`version` is stamped on every dream and every layout. Stored dreams are re-validated on load,
so a field that a future engine rejects fails visibly at that moment rather
than rendering something subtly wrong.
