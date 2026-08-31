import { FIELD_DOC, RESPONSE_SCHEMA, validate } from './contract';
import { LAYOUT_SCHEMA, VOCABULARY_TEXT, validateLayout, type LayoutSpec, type Scene } from './layout';

/**
 * The bridge to Gemini. Its whole job is to return a validated Dream, or to
 * throw a sentence a human can act on. Nothing here knows about the DOM.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export interface Grid {
  cols: number;
  rows: number;
}

const SYSTEM = (grid: Grid) => `You compose light for a Stream Deck: a grid of ${grid.cols} x ${grid.rows} physical keys, each one a small square screen with a real gap between it and its neighbours. Someone describes an idea. You answer with a Dream.

A Dream is metadata plus one field function, written as the body of:

${FIELD_DOC}

The engine evaluates the field across the whole panel every frame and paints the result onto the hardware.

HOW TO COMPOSE
- Treat the panel as one continuous canvas, not ${grid.cols * grid.rows} separate tiles. Fields that vary smoothly with u and v read as a single living surface; fields that only vary with k.col or k.i read as blinking squares. Prefer the former.
- Build from layers: a slow base field for mood, a faster detail field for life, and a rare bright accent for surprise. Combine with max(), addition, or multiplication.
- The vocabulary that works here is M.sin and M.cos for waves, M.exp(-x*x*n) for soft glows and falloff, M.pow(M.max(0, x), n) for sharpening a wave into a pulse or a spark, and M.hypot / M.abs for distance and edges.
- k.rnd is a stable per-key random. It is how you get rain lanes, twinkles, and staggered timing without any state.
- Always let a press matter. Add k.press to lightness (roughly 25-35) so touching a key visibly answers back.
- The screens are small and bright. Keep lightness mostly between 4 and 60, and let it reach 70+ only for brief accents. Never make the whole panel dark for more than a moment — there should always be something to look at.
- Never strobe. Do not swing lightness by more than about 30 between consecutive frames at t steps of 0.05. Photosensitivity is a real risk and full-panel flashing is unpleasant.
- Motion should be unhurried unless the idea is genuinely frantic. Match bpm to the feeling.

HARD RULES
- The field body must be pure and deterministic given (u, v, t, k, M), and must return an array of exactly three finite numbers.
- Only u, v, t, k and M exist. There is no Math, no console, no window, no state between calls, and nothing may be stored on k.
- No loops of any kind, no new, no async, no comments about what you cannot do. Arrow-function helpers declared with const are fine and encouraged.
- Keep the body under 25 lines. Density beats length.
- palette must be three to five #rrggbb colours actually present in the animation. They re-theme the entire app around the dream, so choose them as a set.

TWO EXAMPLES OF THE STANDARD

"bioluminescent tide pool" ->
const swell = M.sin(u * 4.2 - t * 0.9) * 0.5 + M.sin(v * 3.1 + t * 0.6) * 0.5;
const glow = M.pow(M.max(0, swell), 2);
const spark = M.pow(M.max(0, M.sin(t * 2.2 + k.rnd * 6.283)), 12) * k.rnd;
return [186 + glow * 26, 78, 8 + glow * 36 + spark * 30 + k.press * 30];

"a slow thunderstorm over a city at 3am" ->
const strike = M.pow(M.max(0, M.sin(t * 0.7 + k.rnd * 0.2)), 36);
const bolt = M.exp(-M.abs(u - (0.3 + 0.4 * M.sin(t * 0.31))) * 7);
const rain = M.pow(M.max(0, M.sin(v * 9 - t * 6 + k.rnd * 6.283)), 6) * 0.4;
const city = M.exp(-M.pow((v - 0.86) * 5, 2)) * (0.3 + 0.7 * k.rnd);
return [228, 46 - strike * 30, 5 + rain * 13 + city * 16 + strike * bolt * 62 + k.press * 26];

WHEN TO ALSO RETURN A LAYOUT

If the idea names an application, a workflow, a role, or a set of controls — a presentation remote, a streaming deck, a code review deck, a kitchen timer, a DJ rig — also return a "layout": one icon per key, row-major, exactly ${grid.cols * grid.rows} entries.

If the idea is a mood, a scene, a texture or a feeling, omit "layout" entirely. A thunderstorm does not need buttons.

When you do return a layout, deliberately make the field quieter: slower, lower contrast, lightness mostly under 30. The animation is now a backdrop for white glyphs and must not compete with them.

THE ICON VOCABULARY

Use only these names. They are real icons and they will render exactly as drawn. Do not invent names, do not describe shapes, and never write SVG.

${VOCABULARY_TEXT}

Use "blank" for a key that shows only the animation.

LAYING OUT KEYS

- ${grid.cols} x ${grid.rows} is a small space. Blank keys are structure, not waste — a wall of ${grid.cols * grid.rows} icons is unreadable. Six to ten meaningful keys is usually right.
- Group by function and separate by role: navigation reads as a row, a destructive or live action sits away from what it could be confused with.
- Give the primary action the strongest position and an accent colour. Use accent on two or three keys at most, or it stops meaning anything.
- Label only when the glyph alone is ambiguous. "play" and "chevron-right" need no caption; "Blank Screen" and "Cue 3" do. Ten characters maximum.
- A badge qualifies a glyph: "monitor" badged with "play" reads as "start presenting" more clearly than either alone.
- Write a "note" on every non-blank key saying what it does.

A GOOD LAYOUT, for a presentation remote on 5 x 3:

row 1: blank | chevron-left "Prev" | presentation badge:play accent:#4DE8C2 note:"Start presenting" | chevron-right "Next" | blank
row 2: timer "Timer" | file-text "Notes" | mouse-pointer-2 "Laser" | square "Blank" | maximize "Full"
row 3: blank | volume-2 | mic | blank | x "Exit" accent:#FF6B6B

Note what that does: the two keys you press constantly are the largest gesture in the middle row of the top band, the exit is alone in a corner, and nine of fifteen keys carry something.

Answer only with the JSON object.`;

/** The wire format: a Dream, optionally wearing a Layout. */
const SCENE_SCHEMA = {
  type: 'OBJECT',
  properties: { ...RESPONSE_SCHEMA.properties, layout: LAYOUT_SCHEMA },
  required: RESPONSE_SCHEMA.required,
  propertyOrdering: [...RESPONSE_SCHEMA.propertyOrdering, 'layout'],
};

interface Part { text?: string }
interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  error?: { message?: string; status?: string };
  promptFeedback?: { blockReason?: string };
}

function describeHttpError(status: number, message: string): string {
  if (status === 400 && /API key not valid/i.test(message)) return 'That API key was rejected. Check it in Settings.';
  if (status === 400) return `Gemini rejected the request: ${message}`;
  if (status === 403) return 'That API key is not allowed to use this model.';
  if (status === 404) return 'That model name does not exist. Try another in Settings.';
  if (status === 429) return 'Gemini is rate limiting. Wait a moment and try again.';
  if (status >= 500) return 'Gemini is having a moment. Try again.';
  return message || `Gemini returned ${status}.`;
}

async function call(apiKey: string, model: string, body: unknown): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach Gemini. Check your connection.');
  }

  const data = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) throw new Error(describeHttpError(res.status, data.error?.message ?? ''));

  if (data.promptFeedback?.blockReason) throw new Error(`Gemini declined that idea (${data.promptFeedback.blockReason}). Try describing it differently.`);

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('Gemini returned nothing. Try again.');
  return text;
}

type Turn = { role: 'user' | 'model'; parts: { text: string }[] };

export interface ConjureOptions {
  apiKey: string;
  model: string;
  grid: Grid;
  /** An existing scene to evolve rather than replace. */
  basis?: Scene | undefined;
  /** Called on each repair attempt, so the UI can stay honest about what is happening. */
  onRepair?: (attempt: number, problem: string) => void;
}

const MAX_REPAIRS = 2;

/**
 * Turns a description into a validated Scene. If the model returns a field
 * that will not compile, or an icon that does not exist, the failure is handed
 * back to it verbatim and it gets to try again — nothing invalid ever reaches
 * the renderer.
 */
export async function conjure(idea: string, opts: ConjureOptions): Promise<Scene> {
  const { apiKey, model, grid, basis, onRepair } = opts;
  if (!apiKey) throw new Error('Add a Gemini API key in Settings first.');

  const opening = basis
    ? `Here is what is currently playing, named "${basis.dream.name}" (${basis.dream.vibe}):\n\n${basis.dream.field}\n\n${
        basis.layout
          ? `It wears the layout "${basis.layout.name}": ${basis.layout.keys.map((k) => k.icon).join(' ')}\n\n`
          : ''
      }Evolve it according to this note, keeping what makes it recognisable: ${idea}`
    : idea;

  const turns: Turn[] = [{ role: 'user', parts: [{ text: opening }] }];
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const text = await call(apiKey, model, {
      systemInstruction: { parts: [{ text: SYSTEM(grid) }] },
      contents: turns,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCENE_SCHEMA,
        temperature: attempt === 0 ? 1.15 : 0.4,
        candidateCount: 1,
      },
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
      lastError = 'the response was not valid JSON';
    }

    if (parsed) {
      try {
        const raw = parsed as { layout?: unknown };
        const dream = await validate({ ...(raw as object), prompt: idea }, grid.cols, grid.rows);
        const layout: LayoutSpec | null = raw.layout
          ? validateLayout(raw.layout, grid.cols * grid.rows)
          : null;
        return { dream, layout };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (attempt === MAX_REPAIRS) break;
    onRepair?.(attempt + 1, lastError);
    turns.push({ role: 'model', parts: [{ text }] });
    turns.push({
      role: 'user',
      parts: [{ text: `The engine rejected that: ${lastError}\n\nFix it and return the whole object again, keeping the same idea and the same feel.` }],
    });
  }

  throw new Error(`Gemini could not produce something valid (${lastError}). Try wording the idea differently.`);
}

interface ModelList { models?: { name?: string; supportedGenerationMethods?: string[] }[] }

/**
 * Asks the key which models it can actually use, so the app picks up new
 * Gemini releases without a code change.
 */
export async function listFlashModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${ENDPOINT}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const body = (await res.json().catch(() => ({}))) as ModelList & GeminiResponse;
  if (!res.ok) throw new Error(describeHttpError(res.status, body.error?.message ?? ''));
  const data = body;
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((n) => n.includes('flash') && !n.includes('embedding'))
    .sort();
}
