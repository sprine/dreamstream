import { FIELD_DOC, RESPONSE_SCHEMA, validate, type Dream } from './contract';

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

Answer only with the JSON object.`;

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
  /** An existing dream to evolve rather than replace. */
  basis?: Dream | undefined;
  /** Called on each repair attempt, so the UI can stay honest about what is happening. */
  onRepair?: (attempt: number, problem: string) => void;
  signal?: AbortSignal | undefined;
}

const MAX_REPAIRS = 2;

/**
 * Turns a description into a validated Dream. If the model returns a field
 * that will not compile or will not terminate, the failure is handed back to
 * it verbatim and it gets to try again — a broken field never reaches the
 * renderer.
 */
export async function conjure(idea: string, opts: ConjureOptions): Promise<Dream> {
  const { apiKey, model, grid, basis, onRepair } = opts;
  if (!apiKey) throw new Error('Add a Gemini API key in Settings first.');

  const opening = basis
    ? `Here is the dream currently playing, named "${basis.name}" (${basis.vibe}):\n\n${basis.field}\n\nEvolve it according to this note, keeping what makes it recognisable: ${idea}`
    : idea;

  const turns: Turn[] = [{ role: 'user', parts: [{ text: opening }] }];
  let lastError = '';

  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const text = await call(apiKey, model, {
      systemInstruction: { parts: [{ text: SYSTEM(grid) }] },
      contents: turns,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
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
        const dream = await validate({ ...(parsed as object), prompt: idea }, grid.cols, grid.rows);
        return dream;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (attempt === MAX_REPAIRS) break;
    onRepair?.(attempt + 1, lastError);
    turns.push({ role: 'model', parts: [{ text }] });
    turns.push({
      role: 'user',
      parts: [{ text: `That field was rejected by the engine: ${lastError}\n\nFix it and return the whole Dream again. Keep the same idea and the same feel.` }],
    });
  }

  throw new Error(`Gemini could not write a working field (${lastError}). Try wording the idea differently.`);
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
