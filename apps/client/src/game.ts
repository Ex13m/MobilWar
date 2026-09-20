import * as THREE from "three";
import { GAME, WEAPON_NAMES, angleDiff, bearingLocal, distLocal, resolveShot, weaponCone, type ObjectKind, type PlayMode, type ServerMsg, type WeaponId } from "@mobilwar/shared";
import { ArScene } from "./ar/scene.js";
import { CameraFeed } from "./ar/camera-feed.js";
import { GameAudio } from "./audio.js";
import { Net } from "./net.js";
import { wsUrlFor } from "./api.js";
import { Screenless } from "./screenless.js";
import type { Sensors } from "./sensors.js";
import { WorldState } from "./state.js";
import { Hud, fmtTime } from "./ui/hud.js";
import { saveProfile, type Profile } from "./storage.js";
import { FX } from "./fx/effects.js";
import { WEAPON_PRESETS, preload } from "./assets.js";
import { renderLoadout, cycleWeapon } from "./ui/loadout.js";
import { weaponById, SLOTS, type Slot } from "@mobilwar/shared";

export interface GameOptions {
  root: HTMLElement;
  sensors: Sensors;
  audio: GameAudio;
  profile: Profile;
  roomId: string;
  playMode: PlayMode;
  onExit(): void;
}

type PlaceKind = Extract<ObjectKind, "turret" | "barrier" | "drone" | "medkit">;

/**
 * Game session controller: joins the room, streams position, renders AR or the
 * screenless UI, handles fire/place, and turns server events into feedback.
 */
export class Game {
  private world = new WorldState();
  private hud: Hud | null = null;
  private scene: ArScene | null = null;
  private feed: CameraFeed | null = null;
  private screenless: Screenless | null = null;
  private screenlessEl: HTMLElement | null = null;
  private posTimer: number | null = null;
  private offNet: (() => void) | null = null;
  private raf: number | null = null;
  private lastShotAt: Record<WeaponId, number> = { pistol: 0, blaster: 0, sniper: 0, rocket: 0 };
  private chargeStart = 0;
  private zoomed = false;
  private reloadStart = 0;
  private reloadEnd = 0;
  /** Doom-режим: the trigger is dead while the stagger from a hit lasts. */
  private painUntil = 0;
  private doomAnnounced = false;
  private lastGrenadeAt = 0;
  private lastChargeTone = 0;
  private lastFixSentT = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private joined = false;
  private dead = false;
  private deadBy = "";
  private weapon: WeaponId = "blaster";
  private streak = 0;
  private lastSpeedFix: { x: number; z: number; t: number } | null = null;
  private speed = 0;
  private net: Net;

  constructor(private o: GameOptions) {
    this.net = new Net(wsUrlFor(o.roomId));
  }

  async start(): Promise<void> {
    const { root, net, o } = { root: this.o.root, net: this.net, o: this.o };
    root.innerHTML = "";
    this.offNet = net.on((m) => this.onMsg(m));
    net.onOpen = () => this.join();
    net.connect();
    void preload();

    if (o.playMode === "ar") {
      root.insertAdjacentHTML("beforeend", `<video id="video" autoplay playsinline muted style="display:none"></video><canvas id="gl"></canvas>`);
      const video = root.querySelector<HTMLVideoElement>("#video")!;
      const canvas = root.querySelector<HTMLCanvasElement>("#gl")!;
      this.scene = new ArScene(canvas);
      (window as unknown as { __mw?: unknown }).__mw = { scene: this.scene, world: this.world, hud: this.hud, event: (k: string, d?: Record<string, unknown>) => this.onEvent(k, d) };
      this.hud = new Hud(root, {
        onFire: () => this.trigger(),
        onFireEnd: () => this.triggerEnd(),
        onFireRocket: () => this.fire("rocket"),
        onGrenade: (kind) => this.throwGrenade(kind),
        onSwipeFire: (power) => {
          // A long flick charges the shot for weapons that have a charge; the
          // rest simply fire.
          const def = weaponById(this.o.profile.loadout[this.weapon]);
          const charge = def && def.chargeMs > 0 ? def.chargeMs * power : 0;
          this.fire(this.weapon, charge);
        },
        onWeapon: (w) => this.selectWeapon(w),
        onPick: (slot, id) => this.equip(slot, id),
        onCycle: (dir) => this.equip(this.weapon, cycleWeapon(this.o.profile.loadout, this.weapon, dir)),
        onReload: () => this.reload(),
        onZoom: () => this.toggleZoom(),
        onPlace: (k) => this.place(k),
        onMenu: () => this.openMenu(),
      });
      this.hud.setLoadout(this.o.profile.loadout);
      this.scene.onXrSelect = () => this.fire(this.weapon);
      const xr = await ArScene.xrSupported();
      if (xr) {
        this.hud.banner("Нажми для запуска AR", "", 0);
        const once = async () => {
          root.removeEventListener("pointerdown", once);
          const ok = await this.scene!.startXr(this.hud!.el, o.sensors.orient.heading);
          if (!ok) await this.startArLite(video);
          this.hud!.banner(null);
        };
        root.addEventListener("pointerdown", once);
      } else {
        await this.startArLite(video);
      }
      this.scene.setAnimationLoop((t) => this.frame(t));
    } else {
      this.startScreenless(root);
      const loop = (t: number) => {
        this.frame(t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    }

    this.posTimer = window.setInterval(() => this.sendPos(), 1000 / GAME.POS_HZ);
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      /* ignore */
    }
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private onVisibility = async () => {
    if (document.visibilityState === "visible" && !this.wakeLock) {
      try {
        this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        /* ignore */
      }
    }
  };

  private async startArLite(video: HTMLVideoElement): Promise<void> {
    this.feed = new CameraFeed(video);
    const ok = await this.feed.start();
    if (ok) {
      this.scene?.setVideo(video);
      video.addEventListener("loadedmetadata", () => this.scene?.resize());
    } else this.hud?.banner("Камера недоступна — режим радара", "warn", 4000);
  }

  private startScreenless(root: HTMLElement): void {
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="screenless">
        <div style="position:absolute;top:16px;left:16px;right:16px;display:flex;justify-content:space-between;color:#9ca3af;font-size:14px">
          <span class="sl-score">0 : 0</span><span class="sl-timer">--:--</span><span class="sl-gps">GPS…</span>
        </div>
        <div class="target">Наведи телефон на противника</div>
        <div class="zone"><div class="big">—</div></div>
        <div class="sl-hp" style="color:#4ade80;font-weight:700">HP 100</div>
        <p class="hint">Тап — выстрел. Долгий тап — ракета. Встряхнуть — выстрел. Радар: чаще и выше — ближе; слева/справа — направление.</p>
        <button class="btn danger" style="margin-top:16px" id="sl-exit">Выйти</button>
      </div>`,
    );
    this.screenlessEl = root.querySelector(".screenless")!;
    this.screenless = new Screenless(this.world, this.o.audio);
    let downAt = 0;
    let longTimer: number | null = null;
    this.screenlessEl.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).id === "sl-exit") return this.exit();
      downAt = performance.now();
      longTimer = window.setTimeout(() => {
        longTimer = null;
        this.fire("rocket");
      }, 500);
    });
    this.screenlessEl.addEventListener("pointerup", () => {
      if (longTimer) {
        clearTimeout(longTimer);
        longTimer = null;
        if (performance.now() - downAt < 500) this.fire("blaster");
      }
    });
    window.addEventListener("devicemotion", this.onMotion, { passive: true });
  }

  private lastShake = 0;
  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (!a) return;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    const now = performance.now();
    if (mag > 18 && now - this.lastShake > 600) {
      this.lastShake = now;
      this.fire("blaster");
    }
  };

  private join(): void {
    const { profile, roomId, playMode } = this.o;
    this.net.send({ type: "join", roomId, nick: profile.nick, avatar: profile.avatar, playMode, deviceId: profile.deviceId, loadout: profile.loadout });
  }

  private sendPos(): void {
    const fix = this.o.sensors.fix;
    if (!fix || !this.joined) return;
    this.net.send({ type: "pos", lat: fix.lat, lon: fix.lon, acc: fix.acc, heading: this.o.sensors.orient.heading, ct: performance.now() });
  }

  private selectWeapon(w: WeaponId): void {
    if (w === this.weapon) return;
    this.weapon = w;
    if (this.zoomed) this.toggleZoom();
    this.reloadEnd = 0;
    this.o.audio.weaponSwitch();
    this.net.send({ type: "weapon", weapon: w });
    void this.scene?.viewmodel.setWeapon(w, this.o.profile.loadout[w]);
    this.hud?.setWeapon(w);
    this.hud?.setZoom(false, w === "sniper");
  }

  private reload(): void {
    this.net.send({ type: "reload" });
  }

  /** Equip a catalog variant into a slot: server, profile, viewmodel, HUD labels. */
  private equip(slot: WeaponId, id: string): void {
    this.o.profile.loadout[slot] = id;
    saveProfile(this.o.profile);
    this.net.send({ type: "loadout", slot, weaponId: id });
    this.hud?.setLoadout(this.o.profile.loadout);
    if (slot === this.weapon) void this.scene?.viewmodel.setWeapon(slot, id);
    const w = weaponById(id);
    if (w) this.hud?.banner(`${w.name}: ${w.blurb}`, "good", 1800);
    this.o.audio.weaponSwitch();
  }

  /** In-game drawer: weapon catalog per slot (for field balance testing) + exit. */
  private openMenu(): void {
    const root = this.o.root;
    if (root.querySelector(".drawer")) return;
    root.insertAdjacentHTML("beforeend", `<div class="drawer"><div class="row"><button class="btn secondary" id="dr-close">← В бой</button><button class="btn danger" id="dr-exit">Выйти из зоны</button></div><div id="dr-loadout"></div></div>`);
    const drawer = root.querySelector<HTMLElement>(".drawer")!;
    const off = renderLoadout(drawer.querySelector("#dr-loadout")!, this.o.profile.loadout, (slot, id) => this.equip(slot, id));
    drawer.querySelector("#dr-close")!.addEventListener("click", () => {
      off();
      drawer.remove();
    });
    drawer.querySelector("#dr-exit")!.addEventListener("click", () => this.exit());
  }

  private toggleZoom(): void {
    if (this.weapon !== "sniper" && !this.zoomed) return;
    this.zoomed = !this.zoomed;
    this.net.send({ type: "zoom", on: this.zoomed });
    if (this.scene) {
      this.scene.zoom = this.zoomed ? 3 : 1;
      this.scene.viewmodel.visible = !this.zoomed && this.world.me.alive;
    }
    this.hud?.setZoom(this.zoomed, this.weapon === "sniper");
    this.o.audio.weaponSwitch();
  }

  /** Fire button pressed: sniper starts charging, everything else fires. */
  private trigger(): void {
    if (this.weapon === "sniper") {
      if (!this.chargeStart) this.chargeStart = performance.now();
      return;
    }
    this.fire(this.weapon);
  }

  /** Fire button released: sniper fires with the accumulated charge. */
  private triggerEnd(): void {
    if (this.weapon !== "sniper" || !this.chargeStart) return;
    const held = performance.now() - this.chargeStart;
    this.chargeStart = 0;
    this.hud?.setCharge(0);
    this.fire("sniper", held);
  }

  private fire(w: WeaponId, chargeMs = 0): void {
    const now = performance.now();
    const W = GAME.WEAPONS[w];
    if (now - this.lastShotAt[w] < W.COOLDOWN_MS) return;
    if (!this.world.me.alive) return;
    if (this.reloadEnd > now) return;
    if (this.painUntil > now) return;
    const me = this.world.myPlayer();
    const rounds = w === "rocket" ? this.world.me.ammo : (me?.mag[w] ?? 1);
    if (rounds <= 0) {
      this.o.audio.empty();
      if (w === "rocket") this.hud?.banner("Нет ракет — ищи боезапас", "warn", 1500);
      else this.net.send({ type: "reload" });
      return;
    }
    this.lastShotAt[w] = now;
    const heading = this.o.sensors.orient.heading;
    const pitch = this.o.sensors.orient.pitch;
    this.o.audio.shot(w, weaponById(this.o.profile.loadout[w])?.pitch, this.o.profile.loadout[w]);
    this.net.send({ type: "shoot", weapon: w, heading, pitch: this.o.sensors.orient.pitch, ct: now, chargeMs: Math.round(chargeMs), zoomed: this.zoomed });
    if (this.scene) {
      if (w !== this.scene.viewmodel.current) void this.scene.viewmodel.setWeapon(w, this.o.profile.loadout[w]);
      this.scene.viewmodel.fire();
      const def = weaponById(this.o.profile.loadout[w]);
      if (w !== "rocket" || (def && def.pellets > 1)) {
        // Immediate local bolt(s) from the muzzle; the server decides the hit.
        const from = this.zoomed ? undefined : this.scene.muzzleInWorld();
        const hot = this.aimTarget();
        const color = def?.color ?? WEAPON_PRESETS[w].boltColor;
        const n = def ? Math.max(1, def.pellets) : 1;
        for (let i = 0; i < n; i++) {
          const jitter = n > 1 ? (Math.random() - 0.5) * (def?.cone ?? 8) : 0;
          const vJitter = n > 1 ? (Math.random() - 0.5) * (def?.cone ?? 8) : 0;
          this.scene.bolt(
            this.world.me.x,
            this.world.me.z,
            heading + jitter,
            pitch + vJitter,
            def?.rangeM ?? W.RANGE_M,
            color,
            hot && n === 1 ? { x: hot.x, z: hot.z } : undefined,
            from,
            undefined,
            def?.speedMps,
          );
        }
      }
    }
  }

  /** Throw a grenade: range comes from how far the phone is tilted up. */
  private throwGrenade(kind: "plasma" | "emp"): void {
    const now = performance.now();
    if (!this.world.me.alive) return;
    const left = this.world.myPlayer()?.grenades?.[kind] ?? 0;
    if (left <= 0) {
      this.o.audio.empty();
      this.hud?.banner(kind === "emp" ? "ЭМИ-гранат нет" : "Гранат нет", "warn", 1200);
      return;
    }
    if (now - this.lastGrenadeAt < GAME.GRENADE.COOLDOWN_MS) return;
    this.lastGrenadeAt = now;
    this.net.send({ type: "grenade", kind, heading: this.o.sensors.orient.heading, pitch: this.o.sensors.orient.pitch, ct: now });
    this.o.audio.play("g_switch", { gain: 0.6 });
  }

  private aimTarget(): { id: string; x: number; z: number } | null {
    const w = this.weapon;
    const me = this.world.myPlayer();
    // Pointing at the sky or at your feet is a miss, so the local tracer must
    // not snap onto a target the vertical aim has already ruled out.
    if (Math.abs(this.o.sensors.orient.pitch) > GAME.VERT_HALF_ANGLE_DEG) return null;
    const hot = resolveShot(
      { x: this.world.me.x, z: this.world.me.z, acc: this.world.me.acc },
      this.o.sensors.orient.heading,
      this.world.enemies().map((e) => ({ id: e.id, x: e.rx, z: e.rz, acc: e.acc })),
      GAME.WEAPONS[w].RANGE_M,
      (d) => weaponCone(w, d, me?.bloom ?? 0, this.zoomed),
    );
    if (!hot) return null;
    const p = this.world.players.get(hot.id);
    return p ? { id: p.id, x: p.rx, z: p.rz } : null;
  }

  private place(kind: PlaceKind): void {
    this.net.send({ type: "place", kind });
  }

  /** Relative bearing (deg, + = right) from my view to a world point. */
  private relTo(x: number, z: number): number {
    return angleDiff(bearingLocal(this.world.me, { x, z }), this.o.sensors.orient.heading);
  }

  private onMsg(m: ServerMsg): void {
    switch (m.type) {
      case "welcome":
        this.world.myId = m.playerId;
        this.joined = true;
        this.hud?.feed(`Зона ${m.room.name} · код ${m.room.id}`);
        break;
      case "snapshot":
        this.world.applySnapshot(m.snap);
        break;
      case "shot":
        this.onShot(m);
        break;
      case "hit": {
        const attacker = this.world.players.get(m.by);
        const dmgStr = m.damage;
        if (attacker) this.hud?.damageFrom(this.relTo(attacker.rx, attacker.rz), dmgStr / 50);
        else {
          const obj = this.world.objects.get(m.by);
          if (obj) this.hud?.damageFrom(this.relTo(obj.x, obj.z), dmgStr / 50);
        }
        if (this.world.me.shield > 0 && dmgStr === 0) this.o.audio.shieldHit();
        else this.o.audio.gotHit(dmgStr);
        this.hud?.flash(Math.min(0.6, 0.15 + dmgStr / 60));
        this.scene?.addShake(0.6 + dmgStr / 25);
        this.scene?.hitPulse(Math.min(1, 0.4 + dmgStr / 40));
        this.world.me.hp = m.hp;
        break;
      }
      case "kill": {
        const k = this.world.players.get(m.killerId)?.nick ?? (m.killerId === "turret" ? "Турель" : m.killerId === "drone" ? "Дрон" : "?");
        const v = this.world.players.get(m.victimId)?.nick ?? (m.victimId === this.world.myId ? "тебя" : "?");
        const wname = m.weapon === "turret" ? "турелью" : m.weapon === "drone" ? "дроном" : `из «${WEAPON_NAMES[m.weapon]}»`;
        this.hud?.feed(`${k} ✕ ${v}`);
        if (m.victimId === this.world.myId) {
          this.dead = true;
          this.deadBy = `${k} · ${wname}`;
          this.streak = 0;
          this.hud?.setStreak(0);
          this.o.audio.death();
          this.o.audio.heartbeat(false);
          this.o.audio.say("Ты выбыл. Иди на базу");
          if (this.scene) this.scene.viewmodel.visible = false;
        } else if (m.killerId === this.world.myId) {
          this.streak++;
          this.hud?.setStreak(this.streak);
          this.hud?.hitMarker(true);
          this.hud?.banner(`✕ ${v}`, "good", 1500);
          this.o.audio.kill();
          this.o.audio.say(this.streak >= 3 ? `Серия ${this.streak}` : `Ты поразил ${v}`);
        }
        break;
      }
      case "event":
        this.onEvent(m.kind, m.data);
        break;
      case "warn":
        this.hud?.banner(m.text, "warn", 2500);
        if (m.code === "out_of_bounds") {
          this.o.audio.warn();
          this.o.audio.say("Вернись в зону");
        }
        break;
      case "error":
        if (m.code === "rejoin") {
          this.join();
          break;
        }
        if (m.code === "cant_place") this.o.audio.empty();
        this.hud?.banner(m.text, "warn", 3000);
        if (m.code === "no_room" || m.code === "kicked" || m.code === "room_full") {
          alert(m.text);
          this.exit();
        }
        break;
    }
  }

  private onShot(m: Extract<ServerMsg, { type: "shot" }>): void {
    const mine = m.shooterId === this.world.myId;
    if (mine) {
      if (m.targetId && m.damage) {
        this.o.audio.hitConfirm();
        this.hud?.hitMarker(false);
        const pos = this.scene?.playerPos(m.targetId) ?? (this.world.objects.get(m.targetId) ? new THREE.Vector3(this.world.objects.get(m.targetId)!.x, 1, this.world.objects.get(m.targetId)!.z) : null);
        if (pos && this.scene) {
          const shielded = (this.world.players.get(m.targetId)?.shield ?? 0) > 0;
          this.scene.fx.damageNumber(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.4, 0)), `-${m.damage}`, shielded ? "#38bdf8" : "#fff");
          this.scene.fx.hitSpark(pos, shielded ? FX.shield : FX.hit);
        }
      } else if (m.blockedBy) {
        const b = this.world.objects.get(m.blockedBy);
        if (b && this.scene) this.scene.fx.hitSpark(new THREE.Vector3(b.x, 0.9, b.z), 0xffc060);
        if (b) {
          const rel = this.relTo(b.x, b.z) * (Math.PI / 180);
          const d = distLocal(this.world.me, b);
          this.o.audio.barrierHit({ x: Math.sin(rel) * Math.min(d, 30), z: -Math.cos(rel) * Math.min(d, 30) }, d);
        }
      }
      return;
    }
    // Someone else (or a turret/drone) fired: sound by distance, visible bolt.
    const d = Math.hypot(m.x - this.world.me.x, m.z - this.world.me.z);
    const rel = this.relTo(m.x, m.z) * (Math.PI / 180);
    this.o.audio.remoteShot(m.weapon, { x: Math.sin(rel) * Math.min(d, 30), z: -Math.cos(rel) * Math.min(d, 30) }, d);
    if (!this.scene || m.weapon === "rocket") return;
    const def = m.weaponId ? weaponById(m.weaponId) : undefined;
    const color = m.weapon === "turret" ? FX.turret : m.weapon === "drone" ? FX.drone : def?.color ?? (this.world.players.get(m.shooterId)?.team === "red" ? FX.blasterRed : FX.blasterBlue);
    let target: { x: number; z: number } | undefined;
    if (m.targetId === this.world.myId) target = { x: this.world.me.x, z: this.world.me.z };
    else if (m.targetId) {
      const tp = this.world.players.get(m.targetId);
      const to = this.world.objects.get(m.targetId);
      if (tp) target = { x: tp.rx, z: tp.rz };
      else if (to) target = { x: to.x, z: to.z };
    }
    if (m.weapon === "turret") this.scene.turretRecoil(m.shooterId);
    const from = new THREE.Vector3(m.x, m.weapon === "drone" ? 3 : m.weapon === "turret" ? 0.8 : 1.3, m.z);
    const hitMe = m.targetId === this.world.myId;
    this.scene.bolt(m.x, m.z, m.heading, m.pitch ?? 0, GAME.RIFLE_RANGE_M, color, target, from, hitMe ? () => this.scene?.fx.hitSpark(new THREE.Vector3(this.world.me.x, 1.2, this.world.me.z), FX.hit) : undefined, def?.speedMps);
  }

  private onEvent(kind: string, data?: Record<string, unknown>): void {
    const txt: Record<string, string> = {
      round_start: "Бой начался!",
      round_end: "Раунд окончен",
      flag_taken: "Флаг взят!",
      flag_captured: "Флаг захвачен!",
      flag_dropped: "Флаг потерян",
      infected: "Заражение!",
      object_placed: "Объект установлен",
      object_destroyed: "Объект уничтожен",
      pickup_spawned: "Появился бонус",
      drone_returning: "Дрон ушёл на перезарядку",
      drone_rearmed: "Дрон снова в строю",
    };
    if (kind === "lock_on") {
      this.hud?.setLock(true);
      this.o.audio.play("g_lockon", { gain: 0.8 });
      return;
    }
    if (kind === "lock_lost") {
      this.hud?.setLock(false);
      return;
    }
    switch (kind) {
      case "explosion": {
        const x = Number(data?.x);
        const z = Number(data?.z);
        const r = Number(data?.r ?? 6);
        const d = Math.hypot(x - this.world.me.x, z - this.world.me.z);
        const rel = this.relTo(x, z) * (Math.PI / 180);
        this.o.audio.explosion(d, { x: Math.sin(rel) * Math.min(d, 30), z: -Math.cos(rel) * Math.min(d, 30) });
        if (this.scene) {
          this.scene.fx.explosion(new THREE.Vector3(x, 0, z), r);
          this.scene.addShake(Math.max(0, 3 - d / 6));
          this.scene.flash(Math.max(0, 1 - d / 25));
        }
        const victims = (data?.victims as Array<{ id: string; damage: number }> | undefined) ?? [];
        if (data?.by === this.world.myId && victims.length) {
          this.hud?.hitMarker(false);
          this.o.audio.hitConfirm();
          for (const v of victims) {
            const pos = this.scene?.playerPos(v.id);
            if (pos) this.scene?.fx.damageNumber(pos, `-${v.damage}`, "#ffb060");
          }
        }
        return;
      }
      case "pickup": {
        const who = data?.by === this.world.myId;
        const k = String(data?.kind);
        const names: Record<string, string> = { medkit: "Аптечка +50", ammo: "Боезапас +2 ракеты", shield: "Щит 50", overcharge: "Overcharge ×2 урон", supply: "Снабжение +2" };
        if (who) {
          this.o.audio.pickup(k);
          this.hud?.banner(names[k] ?? k, "good", 1800);
          this.o.audio.say(names[k] ?? k);
        } else this.hud?.feed(`${this.world.players.get(String(data?.by))?.nick ?? "?"} подобрал: ${names[k] ?? k}`);
        return;
      }
      case "reload":
        if (data?.id === this.world.myId) {
          const ms = Number(data?.ms ?? 2000);
          this.reloadStart = performance.now();
          this.reloadEnd = this.reloadStart + ms;
          this.o.audio.reload(String(data?.weapon), ms);
        }
        return;
      case "empty":
        this.o.audio.empty();
        return;
      case "pain": {
        // Doom-режим: a hit staggers. The shot is locked out for the same time
        // the server locks it, so the screen and the trigger agree.
        const ms = Number(data?.ms ?? 260);
        const dmg = Number(data?.damage ?? 10);
        this.painUntil = performance.now() + ms;
        this.hud?.flash(Math.min(0.85, 0.35 + dmg / 100));
        this.hud?.setPain(ms);
        this.scene?.addShake(1.2);
        this.o.audio.pain(dmg);
        return;
      }
      case "burn":
        if (data?.id === this.world.myId) {
          this.hud?.fx("burn", Number(data?.s ?? 3) * 1000);
          this.hud?.banner("Ты горишь!", "warn", 1500);
        }
        return;
      case "stun":
        if (data?.id === this.world.myId) {
          this.hud?.fx("stun", Number(data?.ms ?? 500));
          this.o.audio.shieldHit();
        }
        return;
      case "heal":
        if (data?.id === this.world.myId) {
          this.hud?.banner(`+${data?.amount} HP`, "good", 1200);
          this.o.audio.pickup("medkit");
        } else if (data?.by === this.world.myId) {
          const pos = this.scene?.playerPos(String(data?.id));
          if (pos) this.scene?.fx.damageNumber(pos, `+${data?.amount}`, "#4ade80");
        }
        return;
      case "overheat":
        this.hud?.banner("Перегрев! 3 с", "warn", 3000);
        this.o.audio.overheat();
        return;
      case "emp": {
        const x = Number(data?.x);
        const z = Number(data?.z);
        if (this.scene) this.scene.fx.shieldRipple(new THREE.Vector3(x, 1, z));
        this.o.audio.emp(Math.hypot(x - this.world.me.x, z - this.world.me.z));
        return;
      }
      case "respawn":
        if (data?.id === this.world.myId) {
          this.dead = false;
          this.hud?.setDead(false);
          this.hud?.banner("В бой! Защита 3 с", "good", 2000);
          this.o.audio.respawn();
          if (this.scene) this.scene.viewmodel.visible = true;
        }
        return;
      case "object_placed":
        if (data?.by === this.world.myId) this.o.audio.placed();
        this.hud?.feed(txt[kind]!);
        return;
    }
    const t = txt[kind] ?? kind;
    this.hud?.feed(t);
    if (kind === "round_start" || kind === "round_end") {
      this.hud?.banner(t, "", 3000);
      if (kind === "round_start") this.o.audio.roundStart();
      this.o.audio.say(t);
    }
    if (kind === "infected" && data?.id === this.world.myId) this.o.audio.say("Ты заражён. Теперь ты охотишься");
  }

  private frame(_t: number): void {
    const now = performance.now();
    const { sensors, audio } = this.o;
    const net = this.net;
    const fix = sensors.fix;
    if (fix && fix.t !== this.lastFixSentT && this.world.room) {
      this.world.pushMyFix(fix.lat, fix.lon, fix.acc, fix.t);
      this.lastFixSentT = fix.t;
      if (this.lastSpeedFix) {
        const dt = (fix.t - this.lastSpeedFix.t) / 1000;
        if (dt > 0.3) this.speed = 0.6 * this.speed + 0.4 * (distLocal(this.world.me, this.lastSpeedFix) / dt);
      }
      this.lastSpeedFix = { x: this.world.me.x, z: this.world.me.z, t: fix.t };
    }
    this.world.interpolate(net.serverNow());
    const heading = sensors.orient.heading;
    this.world.me.heading = heading;
    const serverNow = net.serverNow();

    audio.heartbeat(this.world.me.alive && this.world.me.hp > 0 && this.world.me.hp <= 25);

    if (this.scene && this.hud) {
      this.scene.updateView(sensors.orient, this.world.me, heading);
      this.scene.viewmodel.update(Math.min(0.05, 1 / 60), this.speed);
      this.scene.setGrade({ low: this.world.me.alive && this.world.me.hp <= 25 ? 1 : 0, dead: this.world.me.alive ? 0 : 1, stun: (this.world.myPlayer()?.stunnedUntil ?? 0) > serverNow ? 1 : 0 });
      this.scene.sync(this.world, serverNow);
      this.scene.render();
      const room = this.world.room;
      if (room) {
        if (room.doom && !this.doomAnnounced) {
          this.doomAnnounced = true;
          this.hud.banner("ДУМ-РЕЖИМ · правила 1993", "warn", 2600);
        }
        this.hud.setScore(room.score.red, room.score.blue);
        this.hud.setTimer(room.phase === "playing" ? fmtTime(room.phaseEndsAt - serverNow) : room.phase === "countdown" ? "старт…" : room.phase === "ended" ? "конец" : "лобби");
      }
      this.hud.setGps(fix ? fix.acc : null, sensors.hasCompass);
      this.hud.setNet(net.rtt, net.connected);
      const me = this.world.myPlayer();
      this.hud.setVitals(this.world.me.hp, this.world.me.shield, this.world.me.ammo, me?.supply ?? 0);
      if (me) this.hud.setAmmo(me.mag, me.reserve);
      if (me?.grenades) this.hud.setGrenades(me.grenades.plasma, me.grenades.emp);
      const rl = this.reloadEnd > now ? (now - this.reloadStart) / Math.max(1, this.reloadEnd - this.reloadStart) : null;
      this.hud.setReloading(rl);
      if (this.chargeStart) {
        const k = Math.min(1, (now - this.chargeStart) / GAME.WEAPONS.sniper.CHARGE_MS);
        this.hud.setCharge(k);
        if (now - this.lastChargeTone > 90) {
          this.lastChargeTone = now;
          audio.charge(k);
        }
      }
      this.hud.setCompass(heading);
      this.hud.setCrosshairHot(!!this.aimTarget());
      this.hud.drawRadar(this.world, heading);
      if (!this.world.me.alive && room && me) {
        const base = room.bases[me.team];
        const secs = Math.max(0, (this.world.me.respawnAt - serverNow) / 1000);
        this.hud.setDead(true, this.deadBy, this.relTo(base.x, base.z), distLocal(this.world.me, base), secs);
      } else if (this.dead && this.world.me.alive) {
        this.dead = false;
        this.hud.setDead(false);
        if (this.scene) this.scene.viewmodel.visible = true;
      }
    } else if (this.screenless && this.screenlessEl) {
      const r = this.screenless.update(heading, now);
      const zone = this.screenlessEl.querySelector(".zone")!;
      const big = this.screenlessEl.querySelector(".big")!;
      const target = this.screenlessEl.querySelector(".target")!;
      zone.className = "zone " + (r.locked ? "lock" : r.closeness > 0.7 ? "near" : "");
      big.textContent = r.targetId ? `${Math.round(r.distance)}м` : "—";
      target.textContent = r.targetId ? `${this.world.players.get(r.targetId)?.nick ?? ""} ${r.rel > 8 ? "→ правее" : r.rel < -8 ? "← левее" : "● в прицеле"}` : "Противников рядом нет";
      const room = this.world.room;
      if (room) {
        this.screenlessEl.querySelector(".sl-score")!.textContent = `${room.score.red} : ${room.score.blue}`;
        this.screenlessEl.querySelector(".sl-timer")!.textContent = room.phase === "playing" ? fmtTime(room.phaseEndsAt - serverNow) : { lobby: "лобби", countdown: "старт…", ended: "конец", playing: "" }[room.phase];
      }
      this.screenlessEl.querySelector(".sl-gps")!.textContent = fix ? `±${Math.round(fix.acc)}м` : "GPS…";
      this.screenlessEl.querySelector(".sl-hp")!.textContent = this.world.me.alive ? `HP ${this.world.me.hp}${this.world.me.shield ? ` · щит ${this.world.me.shield}` : ""} · 🚀${this.world.me.ammo}` : "ВЫБЫЛ — иди на базу";
    }
  }

  exit(): void {
    this.destroy();
    this.o.onExit();
  }

  destroy(): void {
    if (this.posTimer) clearInterval(this.posTimer);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.offNet?.();
    this.net.close();
    this.o.audio.heartbeat(false);
    this.scene?.endXr();
    this.scene?.dispose();
    this.feed?.stop();
    window.removeEventListener("devicemotion", this.onMotion);
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release();
    this.hud?.destroy();
    this.o.root.innerHTML = "";
  }
}
