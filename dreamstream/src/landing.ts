/**
 * How a new dream lands on the panel.
 *
 * The engine renders the field on the CPU because a field is a tiny function
 * and fifteen keys are not many pixels. A landing is different: it is a few
 * seconds of smoke, liquid, embers and dust across the whole panel, and that
 * is a fragment shader's job. So a landing is one WebGL2 program that takes
 * two pictures — the panel as it was, and the panel as it is becoming — and
 * decides, per pixel and per moment, what is between them.
 *
 * There is one landing so far, the Cauldron. Its timeline has two halves:
 *
 *   stir     the old keys crouch, then hop and juggle over a brew that swirls
 *            them into itself, coals glowing underneath, smoke rising. This
 *            half can be *held* — while Gemini is thinking, the panel simply
 *            keeps stirring — or it runs for STIR_SECONDS on its own.
 *   release  the tiles burn away at the edges and sink; the new layout drops
 *            from above, slams flat with a squash and a flash, and a ring of
 *            dust bursts out and settles.
 *
 * Both ends are exact: at stir 0 the shader returns the old picture pixel for
 * pixel, and at the end of release it returns the new one. Nothing pops.
 *
 * The rules the note set — no straight lines, no simple geometry — are kept
 * by construction: every edge in here is a noise threshold, every motion is
 * a curve, and the only rectangle is the panel itself.
 */

export type LandingName = 'cauldron' | 'crossfade';

export const LANDINGS: Record<LandingName, { title: string; blurb: string }> = {
  cauldron: {
    title: 'Cauldron',
    blurb:
      'The keys you have crouch, hop and juggle over a swirling brew, coals smouldering beneath, then burn away at the edges. The new ones fall flat like a heavy tile, in a cloud of dust that settles.',
  },
  crossfade: {
    title: 'Crossfade',
    blurb: 'A quiet dissolve, under a second.',
  },
};

/** How long the stir runs before releasing on its own, when nothing holds it. */
export const STIR_SECONDS = 1.7;
/** Break-down, fall, slam and settling dust, measured from release. */
export const RELEASE_SECONDS = 2.75;

/** Pixels per key in the panel picture a landing works on. The preview keys are this size exactly. */
export const LANDING_KEY_PX = 96;

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the clip space; the fragment shader does the rest.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 o;

uniform sampler2D uFrom;   // the panel as it was
uniform sampler2D uTo;     // the panel as it is becoming, live
uniform vec2  uRes;        // output size in pixels
uniform vec2  uGrid;       // cols, rows
uniform float uStir;       // seconds since the landing began
uniform float uRel;        // seconds since release; negative while held
uniform float uSeed;       // a fresh number per landing, so no two are alike
uniform vec3  uPalA[4];    // palette of the dream leaving
uniform vec3  uPalB[4];    // palette of the dream arriving

const float PI = 3.14159265;

// --- noise ---------------------------------------------------------------

float h1(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2  h2(vec2 p) { float a = h1(p); return vec2(a, h1(p + a + 7.1)); }
float h3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.23)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

/** Five octaves, each turned a little so nothing lines up with an axis. Roughly 0..1, mostly 0.25..0.75. */
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    p.xy = mat2(0.8, 0.6, -0.6, 0.8) * p.xy;
    a *= 0.5;
  }
  return s / 0.96875;
}

// --- helpers -------------------------------------------------------------

vec3 from(vec2 uv) { return texture(uFrom, clamp(uv, 0.002, 0.998)).rgb; }
vec3 to(vec2 uv)   { return texture(uTo,   clamp(uv, 0.002, 0.998)).rgb; }

/** Black, deep red, orange, pale yellow: the colours a coal goes through. */
vec3 coalRamp(float x) {
  vec3 a = vec3(0.03, 0.005, 0.0), b = vec3(0.65, 0.09, 0.01), c = vec3(1.0, 0.55, 0.12), d = vec3(1.0, 0.9, 0.55);
  return x < 0.5 ? mix(a, b, x * 2.0) : x < 0.8 ? mix(b, c, (x - 0.5) / 0.3) : mix(c, d, (x - 0.8) / 0.2);
}

/** Toward old brass: luminance kept, colour warmed. The steampunk in the recipe. */
vec3 brass(vec3 c, float amt) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(0.9, 0.64, 0.3) * (l * 1.1 + 0.03), amt);
}

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }

void main() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);  // image space, y down
  vec2 asp = vec2(uGrid.x / uGrid.y, 1.0);
  vec2 a = (uv - 0.5) * asp;                                                // centred, aspect-true
  float r = length(a);
  float t = uStir;

  // --- timing -----------------------------------------------------------
  float antic  = smoothstep(0.0, 0.4, t);                          // the crouch before the hop
  float brew   = smoothstep(0.3, 1.7, t);                          // how far into the cauldron we are
  float on     = step(0.0, uRel);                                  // released?
  float rel    = max(uRel, 0.0);
  float melt   = on * smoothstep(0.0, 1.1, rel);                   // tiles burning away, the last embers under the falling tile
  float fall   = on * clamp((rel - 0.5) / 0.65, 0.0, 1.0);         // the new tile on its way down
  float drop   = fall * fall;                                      // gravity: slow start, hard finish
  float landed = on * step(1.15, rel);
  float since  = on * max(0.0, rel - 1.15);                        // seconds since the slam
  float calm   = 1.0 - smoothstep(0.95, 1.6, since);               // the last of the dust leaving

  // --- coals, under everything -----------------------------------------
  float cn   = fbm(vec3(uv * asp * 4.5 + uSeed, t * 0.35));
  float bed  = 0.4 + 0.6 * uv.y;                                   // hotter toward the bottom
  float pulse = 0.72 + 0.28 * sin(t * 2.1 + cn * 9.0 + uv.x * 4.0);
  float heat = antic * (0.35 + 0.65 * brew) * bed * pulse;
  vec3 coals = coalRamp(heat * (0.22 + 0.85 * smoothstep(0.3, 0.75, cn))) * (0.5 + 0.5 * brew);

  // --- the brew: the old picture, swirled into itself --------------------
  vec2 warp = vec2(fbm(vec3(uv * 3.0, t * 0.25 + uSeed)), fbm(vec3(uv * 3.0 + 5.2, t * 0.25 - uSeed))) - 0.5;
  float twist = brew * (1.0 + 1.5 * melt) * (1.0 - smoothstep(0.0, 0.85, r)) * (1.6 + min(t, 12.0) * 0.5);
  vec2 la = rot(a, twist);
  vec3 liq = from(la / asp + 0.5 + warp * 0.22 * brew);
  liq = brass(liq, 0.55 * brew) * (0.62 - 0.12 * melt);
  float sheen = smoothstep(0.58, 0.8, fbm(vec3(uv * asp * 5.0 + warp * 2.0, t * 0.5)));
  liq += mix(vec3(1.0, 0.8, 0.5), uPalA[0], 0.3) * sheen * brew * 0.35;
  liq += coals * 0.35;
  float liqA = brew * 0.9;

  // --- the old keys: crouch, hop, juggle, half-sink, burn ---------------
  vec2 q  = uv * uGrid;
  vec2 ki = floor(q);
  vec2 f  = fract(q) - 0.5;
  float h  = h1(ki + uSeed * 0.37);
  float hb = h1(ki + 3.1 + uSeed);

  float cyc = fract(t * 0.5 + h);                                  // each key on its own beat
  float ph  = clamp((cyc - 0.05) / 0.4, 0.0, 1.0);
  float air = step(0.05, cyc) * step(cyc, 0.45);
  float hop = sin(PI * ph);
  float vel = cos(PI * ph) * air;                                  // +1 rising, -1 dropping
  float lift = hop * (0.28 + 0.2 * hb) * brew - melt * 0.15;       // sinks as it melts

  float crouch = 1.0 - 0.18 * antic * (1.0 - smoothstep(0.35, 0.9, t));
  float breath = sin(t * 3.0 + h * 6.28) * 0.05 * brew;
  float sy = crouch * (1.0 + 0.22 * abs(vel) * brew + breath);     // stretch in flight, squash at rest
  float sx = 1.0 / sy;                                             // volume is conserved, as any animator knows
  float spin = (h - 0.5) * 0.7 * hop * brew;

  vec2 c = f;
  c.y += lift;
  c = rot(c, spin);
  c = vec2(c.x / sx, c.y / sy);

  float smear = abs(vel) * brew * 0.06;                            // a smear frame along the motion
  vec3 tile = vec3(0.0);
  for (int i = -1; i <= 1; i++) tile += from((ki + c + vec2(0.0, float(i) * smear) + 0.5) / uGrid);
  tile /= 3.0;

  float en = fbm(vec3(q * 6.0, t * 0.6 + uSeed));
  float edge = 0.53 - brew * (0.05 + 0.06 * en);                   // the tile's edge, never straight once it moves
  float inside = smoothstep(edge + 0.012, edge - 0.012, max(abs(c.x), abs(c.y)));

  float bn = fbm(vec3(q * 1.6 + h * 7.0, t * 0.2)) + 0.15;
  float burn = melt * 1.25;
  float alive = smoothstep(burn - 0.04, burn + 0.04, bn);
  float rim = smoothstep(0.16, 0.0, abs(bn - burn)) * on * (1.0 - landed);

  tile = brass(tile, 0.35 * brew);
  tile = mix(tile, liq, 0.2 * brew);
  tile += coalRamp(0.82) * rim * 1.4;
  float tileA = inside * alive;

  // --- smoke ------------------------------------------------------------
  vec2 sp = uv * asp * vec2(2.2, 2.6) + vec2(0.0, t * 0.45);
  float sm = fbm(vec3(sp + warp * 0.6, t * 0.18 + uSeed));
  float rise = 0.5 + 0.5 * (1.0 - uv.y);
  float smokeA = min(0.85, smoothstep(0.42, 0.85, sm) * brew * (0.5 + 0.6 * melt) * rise * (1.0 - smoothstep(0.0, 0.45, since)));
  vec3 smoke = mix(vec3(0.62, 0.58, 0.55), uPalA[1], 0.22) * (0.55 + 0.45 * sm) + coals * 0.5;

  // --- embers -----------------------------------------------------------
  vec2 eg = uv * asp * 9.0 * (uGrid.y / 3.0) + vec2(0.0, t * 1.6);
  vec2 ec = floor(eg), ef = fract(eg);
  vec2 eh = h2(ec + uSeed);
  vec2 epos = 0.2 + 0.6 * eh + vec2(sin(t * 2.0 + eh.x * 20.0) * 0.12, 0.0);
  float lit = step(0.74, h1(ec * 1.7 + 2.3 + uSeed));
  float flick = 0.6 + 0.4 * sin(t * 9.0 + eh.y * 40.0);
  float ember = smoothstep(0.09 * (0.5 + eh.y), 0.0, length(ef - epos)) * lit * flick * brew * (1.0 - landed);
  vec3 emberCol = mix(vec3(1.0, 0.45, 0.08), vec3(1.0, 0.85, 0.45), eh.x) * ember * 1.6;

  // --- the new tile: falls, wobbles, slams, rings -------------------------
  float sc = mix(1.85, 1.0, drop);
  float spring = exp(-since * 6.0) * cos(since * 26.0) * 0.09 * landed;   // squash, then ring back
  vec2 shake = (vec2(fbm(vec3(since * 30.0, 1.3, uSeed)), fbm(vec3(2.7, since * 30.0, uSeed))) - 0.5)
             * 0.06 * exp(-since * 10.0) * landed;
  float wob = (1.0 - drop) * 0.10 * sin(uSeed * 6.0 + fall * 7.0);
  vec2 tc = rot(a / sc, wob);
  tc = vec2(tc.x / (1.0 + spring), tc.y / (1.0 - spring));
  vec2 tuv = tc / asp + 0.5 + shake;
  float blur = (1.0 - drop) * 0.025;                               // out of focus until it arrives
  vec3 toc = (to(tuv) + to(tuv + vec2(blur, 0.0)) + to(tuv - vec2(blur, 0.0)) + to(tuv + vec2(0.0, blur)) + to(tuv - vec2(0.0, blur))) / 5.0;
  toc *= 1.0 - (1.0 - drop) * 0.35;                                // its underside is in shade until it lands into the light
  float tn = fbm(vec3(uv * asp * 5.0, uSeed + 9.0));
  float tedge = 0.5 - (1.0 - drop) * 0.05 * tn;
  float tin = smoothstep(tedge + 0.01, tedge - 0.01, max(abs(tc.x) / asp.x, abs(tc.y)));
  float tileB = tin * smoothstep(0.08, 0.85, fall);                 // a ghost gaining substance as it nears
  float shadow = fall * 0.75 * (1.0 - landed);

  // --- the slam, and the dust it throws ----------------------------------
  float flash = exp(-since * 9.0) * landed * 0.55;
  vec3 flashCol = vec3(1.0, 0.92, 0.75) * flash;
  float ringR = since * 1.5;
  float dn = fbm(vec3(vec2(uv.x, uv.y - since * 0.45) * asp * 4.0, since * 0.6 + uSeed));
  float puff = smoothstep(0.45, 0.0, abs(r - ringR)) * exp(-since * 1.6);
  float haze = smoothstep(0.0, 0.5, since) * exp(-since * 1.2) * (0.3 + 0.7 * uv.y);
  float dustA = landed * clamp((puff * 1.2 + haze * 0.6) * smoothstep(0.3, 0.75, dn) * 1.4, 0.0, 0.9);
  vec3 dustCol = mix(vec3(0.72, 0.66, 0.58), uPalB[2], 0.25) * (0.7 + 0.5 * dn) + flashCol * 0.5;

  // --- compose ----------------------------------------------------------
  vec3 col = coals;
  col = mix(col, liq, liqA);
  col = mix(col, tile, tileA);
  col = mix(col, smoke, smokeA);
  col += emberCol;
  float rn = length((uv - 0.5) * 2.0);
  col *= 1.0 - 0.35 * brew * smoothstep(0.6, 1.4, rn);             // soot in the corners of the hut
  col *= 1.0 - shadow;
  col = mix(col, toc, tileB);
  col += flashCol * calm;
  col = mix(col, dustCol, dustA * calm);
  o = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** `#rrggbb` to 0..1 floats; anything else is a soft violet rather than an error. */
function rgb(hex: string | undefined): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? '');
  const n = m ? parseInt(m[1]!, 16) : 0x7c5cff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function paletteFloats(palette: readonly string[]): Float32Array {
  const out = new Float32Array(12);
  for (let i = 0; i < 4; i++) out.set(rgb(palette[i % Math.max(1, palette.length)]), i * 3);
  return out;
}

let supported: boolean | null = null;

/**
 * The Cauldron, as a WebGL2 program. One instance is enough: `begin` takes a
 * picture of the panel as it was, and `render` is called every frame with the
 * panel as it is becoming. The result is on `canvas`, which anyone can
 * drawImage from — the preview keys and the hardware both do.
 */
export class Cauldron {
  readonly canvas = document.createElement('canvas');
  #gl: WebGL2RenderingContext;
  #texFrom: WebGLTexture;
  #texTo: WebGLTexture;
  #u: Record<'res' | 'grid' | 'stir' | 'rel' | 'seed' | 'palA' | 'palB', WebGLUniformLocation | null>;
  #seed = 0;
  #lost = false;

  static get supported(): boolean {
    if (supported === null) {
      try {
        supported = !!document.createElement('canvas').getContext('webgl2');
      } catch {
        supported = false;
      }
    }
    return supported;
  }

  constructor() {
    // The drawing buffer is kept because the hardware reads it back after the
    // frame — one HID write per key, each a drawImage from this canvas.
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.#gl = gl;
    this.canvas.addEventListener('webglcontextlost', () => { this.#lost = true; });

    const program = gl.createProgram();
    if (!program) throw new Error('could not create a WebGL program');
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`landing shader failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.useProgram(program);

    this.#texFrom = makeTexture(gl);
    this.#texTo = makeTexture(gl);
    gl.uniform1i(gl.getUniformLocation(program, 'uFrom'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'uTo'), 1);
    this.#u = {
      res: gl.getUniformLocation(program, 'uRes'),
      grid: gl.getUniformLocation(program, 'uGrid'),
      stir: gl.getUniformLocation(program, 'uStir'),
      rel: gl.getUniformLocation(program, 'uRel'),
      seed: gl.getUniformLocation(program, 'uSeed'),
      palA: gl.getUniformLocation(program, 'uPalA[0]'),
      palB: gl.getUniformLocation(program, 'uPalB[0]'),
    };
  }

  /** True once the GPU has taken the context away; the owner should make a new one. */
  get lost(): boolean {
    return this.#lost;
  }

  /** Takes the picture of the panel as it was, and sizes the output to match. */
  begin(from: HTMLCanvasElement, cols: number, rows: number): void {
    const gl = this.#gl;
    if (this.canvas.width !== from.width || this.canvas.height !== from.height) {
      this.canvas.width = from.width;
      this.canvas.height = from.height;
    }
    gl.viewport(0, 0, from.width, from.height);
    gl.uniform2f(this.#u.res, from.width, from.height);
    gl.uniform2f(this.#u.grid, cols, rows);
    this.#seed = Math.random() * 100;
    gl.uniform1f(this.#u.seed, this.#seed);
    upload(gl, this.#texFrom, 0, from);
  }

  /**
   * One frame. `stir` is seconds since begin; `release` is seconds since the
   * stir was let go, or negative while it is still being held.
   */
  render(to: HTMLCanvasElement, stir: number, release: number, paletteFrom: readonly string[], paletteTo: readonly string[]): void {
    const gl = this.#gl;
    upload(gl, this.#texTo, 1, to);
    gl.uniform1f(this.#u.stir, stir);
    gl.uniform1f(this.#u.rel, release);
    gl.uniform3fv(this.#u.palA, paletteFloats(paletteFrom));
    gl.uniform3fv(this.#u.palB, paletteFloats(paletteTo));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`landing shader failed to compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
  }
  return shader;
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('could not create a texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function upload(gl: WebGL2RenderingContext, tex: WebGLTexture, unit: number, source: HTMLCanvasElement): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
}
