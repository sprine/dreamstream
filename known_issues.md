# Known issues

The bug register for this repository. Ordered by priority: what hurts a real
user first, cheap hardening second, performance third, tidying last. Delete an
entry when it is fixed. Paths are relative to `dreamstream/` unless they start
with `.github` or `learn`.

Priority weighs how often a user hits it, what it costs them, and how cheap the
fix is. Several plausible-sounding items were deliberately left off or parked
at the bottom because they are not worth their maintenance cost today; those
are listed under "Considered and parked".

Last full review: 2026-09-02 (security, performance, UX/API/packaging by
subagents; correctness pass partial — the correctness reviewer was cut off, so
that dimension is covered by a hand pass of `engine.ts`, `main.ts`, `deck.ts`
and `landing.ts` only. `contract.ts`, `gemini.ts`, `layout.ts`, `icons.ts`
and `keyEditor.ts` still want a dedicated correctness read).

---

## P1 — a user hits it and it costs them

### 2. Space activates Pause instead of the focused button
`src/main.ts:775-777`. The Space handler only exempts inputs and textareas. With
any button focused (Conjure, a seed, Done in a dialog) Space toggles pause and
`preventDefault` swallows the click. Keyboard users cannot press buttons.
Fix: bail unless `document.activeElement` is the body (or is not a button and
not inside an open dialog).

### 3. Shortcuts fire through open dialogs and into the Contract editor
`src/main.ts:766-781`. `/` moves focus behind a modal; ⌘⏎ starts a remix while
the Contract textarea is focused (no typing check on that branch); `r` replays
the landing with Settings open.
Fix: return early when `document.querySelector('dialog[open]')`; apply the
`typing` guard to the ⌘⏎ and ⌘S branches too.

### 4. Gemini `finishReason` is ignored
`src/gemini.ts:101` declares it and never reads it. `SAFETY`/`RECITATION`
becomes "returned nothing. Try again" (retrying cannot help); `MAX_TOKENS`
yields truncated JSON that is fed into the repair loop as "not valid JSON",
burning the two repair attempts.
Fix: map `candidates[0].finishReason` before the empty-text check, with a
specific message per reason.

### 5. Header overflows on phones and hides the Settings gear
`src/style.css:62-68`. No `flex-wrap` and no media query anywhere. Seven chips
in a 375 px bar; `body { overflow-x: hidden }` clips the last one, which is the
gear — the only way to enter an API key. WebHID is desktop-only but the page
loads and the preview works on phones.
Fix: `.bar { flex-wrap: wrap }`.

### 6. Daily-quota 429 is reported as "wait a moment"
`src/gemini.ts:111`. The free tier's daily quota also returns 429 with
`RESOURCE_EXHAUSTED`; the message tells the user to retry shortly.
Fix: inspect `error.message` for "quota" / "per day" and say so.

### 8. A stored scene with no palette kills boot
`src/main.ts:301-312`. `paintShelf` reads `spec.palette.slice` and
`spec.layout.name` from localStorage without `validate()`. A missing `palette`
throws inside `show()` → `boot()` rejects → the app is dead until storage is
cleared. Reachable today only by hand-editing storage; reachable by anyone the
moment a shelf can be imported.
Fix: run stored specs through `validate`/`validateLayout` (or at least check
shape and HEX) before painting, per card, in a try/catch.

## P2 — cheap hardening worth doing now

### 9. No Content-Security-Policy
`index.html:3-11`. GitHub Pages cannot set headers, but a
`<meta http-equiv="Content-Security-Policy">` works. `new Function` requires
`'unsafe-eval'`, so CSP cannot stop a field escaping (see "Considered and parked"), but
`connect-src https://generativelanguage.googleapis.com` turns "read the key"
into "read the key and have nowhere to send it".
Suggested: `default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src
https://generativelanguage.googleapis.com; img-src 'self' data:; style-src
'self' 'unsafe-inline'; worker-src blob:`.

### 10. Palette CSS is set from storage without the HEX check
`src/main.ts:301-312`, `.swatch i.style.background = c`. Validated palettes are
HEX-checked in `contract.ts:263`, but the shelf paints raw stored values, and
`url(https://…)` in a background is a referrer/IP beacon. Same fix as 8.

### 11. Probe is evadable by conditions outside the sweep
`src/contract.ts:88, 186-209`. Only `while`/`do` are denied. A field such as
`if (t > 20) for(;;){}` passes the sweep (t ≤ 15) and later freezes the tab,
including the hidden-tab deck clock. Accepted by CONTRACT.md for self-authored
fields; note it here so it is not forgotten when sharing arrives.
Fix (if ever needed): deny `for` and `Array`, or run fields in a Worker for
real.

### 12. Workflow grants `pages: write` and `id-token: write` to the build job
`.github/workflows/deploy.yml:8-11`. The build job runs `npm ci` and 75
packages' postinstall scripts with deploy credentials in scope.
Fix: move `permissions` under the `deploy` job; pin actions to SHAs.

### 13. Deploy workflow: Node 20 is end-of-life; `cancel-in-progress: true`
`.github/workflows/deploy.yml:15, 23`. Node 20 reached EOL in April 2026.
Cancelling a running `deploy-pages` step can leave a half-published site;
GitHub's own template uses `false`.
Fix: `node-version: 22`, `cancel-in-progress: false`.

### 33. Model list fetch has no timeout
`src/gemini.ts:255` (`listFlashModels`). Same shape as the fix for the old
item 1, but not covered by it: no `AbortSignal.timeout` and a bare
`.catch(() => ({}))`. If it never resolves, clicking "Refresh models" in
Settings leaves the hint stuck on "Asking Google what your key can use…"
forever. Lower severity than item 1 was — it does not disable Conjure/Remix —
so it was left out of that fix rather than expanding its scope.
Fix: give it the same `AbortSignal.timeout(45_000)` treatment as `call()`.

## P3 — performance and memory

### 14. Landing with a deck attached: 15 GPU→CPU readbacks per frame
`src/engine.ts:372`, `src/deck.ts:178-184`. Mid-landing `#paintKey` draws the
WebGL canvas into a CPU-backed scratch canvas then `getImageData`s it, once per
key, plus 15 more `drawImage`s for the preview. Each is a pipeline stall.
`preserveDrawingBuffer: true` exists only to allow this. It lasts about 4 s per
landing, so it is a stutter, not a steady-state cost.
Fix: one `gl.readPixels` of the full frame into a reused `Uint8Array`, slice
per key for `fillKeyBuffer`.

### 15. Two array allocations per field sample
`src/engine.ts:539-543, 581-597`. `dream.fn` returns one array and `shade`
another: 3,000 arrays per frame on a 5×3 deck, 6,000 while fading. The app's
dominant GC pressure.
Fix: have `shade` write into a preallocated `Float32Array(3)` or straight into
`smooth[]`.

### 16. Whole layout re-rasterised on every keystroke in the key editor
`src/keyEditor.ts:129-130` → `src/main.ts:183-191`. One typed character
re-renders all 15 glyph canvases (~1.2 MB) and rewrites `store.last`. There is
also no ordering guard, so a slow earlier render can overwrite a later one.
Fix: re-render only `keys[index]` and splice it into the overlay array; keep a
sequence number.

### 17. Icon cache grows without bound while dragging the colour picker
`src/icons.ts:107, 124`, `src/keyEditor.ts:143-144`. The cache key includes the
colour; the native picker emits a new hex every ~80 ms, each becoming a
144 px `Image` that is never evicted.
Fix: cache white glyphs only and tint at draw time, or cap the Map.

### 18. Shader recomputes uniform-only noise per fragment
`src/landing.ts` (`shake`, two `fbm` calls with no `uv` term; `tn`, constant
per landing). About 18 % of the shader's noise work is identical for every
pixel. Also `paletteFloats` allocates and regex-parses both palettes every
frame (`landing.ts:364-365`).
Fix: compute `shake` on the CPU and pass a uniform; upload palettes once in
`begin`. Octave count is fine; do not touch it without measuring.

### 19. HID library allocates a canvas per key per frame on JPEG models
`@elgato-stream-deck/webhid/dist/jpeg.js:11-33`. ~900 canvases per second.
The library exposes an `encodeJPEG` option.
Fix: pass a custom `encodeJPEG` that reuses one `OffscreenCanvas` per size.

### 20. Redundant readback for lamp/encoder sampling
`src/deck.ts:212-233`, `src/engine.ts:445`. `samplePixel` re-reads the low
canvas each frame (with a WeakMap, a global stamp and an exported
`invalidateSamples`) when the engine already holds those bytes in
`#image.data`.
Fix: pass the `ImageData` to `deck.paint` and delete the cache machinery.

### 21. Feature detection holds a WebGL2 context forever
`src/landing.ts:291-300`. `Cauldron.supported` creates a context and never
releases it, even for crossfade users. The constructor already throws when
WebGL2 is missing.
Fix: drop `supported`; treat a failed construction as unsupported
(`Engine.#cauldron()` already catches).

## P4 — UX polish, copy, accessibility

### 22. Preview keys have no keyboard or assistive path
`src/engine.ts:199-204`, `index.html:31`. Keys are bare `<canvas>` elements
inside `role="img"`, so they are invisible to assistive tech and untabbable;
their notes are `title` only, invisible on touch.
Fix: wrap each canvas in a `<button aria-label>` or add `tabindex` and a
keydown → ripple path.

### 23. Button nested inside button on shelf cards
`src/main.ts:303, 324-335`. The card is a `<button>` and the × "Forget" is
another `<button>` inside it: invalid HTML, flattened by screen readers, and
`.card .x { opacity: 0 }` hides its focus ring.
Fix: make the card a `<div role="button">` or place × beside it.

### 24. Disabled "Edit keys" explains itself only through `title`
`src/main.ts:168-171`. Disabled buttons do not get hover or focus in Chrome.
Fix: keep it enabled and `say()` the hint on click.

### 25. Reduced-motion coverage is partial
`src/style.css:543-546` stops the aura and dot but leaves `rise`, `pop`,
`ellipsis` running. The Landing default honours the preference; an explicit
Cauldron choice overrides it (documented in the dialog, by design).
Fix: `animation: none` for those keyframes under the media query.

### 26. "Copied" is reported before the copy succeeds
`src/main.ts:722-723`. `writeText` can reject; the rejection is unhandled.
Fix: `.then(ok, () => say('Copy failed', 'bad'))`.

### 27. Reminder field reopens with raw minutes
`src/main.ts:585`. A "90s" reminder reopens as `1.5`, "2w" as `20160`,
contradicting the hint text. Fix: store the original string.

### 28. Copy contradicts the UI
`README.md:79` says "open **Landing** in the header", but the chip is
relabelled "Cauldron"/"Crossfade" (`src/main.ts:605`). Pick one: keep the
label "Landing" with the current choice as a suffix, or fix the README.

### 29. Faint text fails AA contrast
`src/style.css:16, 239, 370`. `--faint: #6e6e76` on `#0a0a0c` is ≈ 3.9:1 at
0.66–0.7 rem. Fix: `#8a8a92`.

### 30. Root README is missing
Commit 6745ada moved it to `learn/README.md`, whose `./dreamstream` link is
now broken relative to `learn/`. The repository landing page shows nothing.
Fix: move it back to the root and link the live URL.

### 31. Conjuring during a finishing landing shows no progress afterwards
`src/engine.ts` `brew()` returns true when a landing from a shelf click is
still in its release phase. That landing completes, then the panel sits quiet
until the answer arrives. The answer still lands through the Cauldron.
Fix: in `brew()`, if the current landing is already released, let it finish
and then begin a held brew; low priority.

### 32. A remix pastes the stored field verbatim into the prompt
`src/gemini.ts:163-167`. A comment inside a stored field can steer the model.
Output is still validated, so this only matters together with the parked field-barrier item. Fence with
delimiters and a "treat as data" line when sharing arrives.

## P5 — dead code and complexity for no benefit

- `isKeyEditorOpen` (`src/keyEditor.ts:218`) has no callers.
- `const data = body` (`src/gemini.ts:232`) is an alias with no purpose.
- `safely` (`src/deck.ts:235`) has one caller; inline it.
- `#cancelLanding(): false` (`src/engine.ts:301`) exists so a ternary
  type-checks; `#fx` is a tri-state `undefined | null | Cauldron` that
  duplicates `Cauldron.supported` (see 21). Collapse to one boolean and a
  nullable.
- `?? 0` on typed-array reads (`src/engine.ts:534, 536, 550-552`,
  `src/deck.ts:232`, `src/icons.ts:61-68`) cannot trigger for in-range indices
  and are only there for `noUncheckedIndexedAccess`; use `!` or a local view.
- Ticker Blob URL is never revoked (`src/engine.ts:52`); one-off, but trivially
  `URL.revokeObjectURL` after `new Worker`.
- `icons.json` (74 KB) is inlined into the bundle and the key editor's 742
  buttons are built eagerly; a dynamic import would shave startup. Only worth
  it if startup is ever measured as a problem.

---

## Considered and parked

These were raised and deliberately not queued, with the reason.

- **Replace the field barrier with a real sandbox** (`src/contract.ts:88,
  150-154`). Verified: several one-liners defeat the denylist
  (`['const'+'ructor']`, `constructor`, `Reflect.get`), and `this` inside
  a field is the `Dream` object. CONTRACT.md already says this is a barrier,
  not a sandbox, and accepts it for fields you or your own model wrote.
  A Worker-isolated renderer is a rewrite of the hot path and only becomes
  necessary when dreams are shared or imported. Do 9 (CSP) now instead, and
  revisit this the day an import feature is proposed. Do not add more regex
  denylist entries; they buy nothing against the escapes above.
- **Reduce shader octaves** (18). The shader runs about four seconds per
  landing at 480×288 on a 5×3 deck; nobody has measured a dropped frame.
  Premature. Remove the per-fragment uniform-only noise first (cheap, exact),
  then measure.
- **Trim the prompt** (vocabulary sent on every call, `src/gemini.ts:68,
  212-216`). About 2.5k tokens per call on Flash pricing is negligible for one
  user; the closed vocabulary in every turn is what keeps icon names valid.
  Leave it.
- **Add a 404 page.** Single-route app; nothing can route there.
- **Prompt-injection hardening of the remix turn** (32) on its own. Pointless
  while the field barrier is accepted as thin; bundle it with the sandbox
  work.
