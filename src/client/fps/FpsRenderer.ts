// WebGL2 renderer for the FPS mode: sky, terrain (with territory colors from
// the capture points, like the strategy map), water, instanced lit boxes for
// soldiers/buildings/trees, billboard particles, tracers and the first-person
// weapon. No dependencies.

import { FpsTerrain, WATER_LEVEL } from "./FpsTerrain";
import { invert, Mat4, mat4, multiply } from "./FpsMath";

export const MAX_POINTS = 32;
/** Floats per box instance: a 4x4 matrix and an RGBA color. */
export const BOX_STRIDE = 20;
/** Floats per sprite: position, size (negative = additive), RGBA. */
export const SPRITE_STRIDE = 8;
/** Floats per tracer: start, end, width, RGBA. */
export const TRACER_STRIDE = 11;

export interface PointVisual {
  x: number;
  z: number;
  radius: number;
  color: [number, number, number];
}

export interface FrameInput {
  view: Mat4;
  proj: Mat4;
  cam: [number, number, number];
  time: number;
  points: PointVisual[];
  boxes: Float32Array;
  boxCount: number;
  decals: Float32Array;
  decalCount: number;
  sprites: Float32Array;
  spriteCount: number;
  tracers: Float32Array;
  tracerCount: number;
  viewProj2: Mat4;
  viewBoxes: Float32Array;
  viewBoxCount: number;
  /** 0..1: how red the screen edges are (damage). Drawn by the HUD. */
}

const SKY_HORIZON: [number, number, number] = [0.74, 0.83, 0.9];
const SKY_ZENITH: [number, number, number] = [0.33, 0.55, 0.83];
const SUN = normalize3([0.45, 0.75, 0.35]);

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

const TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNormal;
void main() {
  vPos = aPos;
  vNormal = aNormal;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const COMMON_FS = `
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 col, vec3 pos) {
  float d = length(pos - uCam) * uFogDensity;
  float f = 1.0 - exp(-d * d);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNormal;
uniform int uNumPoints;
uniform vec4 uPoints[${MAX_POINTS}];
uniform vec3 uPointColors[${MAX_POINTS}];
uniform float uTime;
out vec4 frag;
${COMMON_FS}
void main() {
  vec3 n = normalize(vNormal);
  float slope = 1.0 - n.y;
  float nz = vnoise(vPos.xz * 0.11) * 0.6 + vnoise(vPos.xz * 0.6) * 0.4;
  vec3 grass = mix(vec3(0.26, 0.43, 0.17), vec3(0.38, 0.53, 0.22), nz);
  vec3 dirt = mix(vec3(0.42, 0.34, 0.24), vec3(0.5, 0.41, 0.29), nz);
  vec3 rock = mix(vec3(0.36, 0.35, 0.34), vec3(0.52, 0.5, 0.47), nz);
  vec3 sand = vec3(0.74, 0.68, 0.5);
  vec3 col = grass;
  col = mix(col, dirt, smoothstep(0.22, 0.42, slope + nz * 0.12));
  col = mix(col, rock, smoothstep(0.42, 0.65, slope));
  col = mix(col, sand, 1.0 - smoothstep(0.5, 1.5, vPos.y));
  col = mix(col, rock * 0.8, smoothstep(17.0, 23.0, vPos.y));

  if (uNumPoints > 0 && vPos.y > -0.3 && vPos.y < 21.0) {
    float d1 = 1e9;
    float d2 = 1e9;
    int i1 = 0;
    int i2 = 0;
    for (int i = 0; i < ${MAX_POINTS}; i++) {
      if (i >= uNumPoints) break;
      float d = distance(vPos.xz, uPoints[i].xy);
      if (d < d1) { d2 = d1; i2 = i1; d1 = d; i1 = i; }
      else if (d < d2) { d2 = d; i2 = i; }
    }
    vec3 tc = uPointColors[i1];
    col = mix(col, tc, 0.2);
    // Borders only where two different owners meet.
    if (distance(uPointColors[i1], uPointColors[i2]) > 0.01) {
      float edge = d2 - d1;
      col = mix(col, tc * 1.15 + 0.08, (1.0 - smoothstep(0.0, 1.6, edge)) * 0.75);
    }
    float r = uPoints[i1].z;
    float ring = 1.0 - smoothstep(0.0, 0.45, abs(d1 - r));
    float pulse = 0.55 + 0.45 * sin(uTime * 3.0 - d1 * 0.4);
    col = mix(col, mix(tc, vec3(1.0), 0.5), ring * pulse);
    // Inside the circle: a lighter floor.
    col = mix(col, tc * 0.6 + 0.35, (1.0 - smoothstep(r - 0.6, r, d1)) * 0.18);
  }
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 lit = col * (0.4 + 0.78 * diff);
  frag = vec4(applyFog(lit, vPos), 1.0);
}`;

const WATER_VS = `#version 300 es
layout(location=0) in vec2 aXZ;
uniform mat4 uViewProj;
uniform float uLevel;
out vec3 vPos;
void main() {
  vPos = vec3(aXZ.x, uLevel, aXZ.y);
  gl_Position = uViewProj * vec4(vPos, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vPos;
uniform float uTime;
out vec4 frag;
${COMMON_FS}
void main() {
  vec2 p = vPos.xz * 0.35;
  float w1 = vnoise(p + vec2(uTime * 0.6, uTime * 0.3));
  float w2 = vnoise(p * 2.3 - vec2(uTime * 0.4, -uTime * 0.5));
  vec3 n = normalize(vec3((w1 - 0.5) * 0.35, 1.0, (w2 - 0.5) * 0.35));
  vec3 v = normalize(uCam - vPos);
  vec3 h = normalize(v + uSunDir);
  float spec = pow(max(dot(n, h), 0.0), 90.0) * 1.4;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 deep = vec3(0.05, 0.22, 0.33);
  vec3 sky = vec3(0.6, 0.75, 0.88);
  vec3 col = mix(deep, sky, fres * 0.7) + spec;
  frag = vec4(applyFog(col, vPos), 0.82);
}`;

const SKY_VS = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uTime;
out vec4 frag;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCam);
  float t = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.6));
  float s = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.92, 0.7) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
  if (dir.y > 0.02) {
    // A layer of drifting clouds, thinning toward the horizon.
    vec2 uv = dir.xz / dir.y * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
    float c = smoothstep(0.5, 0.82, fbm(uv));
    float fade = smoothstep(0.02, 0.25, dir.y);
    vec3 cloud = mix(vec3(0.82, 0.85, 0.9), vec3(1.0), smoothstep(0.5, 0.9, fbm(uv + 0.3)));
    col = mix(col, cloud, c * fade * 0.85);
  }
  if (dir.y < 0.0) col = mix(uHorizon, uHorizon * 0.85, clamp(-dir.y * 3.0, 0.0, 1.0));
  frag = vec4(col, 1.0);
}`;

const BOX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 iM0;
layout(location=3) in vec4 iM1;
layout(location=4) in vec4 iM2;
layout(location=5) in vec4 iM3;
layout(location=6) in vec4 iColor;
uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
out float vShade;
void main() {
  mat4 m = mat4(iM0, iM1, iM2, iM3);
  vec4 w = m * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(m) * aNormal;
  vColor = iColor;
  vShade = aPos.y + 0.5;
  gl_Position = uViewProj * w;
}`;

const BOX_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
in float vShade;
out vec4 frag;
${COMMON_FS}
void main() {
  // Alpha above 1.5 marks an unlit (glowing) instance.
  if (vColor.a > 1.5) {
    frag = vec4(vColor.rgb, vColor.a - 2.0);
    return;
  }
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 col = vColor.rgb * (0.46 + 0.7 * diff) * (0.78 + 0.22 * vShade);
  frag = vec4(applyFog(col, vWorld), vColor.a);
}`;

const SPRITE_VS = `#version 300 es
layout(location=0) in vec4 iPosSize;
layout(location=1) in vec4 iColor;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out vec4 vColor;
out float vAdd;
void main() {
  vec2 c = vec2(gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4 ? 1.0 : -1.0,
                gl_VertexID == 2 || gl_VertexID == 4 || gl_VertexID == 5 ? 1.0 : -1.0);
  float size = abs(iPosSize.w);
  vec3 p = iPosSize.xyz + (uRight * c.x + uUp * c.y) * size;
  vUv = c;
  vColor = iColor;
  vAdd = iPosSize.w < 0.0 ? 1.0 : 0.0;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
in float vAdd;
out vec4 frag;
void main() {
  float r = length(vUv);
  float a = vColor.a * (1.0 - smoothstep(0.35, 1.0, r));
  if (a <= 0.003) discard;
  // Premultiplied: additive sprites write no alpha.
  frag = vec4(vColor.rgb * a, vAdd > 0.5 ? 0.0 : a);
}`;

const TRACER_VS = `#version 300 es
layout(location=0) in vec3 iA;
layout(location=1) in vec3 iB;
layout(location=2) in float iWidth;
layout(location=3) in vec4 iColor;
uniform mat4 uViewProj;
uniform vec3 uCam;
out float vSide;
out float vAlong;
out vec4 vColor;
void main() {
  int v = gl_VertexID;
  float along = (v == 1 || v == 2 || v == 4) ? 1.0 : 0.0;
  float side = (v == 2 || v == 4 || v == 5) ? 1.0 : -1.0;
  vec3 p = mix(iA, iB, along);
  vec3 dir = normalize(iB - iA + vec3(1e-5));
  vec3 s = normalize(cross(dir, p - uCam) + vec3(1e-5)) * iWidth;
  vSide = side;
  vAlong = along;
  vColor = iColor;
  gl_Position = uViewProj * vec4(p + s * side, 1.0);
}`;

const TRACER_FS = `#version 300 es
precision highp float;
in float vSide;
in float vAlong;
in vec4 vColor;
out vec4 frag;
void main() {
  float a = vColor.a * (1.0 - abs(vSide)) * (0.35 + 0.65 * vAlong);
  frag = vec4(vColor.rgb * a, 0.0);
}`;

function compile(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`FPS shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`FPS program: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function uniforms(
  gl: WebGL2RenderingContext,
  p: WebGLProgram,
  names: string[],
): Uniforms {
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

const CUBE = (() => {
  // 6 faces x 2 triangles, position + normal.
  const faces: [number[], number[], number[], number[]][] = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
      [-1, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
      [0, -1, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 0],
      [-1, 0, 0],
      [0, 0, 1],
    ],
    [
      [0, 0, -1],
      [0, 1, 0],
      [1, 0, 0],
      [0, 0, -1],
    ],
  ];
  const out: number[] = [];
  for (const [n, u, r] of faces) {
    const c = n.map((v) => v * 0.5);
    const corner = (a: number, b: number) => [
      c[0] + (u[0] * a + r[0] * b) * 0.5,
      c[1] + (u[1] * a + r[1] * b) * 0.5,
      c[2] + (u[2] * a + r[2] * b) * 0.5,
    ];
    const quad = [
      corner(-1, -1),
      corner(-1, 1),
      corner(1, 1),
      corner(-1, -1),
      corner(1, 1),
      corner(1, -1),
    ];
    for (const q of quad) out.push(q[0], q[1], q[2], n[0], n[1], n[2]);
  }
  return new Float32Array(out);
})();

export class FpsRenderer {
  readonly gl: WebGL2RenderingContext;
  private terrainProg: WebGLProgram;
  private waterProg: WebGLProgram;
  private skyProg: WebGLProgram;
  private boxProg: WebGLProgram;
  private spriteProg: WebGLProgram;
  private tracerProg: WebGLProgram;
  private uT: Uniforms;
  private uW: Uniforms;
  private uS: Uniforms;
  private uB: Uniforms;
  private uSp: Uniforms;
  private uTr: Uniforms;
  private terrainVao: WebGLVertexArrayObject | null = null;
  private terrainCount = 0;
  private waterVao: WebGLVertexArrayObject | null = null;
  private emptyVao: WebGLVertexArrayObject;
  private boxVao: WebGLVertexArrayObject;
  private boxInst: WebGLBuffer;
  private staticVao: WebGLVertexArrayObject;
  private staticInst: WebGLBuffer;
  private staticCount = 0;
  private spriteVao: WebGLVertexArrayObject;
  private spriteInst: WebGLBuffer;
  private tracerVao: WebGLVertexArrayObject;
  private tracerInst: WebGLBuffer;
  private viewProj = mat4();
  private inv = mat4();
  private fogColor: [number, number, number] = SKY_HORIZON;
  fogDensity = 0.0042;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.terrainProg = compile(gl, TERRAIN_VS, TERRAIN_FS);
    this.waterProg = compile(gl, WATER_VS, WATER_FS);
    this.skyProg = compile(gl, SKY_VS, SKY_FS);
    this.boxProg = compile(gl, BOX_VS, BOX_FS);
    this.spriteProg = compile(gl, SPRITE_VS, SPRITE_FS);
    this.tracerProg = compile(gl, TRACER_VS, TRACER_FS);
    const common = [
      "uViewProj",
      "uCam",
      "uSunDir",
      "uFogColor",
      "uFogDensity",
      "uTime",
    ];
    this.uT = uniforms(gl, this.terrainProg, [
      ...common,
      "uNumPoints",
      "uPoints",
      "uPointColors",
    ]);
    this.uW = uniforms(gl, this.waterProg, [...common, "uLevel"]);
    this.uS = uniforms(gl, this.skyProg, [
      "uInvViewProj",
      "uCam",
      "uSunDir",
      "uHorizon",
      "uZenith",
      "uTime",
    ]);
    this.uB = uniforms(gl, this.boxProg, common);
    this.uSp = uniforms(gl, this.spriteProg, ["uViewProj", "uRight", "uUp"]);
    this.uTr = uniforms(gl, this.tracerProg, ["uViewProj", "uCam"]);

    this.emptyVao = gl.createVertexArray()!;

    const cubeBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
    const makeBoxVao = (inst: WebGLBuffer) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      for (let i = 0; i < 5; i++) {
        gl.enableVertexAttribArray(2 + i);
        gl.vertexAttribPointer(
          2 + i,
          4,
          gl.FLOAT,
          false,
          BOX_STRIDE * 4,
          i * 16,
        );
        gl.vertexAttribDivisor(2 + i, 1);
      }
      gl.bindVertexArray(null);
      return vao;
    };
    this.boxInst = gl.createBuffer()!;
    this.boxVao = makeBoxVao(this.boxInst);
    this.staticInst = gl.createBuffer()!;
    this.staticVao = makeBoxVao(this.staticInst);

    this.spriteInst = gl.createBuffer()!;
    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInst);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, SPRITE_STRIDE * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, SPRITE_STRIDE * 4, 16);
    gl.vertexAttribDivisor(1, 1);

    this.tracerInst = gl.createBuffer()!;
    this.tracerVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.tracerVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerInst);
    const tb = TRACER_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, tb, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, tb, 12);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, tb, 24);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, tb, 28);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
  }

  setTerrain(t: FpsTerrain): void {
    const gl = this.gl;
    const n = t.gw * t.gh;
    const data = new Float32Array(n * 6);
    for (let j = 0; j < t.gh; j++) {
      for (let i = 0; i < t.gw; i++) {
        const k = j * t.gw + i;
        const h = t.heights[k];
        const hl = t.heights[j * t.gw + Math.max(0, i - 1)];
        const hr = t.heights[j * t.gw + Math.min(t.gw - 1, i + 1)];
        const hd = t.heights[Math.max(0, j - 1) * t.gw + i];
        const hu = t.heights[Math.min(t.gh - 1, j + 1) * t.gw + i];
        let nx = hl - hr;
        let ny = 2 * t.cell;
        let nz = hd - hu;
        const l = Math.hypot(nx, ny, nz);
        nx /= l;
        ny /= l;
        nz /= l;
        data.set([i * t.cell, h, j * t.cell, nx, ny, nz], k * 6);
      }
    }
    const idx = new Uint32Array((t.gw - 1) * (t.gh - 1) * 6);
    let q = 0;
    for (let j = 0; j < t.gh - 1; j++) {
      for (let i = 0; i < t.gw - 1; i++) {
        const a = j * t.gw + i;
        const b = a + 1;
        const c = a + t.gw;
        const d = c + 1;
        idx[q++] = a;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = d;
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.terrainVao = vao;
    this.terrainCount = idx.length;

    // Water: one big quad reaching well past the map.
    const m = 2000;
    const w = new Float32Array([
      -m,
      -m,
      t.sizeX + m,
      -m,
      -m,
      t.sizeZ + m,
      t.sizeX + m,
      t.sizeZ + m,
    ]);
    const wvao = gl.createVertexArray()!;
    gl.bindVertexArray(wvao);
    const wb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wb);
    gl.bufferData(gl.ARRAY_BUFFER, w, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    this.waterVao = wvao;
  }

  /** Buildings, trees and other things that never move. */
  setStatic(boxes: Float32Array, count: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticInst);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      boxes.subarray(0, count * BOX_STRIDE),
      gl.STATIC_DRAW,
    );
    this.staticCount = count;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private setCommon(
    u: Uniforms,
    cam: [number, number, number],
    time: number,
    sun = SUN,
    fog = this.fogDensity,
  ): void {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform3f(u.uCam, cam[0], cam[1], cam[2]);
    gl.uniform3f(u.uSunDir, sun[0], sun[1], sun[2]);
    gl.uniform3f(
      u.uFogColor,
      this.fogColor[0],
      this.fogColor[1],
      this.fogColor[2],
    );
    gl.uniform1f(u.uFogDensity, fog);
    if (u.uTime) gl.uniform1f(u.uTime, time);
  }

  private drawBoxes(
    vao: WebGLVertexArrayObject,
    buf: WebGLBuffer | null,
    data: Float32Array | null,
    count: number,
  ): void {
    if (count <= 0) return;
    const gl = this.gl;
    if (buf && data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        data.subarray(0, count * BOX_STRIDE),
        gl.DYNAMIC_DRAW,
      );
    }
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);
  }

  render(f: FrameInput): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    multiply(this.viewProj, f.proj, f.view);
    gl.clearColor(SKY_HORIZON[0], SKY_HORIZON[1], SKY_HORIZON[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.skyProg);
    invert(this.inv, this.viewProj);
    gl.uniformMatrix4fv(this.uS.uInvViewProj, false, this.inv);
    gl.uniform3f(this.uS.uCam, f.cam[0], f.cam[1], f.cam[2]);
    gl.uniform3f(this.uS.uSunDir, SUN[0], SUN[1], SUN[2]);
    gl.uniform3f(
      this.uS.uHorizon,
      SKY_HORIZON[0],
      SKY_HORIZON[1],
      SKY_HORIZON[2],
    );
    gl.uniform3f(this.uS.uZenith, SKY_ZENITH[0], SKY_ZENITH[1], SKY_ZENITH[2]);
    gl.uniform1f(this.uS.uTime, f.time);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);

    // Terrain.
    if (this.terrainVao) {
      gl.useProgram(this.terrainProg);
      this.setCommon(this.uT, f.cam, f.time);
      const n = Math.min(MAX_POINTS, f.points.length);
      const pts = new Float32Array(MAX_POINTS * 4);
      const cols = new Float32Array(MAX_POINTS * 3);
      for (let i = 0; i < n; i++) {
        const p = f.points[i];
        pts.set([p.x, p.z, p.radius, 0], i * 4);
        cols.set(p.color, i * 3);
      }
      gl.uniform1i(this.uT.uNumPoints, n);
      gl.uniform4fv(this.uT.uPoints, pts);
      gl.uniform3fv(this.uT.uPointColors, cols);
      gl.bindVertexArray(this.terrainVao);
      gl.drawElements(gl.TRIANGLES, this.terrainCount, gl.UNSIGNED_INT, 0);
    }

    // Opaque boxes: static scenery, then everything that moves.
    gl.useProgram(this.boxProg);
    this.setCommon(this.uB, f.cam, f.time);
    gl.disable(gl.CULL_FACE);
    this.drawBoxes(this.staticVao, null, null, this.staticCount);
    this.drawBoxes(this.boxVao, this.boxInst, f.boxes, f.boxCount);

    // Transparent: water, blob shadows, particles, tracers.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (this.waterVao) {
      gl.useProgram(this.waterProg);
      this.setCommon(this.uW, f.cam, f.time);
      gl.uniform1f(this.uW.uLevel, WATER_LEVEL);
      gl.bindVertexArray(this.waterVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (f.decalCount > 0) {
      gl.useProgram(this.boxProg);
      this.setCommon(this.uB, f.cam, f.time);
      this.drawBoxes(this.boxVao, this.boxInst, f.decals, f.decalCount);
    }
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (f.spriteCount > 0) {
      gl.useProgram(this.spriteProg);
      gl.uniformMatrix4fv(this.uSp.uViewProj, false, this.viewProj);
      // Camera right/up from the view matrix rows.
      gl.uniform3f(this.uSp.uRight, f.view[0], f.view[4], f.view[8]);
      gl.uniform3f(this.uSp.uUp, f.view[1], f.view[5], f.view[9]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteInst);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        f.sprites.subarray(0, f.spriteCount * SPRITE_STRIDE),
        gl.DYNAMIC_DRAW,
      );
      gl.bindVertexArray(this.spriteVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, f.spriteCount);
    }
    if (f.tracerCount > 0) {
      gl.useProgram(this.tracerProg);
      gl.uniformMatrix4fv(this.uTr.uViewProj, false, this.viewProj);
      gl.uniform3f(this.uTr.uCam, f.cam[0], f.cam[1], f.cam[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tracerInst);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        f.tracers.subarray(0, f.tracerCount * TRACER_STRIDE),
        gl.DYNAMIC_DRAW,
      );
      gl.bindVertexArray(this.tracerVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, f.tracerCount);
    }
    gl.depthMask(true);

    // First-person weapon on top of everything, in its own depth range.
    if (f.viewBoxCount > 0) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(this.boxProg);
      const saved = this.viewProj;
      this.viewProj = f.viewProj2;
      this.setCommon(
        this.uB,
        [0, 0, 0],
        f.time,
        normalize3([-0.3, 0.8, 0.5]),
        0,
      );
      this.viewProj = saved;
      this.drawBoxes(this.boxVao, this.boxInst, f.viewBoxes, f.viewBoxCount);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}
