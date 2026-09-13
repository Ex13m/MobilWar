import { Effect, BlendFunction } from "postprocessing";
import { Uniform } from "three";

/**
 * Screen grade (pattern from BLACK RIG's GradeShader, adapted for a live camera feed):
 * chromatic aberration that grows with `hit`/`dead`, state-driven vignette, film grain,
 * lightning-style `flash` tint (we use it for nearby explosions), red hit mix,
 * low-health / dead desaturation. Barrel distortion and rain drops are left out:
 * the world under us is a real camera image.
 */
const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform float uHit;
uniform float uLow;
uniform float uDead;
uniform float uStun;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  float ca = 0.0016 * (1.0 + uHit * 3.0 + uDead * 2.0 + uStun * 2.0) * (0.4 + r2 * 5.0);
  vec3 col;
  col.r = texture2D(inputBuffer, uv + c * ca).r;
  col.g = inputColor.g;
  col.b = texture2D(inputBuffer, uv - c * ca).b;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  // gentle contrast, keep the camera image natural
  col = mix(vec3(lum), col, 1.06);
  col += vec3(1.0, 0.86, 0.6) * uFlash * 0.25;
  col = mix(col, vec3(lum) * vec3(1.0, 0.22, 0.18) + col * 0.3, clamp(uHit, 0.0, 1.0) * 0.55);
  col = mix(col, vec3(lum), uLow * 0.45 + uDead * 0.85);
  float vig = smoothstep(1.05, 0.3, length(c) * (1.0 + uHit * 0.5 + uLow * 0.35 + uDead * 0.8));
  col *= 0.35 + 0.65 * vig;
  float gr = hash(uv * resolution + fract(uTime * 7.0) * 100.0) - 0.5;
  col += gr * 0.012 * (1.0 + (1.0 - lum) * 0.6);
  outputColor = vec4(col, inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", FRAG, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ["uTime", new Uniform(0)],
        ["uFlash", new Uniform(0)],
        ["uHit", new Uniform(0)],
        ["uLow", new Uniform(0)],
        ["uDead", new Uniform(0)],
        ["uStun", new Uniform(0)],
      ]),
    });
  }
  set(v: { flash?: number; hit?: number; low?: number; dead?: number; stun?: number }): void {
    const u = this.uniforms;
    if (v.flash !== undefined) u.get("uFlash")!.value = v.flash;
    if (v.hit !== undefined) u.get("uHit")!.value = v.hit;
    if (v.low !== undefined) u.get("uLow")!.value = v.low;
    if (v.dead !== undefined) u.get("uDead")!.value = v.dead;
    if (v.stun !== undefined) u.get("uStun")!.value = v.stun;
  }
  override update(_renderer: unknown, _input: unknown, dt?: number): void {
    const t = this.uniforms.get("uTime")!;
    t.value = (t.value as number) + (dt ?? 0.016);
  }
}
