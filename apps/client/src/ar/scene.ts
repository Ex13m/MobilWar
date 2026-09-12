import * as THREE from "three";
import { GAME, TEAM_COLORS, type Team, type WorldObject } from "@mobilwar/shared";
import type { RemotePlayer, WorldState } from "../state.js";
import type { Orientation } from "../sensors.js";
import { buildAvatar, buildBarrier, buildFlag, buildLabel, buildMedkit, buildTurret, updateLabel } from "./avatars.js";

const EYE_HEIGHT = 1.6;
const DEG = Math.PI / 180;

interface PlayerNode {
  group: THREE.Group;
  label: THREE.Sprite;
  avatar: string;
  team: Team;
  hp: number;
  nick: string;
}

interface Tracer {
  line: THREE.Line;
  until: number;
}

/**
 * three.js scene for AR. Two backends:
 *  - "ar-lite": transparent WebGL canvas over a <video> camera feed; the camera is rotated
 *    from DeviceOrientation and positioned from GPS (works on iOS Safari).
 *  - "webxr": immersive-ar session (Android Chrome). The world group is aligned with
 *    the compass at session start and re-anchored as GPS updates arrive.
 */
export class ArScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world = new THREE.Group();
  mode: "ar-lite" | "webxr" = "ar-lite";
  private players = new Map<string, PlayerNode>();
  private objects = new Map<string, THREE.Group>();
  private tracers: Tracer[] = [];
  private zoneRing: THREE.Line | null = null;
  private hill: THREE.Mesh | null = null;
  private xrSession: XRSession | null = null;
  private xrYawOffset = 0; // radians
  private tmpQ = new THREE.Quaternion();
  private q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° around X
  private euler = new THREE.Euler();
  private zee = new THREE.Vector3(0, 0, 1);
  private q0 = new THREE.Quaternion();
  private fwd = new THREE.Vector3();
  onXrSelect: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.xr.enabled = true;
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.1, 400);
    this.camera.position.set(0, EYE_HEIGHT, 0);
    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 40, 10);
    this.scene.add(sun);
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
      // Align: XR forward (-Z) corresponds to compass heading at start.
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

  /** Update the camera (ar-lite) or world alignment (webxr) from sensors + my position. */
  updateView(o: Orientation, me: { x: number; z: number }, headingDeg: number): void {
    if (this.mode === "webxr") {
      // world_pos = R(yaw) * (p - me); camera stays at XR origin (+ tracked motion).
      this.world.rotation.y = this.xrYawOffset;
      const c = Math.cos(this.xrYawOffset);
      const s = Math.sin(this.xrYawOffset);
      // Target group translation so that `me` lands at origin: -R*me
      const tx = -(me.x * c + me.z * s);
      const tz = -(-me.x * s + me.z * c);
      this.world.position.x += (tx - this.world.position.x) * 0.1;
      this.world.position.z += (tz - this.world.position.z) * 0.1;
      return;
    }
    // AR-lite: camera at my position, orientation from device sensors, yaw pinned to compass.
    this.camera.position.set(me.x, EYE_HEIGHT, me.z);
    const screenAngle = (screen.orientation?.angle ?? 0) * DEG;
    this.euler.set(o.beta * DEG, o.alpha * DEG, -o.gamma * DEG, "YXZ");
    this.tmpQ.setFromEuler(this.euler);
    this.tmpQ.multiply(this.q1);
    this.tmpQ.multiply(this.q0.setFromAxisAngle(this.zee, -screenAngle));
    // Yaw correction so that camera bearing == fused compass heading.
    this.fwd.set(0, 0, -1).applyQuaternion(this.tmpQ);
    const yawNow = Math.atan2(this.fwd.x, -this.fwd.z) / DEG;
    const corr = ((headingDeg - yawNow + 540) % 360) - 180;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -corr * DEG);
    this.camera.quaternion.copy(yawQ.multiply(this.tmpQ));
  }

  /** Sync scene graph with world state. */
  sync(world: WorldState, now: number): void {
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
        this.world.add(group);
        n = { group, label, avatar: p.avatar, team: p.team, hp: p.hp, nick: p.nick };
        this.players.set(p.id, n);
      }
      n.group.position.set(p.rx, 0, p.rz);
      n.group.rotation.y = -p.rheading * DEG;
      n.group.visible = p.alive;
      if (n.hp !== p.hp || n.nick !== p.nick) {
        updateLabel(n.label, p.nick, p.hp, GAME.MAX_HP, p.team);
        n.hp = p.hp;
        n.nick = p.nick;
      }
      // Scale label with distance so it stays readable
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
        g = buildObject(o);
        g.userData.kind = o.kind;
        this.world.add(g);
        this.objects.set(o.id, g);
      }
      g.position.set(o.x, 0, o.z);
      if (o.kind === "turret") {
        const head = g.getObjectByName("head");
        if (head && typeof o.heading === "number") head.rotation.y = -o.heading * DEG;
      }
      g.visible = !(o.kind === "flag" && o.carriedBy);
    }
    for (const [id, g] of this.objects) {
      if (!seenObj.has(id)) {
        this.world.remove(g);
        this.objects.delete(id);
      }
    }

    // zone ring
    if (world.room && !this.zoneRing) {
      const pts: THREE.Vector3[] = [];
      const r = world.room.radiusM;
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
      }
      this.zoneRing = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.6 }),
      );
      this.world.add(this.zoneRing);
    }
    if (world.room && (world.room.mode === "koth" || world.room.mode === "turret_defense") && !this.hill) {
      const r = Math.max(8, world.room.radiusM * (world.room.mode === "koth" ? 0.15 : 0.12));
      this.hill = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, 0.1, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      this.hill.position.y = 0.5;
      this.hill.scale.y = 10;
      this.world.add(this.hill);
    }

    // expire tracers
    this.tracers = this.tracers.filter((t) => {
      if (now > t.until) {
        this.world.remove(t.line);
        return false;
      }
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, (t.until - now) / 250);
      return true;
    });
  }

  /** Draw a tracer from (x,z) along heading for `len` m (or to the target). */
  tracer(x: number, z: number, headingDeg: number, len: number, color: number, now: number, target?: { x: number; z: number }): void {
    const h = headingDeg * DEG;
    const ex = target ? target.x : x + Math.sin(h) * len;
    const ez = target ? target.z : z - Math.cos(h) * len;
    const y0 = 1.2;
    const y1 = target ? 1.0 : 1.2;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y0, z), new THREE.Vector3(ex, y1, ez)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.world.add(line);
    this.tracers.push({ line, until: now + 250 });
  }

  /** Returns the remote player node under the screen centre, if any (for visual aim assist). */
  playerNode(id: string): THREE.Group | undefined {
    return this.players.get(id)?.group;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  setAnimationLoop(fn: (t: number) => void): void {
    this.renderer.setAnimationLoop(fn);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }
}

function buildObject(o: WorldObject): THREE.Group {
  switch (o.kind) {
    case "turret":
      return buildTurret(o.team);
    case "barrier":
      return buildBarrier(o.team);
    case "medkit":
      return buildMedkit();
    case "flag":
      return buildFlag(o.team);
  }
}

export function teamColor(t: Team): number {
  return TEAM_COLORS[t];
}
