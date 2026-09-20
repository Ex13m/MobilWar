import * as THREE from "three";

/**
 * Lightweight GPU particle pool (one THREE.Points, additive, soft round sprite).
 * CPU integrates position/velocity/life; attributes are re-uploaded each frame.
 * Sized for phones: a few thousand particles at most.
 */
export interface EmitOpts {
  pos: THREE.Vector3;
  count: number;
  /** Base velocity (m/s) and random spread (m/s). */
  vel?: THREE.Vector3;
  spread?: number;
  life?: number;
  lifeVar?: number;
  size?: number;
  sizeVar?: number;
  color?: THREE.Color | number;
  color2?: THREE.Color | number;
  gravity?: number;
  drag?: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
varying float vLife;
varying vec3 vColor;
void main() {
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = aSize * (0.35 + 0.65 * smoothstep(0.0, 0.15, aLife)) * (0.3 + 0.7 * aLife);
  gl_PointSize = s * (420.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform sampler2D uTex;
varying float vLife;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * smoothstep(0.0, 0.2, vLife) * vLife;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * t.rgb * 1.6, a);
}`;

export function softSpriteTexture(size = 64): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A hollow ring, for shock rings drawn as sprites (always facing the viewer). */
export function ringSpriteTexture(size = 128): THREE.Texture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d")!;
  const g = c.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.62, "rgba(255,255,255,0.95)");
  g.addColorStop(0.78, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ParticleSystem {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private geo: THREE.BufferGeometry;
  private cursor = 0;
  private tmpC = new THREE.Color();
  private tmpC2 = new THREE.Color();

  constructor(
    scene: THREE.Object3D,
    private max = 2500,
    texture: THREE.Texture = softSpriteTexture(),
  ) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aLife", new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(o: EmitOpts): void {
    const c1 = this.tmpC.set(o.color ?? 0xffffff);
    const c2 = this.tmpC2.set(o.color2 ?? o.color ?? 0xffffff);
    const spread = o.spread ?? 1;
    const life = o.life ?? 1;
    const lifeVar = o.lifeVar ?? 0.3;
    const size = o.size ?? 0.3;
    const sizeVar = o.sizeVar ?? 0.5;
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = o.pos.x;
      this.pos[i3 + 1] = o.pos.y;
      this.pos[i3 + 2] = o.pos.z;
      // random direction in sphere
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u) * spread * Math.random();
      this.vel[i3] = (o.vel?.x ?? 0) + Math.cos(th) * r;
      this.vel[i3 + 1] = (o.vel?.y ?? 0) + u * spread * Math.random();
      this.vel[i3 + 2] = (o.vel?.z ?? 0) + Math.sin(th) * r;
      const ml = life * (1 + (Math.random() * 2 - 1) * lifeVar);
      this.maxLife[i] = ml;
      this.life[i] = 1;
      this.size[i] = size * (1 + (Math.random() * 2 - 1) * sizeVar);
      const k = Math.random();
      this.col[i3] = c1.r + (c2.r - c1.r) * k;
      this.col[i3 + 1] = c1.g + (c2.g - c1.g) * k;
      this.col[i3 + 2] = c1.b + (c2.b - c1.b) * k;
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0.2;
    }
  }

  update(dt: number): void {
    const dtc = Math.min(dt, 0.05);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      const i3 = i * 3;
      this.life[i] = Math.max(0, this.life[i]! - dtc / this.maxLife[i]!);
      const d = 1 - this.drag[i]! * dtc;
      this.vel[i3] = this.vel[i3]! * d;
      this.vel[i3 + 1] = (this.vel[i3 + 1]! - this.grav[i]! * dtc) * d;
      this.vel[i3 + 2] = this.vel[i3 + 2]! * d;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dtc;
      this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dtc;
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dtc;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aLife") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
  }
}
