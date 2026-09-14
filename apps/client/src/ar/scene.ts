import * as THREE from "three";
import { EffectComposer, EffectPass, RenderPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, BlendFunction } from "postprocessing";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GradeEffect } from "../fx/grade.js";
import { GAME, TEAM_COLORS, type Team, type WorldObject } from "@mobilwar/shared";
import type { RemotePlayer, WorldState } from "../state.js";
import type { Orientation } from "../sensors.js";
import { buildAvatar, buildBarrier, buildFlag, buildLabel, buildMedkit, updateLabel } from "./avatars.js";
import { Effects, FX } from "../fx/effects.js";
import { Viewmodel } from "./weapons.js";
import { loadModel, sprite, type ModelId } from "../assets.js";

const EYE_HEIGHT = 1.6;
const DEG = Math.PI / 180;
export const BLOOM_LAYER = 1;

interface PlayerNode {
  group: THREE.Group;
  label: THREE.Sprite;
  avatar: string;
  team: Team;
  hp: number;
  shield: number;
  nick: string;
  bubble: THREE.Mesh;
  flashUntil: number;
}

/**
 * three.js scene for AR.
 *  - "ar-lite": opaque canvas; the camera frame is drawn as a cover-fit background quad,
 *    the 3D world on top; selective bloom on bolts/explosions via postprocessing.
 *  - "webxr": immersive-ar session; composer is bypassed (XR renders directly).
 */
export class ArScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world = new THREE.Group();
  readonly fx: Effects;
  readonly viewmodel: Viewmodel;
  mode: "ar-lite" | "webxr" = "ar-lite";
  quality: "high" | "low" = "high";
  private players = new Map<string, PlayerNode>();
  private objects = new Map<string, THREE.Object3D>();
  private rockets = new Map<string, THREE.Object3D>();
  private zoneRing: THREE.Line | null = null;
  private hill: THREE.Mesh | null = null;
  private bases: THREE.Group | null = null;
  private xrSession: XRSession | null = null;
  private xrYawOffset = 0;
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private grade: GradeEffect | null = null;
  private flashV = 0;
  private hitV = 0;
  private bgScene = new THREE.Scene();
  private bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bgMesh: THREE.Mesh | null = null;
  private videoTex: THREE.VideoTexture | null = null;
  private video: HTMLVideoElement | null = null;
  private tmpQ = new THREE.Quaternion();
  private q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
  private euler = new THREE.Euler();
  private zee = new THREE.Vector3(0, 0, 1);
  private q0 = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  private shake = 0;
  private clock = new THREE.Clock();
  private lastDt = 0.016;
  onXrSelect: (() => void) | null = null;
  /** Extra FOV multiplier (sniper zoom). 1 = none. */
  zoom = 1;

  constructor(canvas: HTMLCanvasElement) {
    const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4 || (navigator as { deviceMemory?: number }).deviceMemory !== undefined && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
    const forced = new URLSearchParams(location.search).get("q");
    this.quality = forced === "high" || forced === "low" ? forced : lowEnd ? "low" : "high";
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: this.quality === "high", powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.setPixelRatio(Math.min(this.quality === "high" ? 1.5 : 1.25, window.devicePixelRatio));
    this.renderer.setClearColor(0x0b0f14, 1);
    this.renderer.xr.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.05, 400);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.camera);
    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    // Image-based lighting so metals and plastics on the models read as materials, not flat colour.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4;
    pmrem.dispose();
    // Faint fill on the camera so the weapon reads in the dark (BLACK RIG pattern).
    const fill = new THREE.PointLight(0x9fb6d6, 1.6, 2.5, 2);
    fill.position.set(0.32, 0.25, -0.15);
    this.camera.add(fill);
    this.fx = new Effects(this.world);
    this.fx.particles.points.layers.enable(BLOOM_LAYER);
    this.viewmodel = new Viewmodel(this.camera, this.scene);
    this.setupComposer();
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private setupComposer(): void {
    if (this.quality === "low") return;
    const composer = new EffectComposer(this.renderer, { multisampling: 0, frameBufferType: THREE.HalfFloatType });
    const bgPass = new RenderPass(this.bgScene, this.bgCam);
    const mainPass = new RenderPass(this.scene, this.camera);
    mainPass.clear = false;
    // Bloom only on HDR pixels (> 1.0): bolts, flashes, beacons. The camera image stays untouched.
    const bloom = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.05,
      intensity: 0.7,
      radius: 0.5,
      levels: 5,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const smaa = new SMAAEffect({ preset: SMAAPreset.LOW });
    const grade = new GradeEffect();
    composer.addPass(bgPass);
    composer.addPass(mainPass);
    composer.addPass(new EffectPass(this.camera, bloom, tone, smaa, grade));
    this.composer = composer;
    this.bloom = bloom;
    this.grade = grade;
  }

  /** Screen-space state for the grade pass (hit pulse, low health, dead, stun). */
  setGrade(v: { low?: number; dead?: number; stun?: number }): void {
    this.grade?.set(v);
  }
  /** Warm full-screen flash (explosions nearby), decays over ~0.5 s. */
  flash(strength: number): void {
    this.flashV = Math.min(1, this.flashV + strength);
  }
  /** Red hit pulse, decays over ~0.6 s. */
  hitPulse(strength: number): void {
    this.hitV = Math.min(1, this.hitV + strength);
  }

  /** Use a <video> as the AR background (drawn cover-fit under the 3D world). */
  setVideo(video: HTMLVideoElement): void {
    this.video = video;
    this.videoTex = new THREE.VideoTexture(video);
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.videoTex, depthTest: false, depthWrite: false });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.bgScene.add(this.bgMesh);
    this.updateBgFit();
  }

  private updateBgFit(): void {
    if (!this.bgMesh || !this.video) return;
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const va = vw / vh;
    const ca = cw / ch;
    // cover: scale plane so the video fills the canvas, cropping the excess; zoom scales further.
    const z = this.zoom;
    if (va > ca) this.bgMesh.scale.set((va / ca) * z, z, 1);
    else this.bgMesh.scale.set(z, (ca / va) * z, 1);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateBgFit();
  }

  /* ---------------- WebXR ---------------- */

  static async xrSupported(): Promise<boolean> {
    try {
      return !!(navigator.xr && (await navigator.xr.isSessionSupported("immersive-ar")));
    } catch {
      return false;
    }
  }

  async startXr(overlay: HTMLElement, headingDeg: number): Promise<boolean> {
    if (!navigator.xr) return false;
    try {
      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["local"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: overlay },
      } as XRSessionInit);
      this.xrSession = session;
      this.renderer.xr.setReferenceSpaceType("local");
      await this.renderer.xr.setSession(session);
      this.mode = "webxr";
      this.xrYawOffset = headingDeg * DEG;
      session.addEventListener("select", () => this.onXrSelect?.());
      session.addEventListener("end", () => {
        this.xrSession = null;
        this.mode = "ar-lite";
        this.world.rotation.set(0, 0, 0);
        this.world.position.set(0, 0, 0);
      });
      return true;
    } catch (e) {
      console.warn("xr", (e as Error).message);
      return false;
    }
  }

  endXr(): void {
    void this.xrSession?.end();
  }

  /* ---------------- per-frame ---------------- */

  updateView(o: Orientation, me: { x: number; z: number }, headingDeg: number): void {
    if (this.mode === "webxr") {
      this.world.rotation.y = this.xrYawOffset;
      const c = Math.cos(this.xrYawOffset);
      const s = Math.sin(this.xrYawOffset);
      const tx = -(me.x * c + me.z * s);
      const tz = -(-me.x * s + me.z * c);
      this.world.position.x += (tx - this.world.position.x) * 0.1;
      this.world.position.z += (tz - this.world.position.z) * 0.1;
      return;
    }
    this.camera.position.set(me.x, EYE_HEIGHT, me.z);
    const screenAngle = (screen.orientation?.angle ?? 0) * DEG;
    this.euler.set(o.beta * DEG, o.alpha * DEG, -o.gamma * DEG, "YXZ");
    this.tmpQ.setFromEuler(this.euler);
    this.tmpQ.multiply(this.q1);
    this.tmpQ.multiply(this.q0.setFromAxisAngle(this.zee, -screenAngle));
    this.fwd.set(0, 0, -1).applyQuaternion(this.tmpQ);
    const yawNow = Math.atan2(this.fwd.x, -this.fwd.z) / DEG;
    const kick = this.viewmodel.cameraKick();
    const shakeP = this.shake * (Math.random() - 0.5) * 2;
    const shakeY = this.shake * (Math.random() - 0.5) * 2;
    const corr = ((headingDeg - yawNow + kick.yaw + shakeY + 540) % 360) - 180;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -corr * DEG);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (kick.pitch + shakeP) * DEG);
    this.camera.quaternion.copy(yawQ.multiply(this.tmpQ).multiply(pitchQ));
    const fov = 65 / this.zoom;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
      this.updateBgFit();
    }
  }

  /** Camera shake impulse (degrees), decays over ~0.4 s. */
  addShake(deg: number): void {
    this.shake = Math.min(4, this.shake + deg);
  }

  /** Sync scene graph with world state. */
  sync(world: WorldState, nowMs: number): void {
    const t = nowMs / 1000;
    const seen = new Set<string>();
    for (const p of world.players.values()) {
      if (p.id === world.myId) continue;
      seen.add(p.id);
      let n = this.players.get(p.id);
      if (!n || n.avatar !== p.avatar || n.team !== p.team) {
        if (n) this.world.remove(n.group);
        const group = buildAvatar(p.avatar, p.team);
        const label = buildLabel(p.nick, p.hp, GAME.MAX_HP, p.team);
        label.position.y = (group.userData.headY as number) + 0.45;
        group.add(label);
        const bubble = new THREE.Mesh(
          new THREE.SphereGeometry(1.05, 20, 14),
          new THREE.MeshBasicMaterial({ color: FX.shield, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
        );
        bubble.position.y = 1.0;
        bubble.visible = false;
        bubble.layers.enable(BLOOM_LAYER);
        group.add(bubble);
        this.world.add(group);
        n = { group, label, avatar: p.avatar, team: p.team, hp: p.hp, shield: p.shield, nick: p.nick, bubble, flashUntil: 0 };
        this.players.set(p.id, n);
      }
      n.group.position.set(p.rx, 0, p.rz);
      n.group.rotation.y = -p.rheading * DEG;
      n.group.visible = p.alive;
      if (p.hp < n.hp) n.flashUntil = t + 0.12;
      if (n.hp !== p.hp || n.nick !== p.nick || n.shield !== p.shield) {
        updateLabel(n.label, p.nick, p.hp, GAME.MAX_HP, p.team, p.shield);
        n.hp = p.hp;
        n.shield = p.shield;
        n.nick = p.nick;
      }
      n.bubble.visible = p.shield > 0 || p.protectedUntil > nowMs;
      (n.bubble.material as THREE.MeshBasicMaterial).opacity = p.protectedUntil > nowMs ? 0.35 + 0.15 * Math.sin(t * 12) : 0.18;
      const flashing = t < n.flashUntil;
      n.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissive) {
          const mat = m.material as THREE.MeshStandardMaterial;
          if (flashing) {
            if (!m.userData.origEmissive) m.userData.origEmissive = mat.emissive.clone();
            mat.emissive.set(0xffffff);
          } else if (m.userData.origEmissive) {
            mat.emissive.copy(m.userData.origEmissive as THREE.Color);
            m.userData.origEmissive = null;
          }
        }
      });
      const d = Math.max(1, this.camera.position.distanceTo(n.group.position));
      const s = Math.min(6, 1 + d / 12);
      n.label.scale.set(1.6 * s, 0.5 * s, 1);
    }
    for (const [id, n] of this.players) {
      if (!seen.has(id)) {
        this.world.remove(n.group);
        this.players.delete(id);
      }
    }

    const seenObj = new Set<string>();
    for (const o of world.objects.values()) {
      seenObj.add(o.id);
      let g = this.objects.get(o.id);
      if (!g) {
        g = this.buildObject(o);
        this.world.add(g);
        this.objects.set(o.id, g);
      }
      g.position.set(o.x, o.y ?? 0, o.z);
      if (o.kind === "turret") {
        const head = g.getObjectByName("head");
        if (head && typeof o.heading === "number") {
          // The server sends a heading ten times a second; snapping to it looks
          // like a slide show. Traverse toward it at a fixed rate so the turret
          // visibly swings onto a target and overshoots nothing.
          const want = -o.heading * DEG;
          const cur = head.rotation.y;
          let d = ((want - cur + Math.PI) % (Math.PI * 2)) - Math.PI;
          if (d < -Math.PI) d += Math.PI * 2;
          const maxStep = 2.6 * this.lastDt; // rad/s
          head.rotation.y = cur + Math.max(-maxStep, Math.min(maxStep, d));
        }
        // Barrel recoil: kicked on the shot event, eased back here.
        const barrel = g.getObjectByName("barrel");
        if (barrel) barrel.position.z += (0 - barrel.position.z) * Math.min(1, this.lastDt * 9);
      } else if (o.kind === "drone") {
        g.rotation.y = -(o.heading ?? 0) * DEG;
        g.position.y = (o.y ?? 3) + Math.sin(t * 3 + o.x) * 0.15;
        const rotors = g.getObjectByName("rotors");
        if (rotors) rotors.rotation.y += this.lastDt * 40;
      } else if (g.userData.pickup) {
        g.rotation.y = t * 1.5;
        g.position.y = 0.6 + Math.sin(t * 2 + o.z) * 0.12;
      }
      g.visible = !(o.kind === "flag" && o.carriedBy);
    }
    for (const [id, g] of this.objects) {
      if (!seenObj.has(id)) {
        this.world.remove(g);
        this.objects.delete(id);
      }
    }

    // rockets (server projectiles)
    const seenR = new Set<string>();
    for (const pr of world.projectiles.values()) {
      seenR.add(pr.id);
      let m = this.rockets.get(pr.id);
      if (!m) {
        m = this.buildRocket();
        this.world.add(m);
        this.rockets.set(pr.id, m);
      }
      m.position.set(pr.rx, pr.y, pr.rz);
      m.rotation.y = -pr.heading * DEG;
      const back = new THREE.Vector3(-Math.sin(pr.heading * DEG), 0, Math.cos(pr.heading * DEG));
      this.fx.exhaust(m.position.clone().add(back.clone().multiplyScalar(0.4)), back);
    }
    for (const [id, m] of this.rockets) {
      if (!seenR.has(id)) {
        this.world.remove(m);
        this.rockets.delete(id);
      }
    }

    if (world.room && !this.zoneRing) {
      const pts: THREE.Vector3[] = [];
      const r = world.room.radiusM;
      for (let i = 0; i <= 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
      }
      this.zoneRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6 }));
      this.world.add(this.zoneRing);
    }
    if (world.room && !this.bases) {
      this.bases = new THREE.Group();
      for (const team of ["red", "blue"] as const) {
        const b = world.room.bases[team];
        const beacon = this.buildBeacon(TEAM_COLORS[team]);
        beacon.position.set(b.x, 0, b.z);
        this.bases.add(beacon);
      }
      this.world.add(this.bases);
    }
    if (world.room && (world.room.mode === "koth" || world.room.mode === "turret_defense") && !this.hill) {
      const r = Math.max(8, world.room.radiusM * (world.room.mode === "koth" ? 0.15 : 0.12));
      this.hill = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 40, 1, true), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      this.hill.position.y = 0.5;
      this.hill.scale.y = 10;
      this.world.add(this.hill);
    }
  }

  private buildObject(o: WorldObject): THREE.Object3D {
    const holder = new THREE.Group();
    const teamColor = o.team ? TEAM_COLORS[o.team] : 0xffffff;
    const place = (id: ModelId, scale: number, rotY = 0, name?: string) =>
      loadModel(id).then((m) => {
        m.scale.setScalar(scale);
        m.rotation.y = rotY;
        if (name) m.name = name;
        tintTeam(m, teamColor);
        holder.add(m);
      });
    switch (o.kind) {
      case "turret": {
        const head = new THREE.Group();
        head.name = "head";
        holder.add(head);
        void loadModel("turret").then((m) => {
          m.scale.setScalar(1.6);
          tintTeam(m, teamColor);
          head.add(m);
        });
        holder.add(ring(teamColor, 0.9));
        break;
      }
      case "drone": {
        void loadModel("drone").then((m) => {
          m.scale.setScalar(0.6);
          m.rotation.y = Math.PI;
          tintTeam(m, teamColor);
          const rotors = new THREE.Group();
          rotors.name = "rotors";
          m.add(rotors);
          holder.add(m);
        });
        const light = new THREE.PointLight(teamColor, 3, 6, 2);
        light.position.y = -0.3;
        holder.add(light);
        break;
      }
      case "barrier":
        holder.add(buildBarrier(o.team));
        break;
      case "flag":
        holder.add(buildFlag(o.team));
        break;
      case "medkit":
        holder.add(buildMedkit());
        holder.userData.pickup = true;
        holder.add(beam(FX.heal));
        break;
      case "ammo":
        void place("rocketAmmo", 1.2, 0);
        holder.userData.pickup = true;
        holder.add(beam(FX.rocket));
        break;
      case "shield":
      case "overcharge":
      case "supply": {
        const color = o.kind === "shield" ? FX.shield : o.kind === "overcharge" ? FX.blasterYellow : 0xa78bfa;
        const geo = o.kind === "shield" ? new THREE.OctahedronGeometry(0.35) : o.kind === "overcharge" ? new THREE.TetrahedronGeometry(0.4) : new THREE.BoxGeometry(0.5, 0.5, 0.5);
        const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, roughness: 0.3 }));
        mesh.layers.enable(BLOOM_LAYER);
        holder.add(mesh);
        holder.userData.pickup = true;
        holder.add(beam(color));
        break;
      }
    }
    return holder;
  }

  private buildRocket(): THREE.Object3D {
    const g = new THREE.Group();
    void loadModel("rocketAmmo").then((m) => {
      m.scale.setScalar(1.6);
      m.rotation.y = Math.PI;
      g.add(m);
    });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sprite("flare"), color: new THREE.Color(3.5, 2.2, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.scale.set(0.9, 0.9, 1);
    glow.position.z = 0.35;
    glow.layers.enable(BLOOM_LAYER);
    g.add(glow);
    const light = new THREE.PointLight(0xffa040, 5, 8, 2);
    g.add(light);
    return g;
  }

  private buildBeacon(color: number): THREE.Group {
    const g = new THREE.Group();
    g.add(ring(color, 6));
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.5, 14, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    pillar.position.y = 7;
    pillar.layers.enable(BLOOM_LAYER);
    g.add(pillar);
    return g;
  }

  /** Slide a turret's barrel back; the update loop eases it home again. */
  turretRecoil(objectId: string): void {
    const g = this.objects.get(objectId);
    const barrel = g?.getObjectByName("barrel");
    if (barrel) barrel.position.z = 0.16;
  }

  /** Draw a bolt from a world point along a heading + pitch (or to a target). */
  bolt(
    x: number,
    z: number,
    headingDeg: number,
    pitchDeg: number,
    len: number,
    color: number,
    target?: { x: number; z: number },
    from?: THREE.Vector3,
    onArrive?: () => void,
    speedMps?: number,
  ): void {
    const h = headingDeg * DEG;
    const p = pitchDeg * DEG;
    const start = from ?? new THREE.Vector3(x, 1.3, z);
    // The bolt leaves the muzzle along the full 3D aim direction: yaw from the
    // compass, elevation from the phone's tilt. Without the pitch term every
    // tracer stayed in the crosshair plane no matter how the phone was held.
    const cp = Math.cos(p);
    const end = target
      ? new THREE.Vector3(target.x, 1.0, target.z)
      : new THREE.Vector3(start.x + Math.sin(h) * cp * len, start.y + Math.sin(p) * len, start.z - Math.cos(h) * cp * len);
    // Each weapon's round flies at its own speed, so a plasma lob and a rail
    // slug read completely differently even along the same line.
    this.fx.bolt(start, end, color, speedMps ?? GAME.WEAPONS.blaster.SPEED_MPS, onArrive);
  }

  playerPos(id: string): THREE.Vector3 | null {
    const n = this.players.get(id);
    return n ? n.group.position.clone().setY(1.2) : null;
  }

  /** World-space muzzle position of my viewmodel (in `world` group coords). */
  muzzleInWorld(): THREE.Vector3 {
    const v = this.viewmodel.muzzleWorld();
    return this.world.worldToLocal(v);
  }

  render(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.lastDt = dt;
    this.fx.update(dt);
    this.shake = Math.max(0, this.shake - dt * 8);
    this.flashV = Math.max(0, this.flashV - dt * 2.2);
    this.hitV = Math.max(0, this.hitV - dt * 1.8);
    this.grade?.set({ flash: this.flashV, hit: this.hitV });
    if (this.mode === "ar-lite" && this.composer) this.composer.render(dt);
    else {
      if (this.mode === "ar-lite" && this.bgMesh) {
        this.renderer.autoClear = true;
        this.renderer.render(this.bgScene, this.bgCam);
        this.renderer.autoClear = false;
        this.renderer.clearDepth();
      }
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  setAnimationLoop(fn: (t: number) => void): void {
    this.renderer.setAnimationLoop(fn);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.composer?.dispose();
    this.bloom?.dispose();
    this.renderer.dispose();
  }
}

function ring(color: number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

function beam(color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.25, 30, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  m.position.y = 15;
  m.layers.enable(BLOOM_LAYER);
  return m;
}

/** Tint the accent parts of a Kenney model toward the team colour. */
function tintTeam(root: THREE.Object3D, color: number): void {
  const c = new THREE.Color(color);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.emissive = c.clone();
    mat.emissiveIntensity = 0.12;
    m.material = mat;
  });
}
