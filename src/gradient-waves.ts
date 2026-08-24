/**
 * Vanilla port of the React Bits `GradientWaves` component (TypeScript + CSS variant).
 *
 * The upstream component is React; this app is plain TypeScript, so the shader, uniforms and
 * lifecycle are reproduced here without React. Two deliberate differences from upstream:
 *
 * - Pointer parallax listens on `window`, not on the canvas. The background sits behind the page
 *   with `pointer-events: none`, so canvas-local listeners would never fire.
 * - `create()` returns null instead of throwing when WebGL2 is unavailable, so the caller can keep
 *   the static SVG fallback that ships in the markup.
 */
import { Mesh, Program, Renderer, Triangle } from 'ogl';

export type GradientWavesDetail = 'low' | 'medium' | 'high';

export interface GradientWavesOptions {
  horizonColor?: string;
  waveColor?: string;
  crestColor?: string;
  speed?: number;
  amplitude?: number;
  waveScale?: number;
  waveRatio?: number;
  swell?: number;
  turbulence?: number;
  tilt?: number;
  zoom?: number;
  height?: number;
  fogDepth?: number;
  detail?: GradientWavesDetail;
  brightness?: number;
  opacity?: number;
  mouseInteraction?: boolean;
  parallaxStrength?: number;
  grain?: boolean;
  grainIntensity?: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
}

function detailToSteps(detail: GradientWavesDetail): number {
  if (detail === 'low') return 40;
  if (detail === 'high') return 110;
  return 70;
}

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaveScale;
uniform float uWaveRatio;
uniform float uSwell;
uniform float uTurbulence;
uniform float uTilt;
uniform float uZoom;
uniform float uHeight;
uniform float uFogDepth;
uniform float uSteps;
uniform float uBrightness;
uniform float uOpacity;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec2 uMouse;
uniform float uParallax;
uniform bool uEnableMouse;
uniform vec3 uHorizonColor;
uniform vec3 uWaveColor;
uniform vec3 uCrestColor;
out vec4 fragColor;

const float MAX_DIST = 20000.0;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float plasma(vec3 r, vec2 freq, vec4 tc) {
  float mx = r.x + tc.x;
  mx += uSwell * sin((r.y + mx) / 20.0 + tc.y);
  float my = r.y - tc.z;
  my += uTurbulence * cos(r.x / 23.0 + tc.w);
  return r.z - (sin(mx * freq.x) * uAmplitude + sin(my * freq.y) * uAmplitude + uHeight);
}

float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc) {
  float dist = 0.0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= uSteps) break;
    float dscene = plasma(pos + dist * dir, freq, tc);
    if (abs(dscene) < 0.1) break;
    dist += 0.9 * dscene;
    if (!(abs(dist) < MAX_DIST)) return MAX_DIST;
  }
  return dist;
}

void main() {
  float T = iTime * uSpeed;
  vec2 freq = vec2(uWaveScale / 7.0, (uWaveScale * uWaveRatio) / 3.0);
  vec4 tc = vec4(T / 0.130, T / 0.810, T / 0.200, T / 0.710);
  float c, s;
  float vfov = (3.14159 / 2.3) / max(uZoom, 0.05);
  vec3 cam = vec3(0.0, 0.0, 30.0);
  vec2 uv = (gl_FragCoord.xy / iResolution.xy) - 0.5;
  uv.x *= iResolution.x / iResolution.y;
  uv.y *= -1.0;

  vec3 dir = vec3(0.0, 0.0, -1.0);
  float ulen = length(uv);
  float xrot = vfov * ulen;
  c = cos(xrot); s = sin(xrot);
  dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  vec2 nuv = ulen > 1e-5 ? uv / ulen : vec2(1.0, 0.0);
  c = nuv.x; s = nuv.y;
  dir = mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0) * dir;
  c = cos(uTilt); s = sin(uTilt);
  dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;

  if (uEnableMouse) {
    float yaw = (uMouse.x - 0.5) * uParallax * 0.4;
    float pitch = (uMouse.y - 0.5) * uParallax * 0.4;
    c = cos(yaw); s = sin(yaw);
    dir = mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c) * dir;
    c = cos(pitch); s = sin(pitch);
    dir = mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c) * dir;
  }

  float dist = raymarch(cam, dir, freq, tc);
  vec3 pos = cam + dist * dir;

  float t = clamp(uFogDepth / max(dist, 0.001), 0.0, 1.0);
  vec3 body = mix(uWaveColor, uCrestColor, clamp(pos.z * 0.08 + 0.5, 0.0, 1.0));
  vec3 col = mix(uHorizonColor, body, t);
  col *= uBrightness;
  col = clamp(col, 0.0, 1.0);

  float alpha = clamp(t, 0.0, 1.0) * uOpacity;
  if (uGrain > 0.5) {
    float g = hash21(gl_FragCoord.xy + mod(iTime, 64.0) * 11.0);
    alpha += (g - 0.5) * uGrainIntensity;
  }
  alpha = clamp(alpha, 0.0, 1.0);
  fragColor = vec4(col * alpha, alpha);
}
`;

/**
 * Mounts the animated wave field into `container`.
 * Returns a teardown function, or null when WebGL2 is unavailable.
 */
export function createGradientWaves(
  container: HTMLElement,
  options: GradientWavesOptions = {},
): (() => void) | null {
  const {
    horizonColor = '#5227FF',
    waveColor = '#FF9FFC',
    crestColor = '#FFFFFF',
    speed = 0.4,
    amplitude = 2.5,
    waveScale = 0.6,
    waveRatio = 0.9,
    swell = 35,
    turbulence = 20,
    tilt = 1.11,
    zoom = 1,
    height = 5.5,
    fogDepth = 15,
    detail = 'medium',
    brightness = 1,
    opacity = 1,
    mouseInteraction = true,
    parallaxStrength = 0.5,
    grain = true,
    grainIntensity = 0.05,
  } = options;

  let renderer: InstanceType<typeof Renderer>;
  try {
    renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    });
  } catch {
    return null;
  }

  const gl = renderer.gl;
  // ogl silently falls back to WebGL1, where this `#version 300 es` shader will not compile.
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }

  gl.clearColor(0, 0, 0, 0);
  const canvas = gl.canvas as HTMLCanvasElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const horizon = hexToRgb(horizonColor);
  const wave = hexToRgb(waveColor);
  const crest = hexToRgb(crestColor);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Float32Array([1, 1]) },
      uSpeed: { value: speed },
      uAmplitude: { value: amplitude },
      uWaveScale: { value: waveScale },
      uWaveRatio: { value: waveRatio },
      uSwell: { value: swell },
      uTurbulence: { value: turbulence },
      uTilt: { value: tilt },
      uZoom: { value: zoom },
      uHeight: { value: height },
      uFogDepth: { value: fogDepth },
      uSteps: { value: detailToSteps(detail) },
      uBrightness: { value: brightness },
      uOpacity: { value: opacity },
      uGrain: { value: grain ? 1 : 0 },
      uGrainIntensity: { value: grainIntensity },
      uMouse: { value: new Float32Array([0.5, 0.5]) },
      uParallax: { value: parallaxStrength },
      uEnableMouse: { value: mouseInteraction },
      uHorizonColor: { value: new Float32Array(horizon) },
      uWaveColor: { value: new Float32Array(wave) },
      uCrestColor: { value: new Float32Array(crest) },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });

  const setSize = () => {
    const rect = container.getBoundingClientRect();
    renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)));
    const resolution = (program.uniforms.iResolution as { value: Float32Array }).value;
    resolution[0] = gl.drawingBufferWidth;
    resolution[1] = gl.drawingBufferHeight;
    renderer.render({ scene: mesh });
  };

  const resizeObserver = new ResizeObserver(setSize);
  resizeObserver.observe(container);
  setSize();

  const currentMouse: [number, number] = [0.5, 0.5];
  const targetMouse: [number, number] = [0.5, 0.5];

  const onPointerMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    targetMouse[0] = (event.clientX - rect.left) / rect.width;
    targetMouse[1] = 1 - (event.clientY - rect.top) / rect.height;
  };
  const onPointerLeave = () => {
    targetMouse[0] = 0.5;
    targetMouse[1] = 0.5;
  };
  if (mouseInteraction) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
  }

  let raf = 0;
  let isVisible = true;
  let isPageVisible = !document.hidden;
  const start = performance.now();

  const loop = (now: number) => {
    (program.uniforms.iTime as { value: number }).value = (now - start) * 0.001;
    const targetX = mouseInteraction ? targetMouse[0] : 0.5;
    const targetY = mouseInteraction ? targetMouse[1] : 0.5;
    currentMouse[0] += 0.05 * (targetX - currentMouse[0]);
    currentMouse[1] += 0.05 * (targetY - currentMouse[1]);
    const mouse = (program.uniforms.uMouse as { value: Float32Array }).value;
    mouse[0] = currentMouse[0];
    mouse[1] = currentMouse[1];
    renderer.render({ scene: mesh });
    raf = requestAnimationFrame(loop);
  };

  const tryStart = () => {
    if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
  };
  const tryStop = () => {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const intersectionObserver = new IntersectionObserver(
    ([entry]) => {
      isVisible = entry.isIntersecting;
      if (isVisible) tryStart();
      else tryStop();
    },
    { threshold: 0 },
  );
  intersectionObserver.observe(container);

  const onVisibilityChange = () => {
    isPageVisible = !document.hidden;
    if (isPageVisible) tryStart();
    else tryStop();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  tryStart();

  return () => {
    tryStop();
    resizeObserver.disconnect();
    intersectionObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerleave', onPointerLeave);
    canvas.remove();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}
