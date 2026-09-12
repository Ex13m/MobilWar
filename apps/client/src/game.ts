import { GAME, resolveShot, type ObjectKind, type PlayMode, type ServerMsg } from "@mobilwar/shared";
import { ArScene } from "./ar/scene.js";
import { CameraFeed } from "./ar/camera-feed.js";
import { GameAudio } from "./audio.js";
import { Net } from "./net.js";
import { wsUrlFor } from "./api.js";
import { Screenless } from "./screenless.js";
import type { Sensors } from "./sensors.js";
import { WorldState } from "./state.js";
import { Hud, fmtTime } from "./ui/hud.js";
import type { Profile } from "./storage.js";

export interface GameOptions {
  root: HTMLElement;
  sensors: Sensors;
  audio: GameAudio;
  profile: Profile;
  roomId: string;
  playMode: PlayMode;
  onExit(): void;
}

/**
 * Game session controller: joins the room, streams position, renders AR or the
 * screenless UI, handles fire/place, and reacts to server events.
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
  private lastShotAt = 0;
  private lastFixSentT = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private joined = false;
  private dead = false;

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

    if (o.playMode === "ar") {
      root.insertAdjacentHTML("beforeend", `<video id="video" autoplay playsinline muted></video><canvas id="gl"></canvas>`);
      const video = root.querySelector<HTMLVideoElement>("#video")!;
      const canvas = root.querySelector<HTMLCanvasElement>("#gl")!;
      this.scene = new ArScene(canvas);
      this.hud = new Hud(root, {
        onFire: () => this.fire(),
        onPlace: (k) => this.place(k),
        onMenu: () => this.exit(),
      });
      this.scene.onXrSelect = () => this.fire();
      const xr = await ArScene.xrSupported();
      if (xr) {
        // Offer WebXR (Android Chrome). Falls back to AR-lite if the user declines / it fails.
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
    if (!ok) this.hud?.banner("Камера недоступна — режим радара", "warn", 4000);
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
        <p class="hint">Тап по экрану — выстрел. Слушай радар: чаще и выше — ближе, слева/справа — направление.</p>
        <button class="btn danger" style="margin-top:16px" id="sl-exit">Выйти</button>
      </div>`,
    );
    this.screenlessEl = root.querySelector(".screenless")!;
    this.screenless = new Screenless(this.world, this.o.audio);
    this.screenlessEl.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).id === "sl-exit") return this.exit();
      this.fire();
    });
    // Volume keys are not exposed to web pages; shake-to-fire as an alternative trigger.
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
      this.fire();
    }
  };

  private join(): void {
    const { profile, roomId, playMode } = this.o;
    this.net.send({ type: "join", roomId, nick: profile.nick, avatar: profile.avatar, playMode, deviceId: profile.deviceId });
  }

  private sendPos(): void {
    const fix = this.o.sensors.fix;
    if (!fix || !this.joined) return;
    this.net.send({ type: "pos", lat: fix.lat, lon: fix.lon, acc: fix.acc, heading: this.o.sensors.orient.heading, ct: performance.now() });
  }

  private fire(): void {
    const now = performance.now();
    if (now - this.lastShotAt < GAME.RIFLE_COOLDOWN_MS) return;
    if (!this.world.me.alive) return;
    this.lastShotAt = now;
    const heading = this.o.sensors.orient.heading;
    this.o.audio.shot();
    this.net.send({ type: "shoot", heading, pitch: this.o.sensors.orient.pitch, ct: now });
    // Immediate local tracer for responsiveness; server decides the hit.
    this.scene?.tracer(this.world.me.x, this.world.me.z, heading, GAME.RIFLE_RANGE_M, 0xfde047, now);
  }

  private place(kind: ObjectKind): void {
    this.net.send({ type: "place", kind });
  }

  private onMsg(m: ServerMsg): void {
    const now = performance.now();
    switch (m.type) {
      case "welcome":
        this.world.myId = m.playerId;
        this.joined = true;
        this.hud?.feed(`Зона ${m.room.name} · код ${m.room.id}`);
        break;
      case "snapshot":
        this.world.applySnapshot(m.snap);
        break;
      case "shot": {
        if (m.shooterId === this.world.myId) {
          if (m.targetId) {
            this.o.audio.hitConfirm();
            this.hud?.feed(`Попадание −${m.damage}`);
          }
          break;
        }
        const src = this.world.players.get(m.shooterId) ?? this.world.objects.get(m.shooterId);
        const d = src ? Math.hypot(m.x - this.world.me.x, m.z - this.world.me.z) : 50;
        this.o.audio.remoteShot(d);
        let tpos: { x: number; z: number } | undefined;
        if (m.targetId === this.world.myId) tpos = { x: this.world.me.x, z: this.world.me.z };
        else if (m.targetId) {
          const tp = this.world.players.get(m.targetId);
          if (tp) tpos = { x: tp.rx, z: tp.rz };
        }
        this.scene?.tracer(m.x, m.z, m.heading, GAME.RIFLE_RANGE_M, m.targetId ? 0xef4444 : 0xffffff, now, tpos);
        break;
      }
      case "hit":
        this.o.audio.gotHit();
        this.hud?.flash();
        this.world.me.hp = m.hp;
        break;
      case "kill": {
        const k = this.world.players.get(m.killerId)?.nick ?? (m.killerId === "turret" ? "Турель" : "?");
        const v = this.world.players.get(m.victimId)?.nick ?? "?";
        this.hud?.feed(`${k} ✕ ${v}`);
        if (m.victimId === this.world.myId) {
          this.dead = true;
          this.o.audio.death();
          this.hud?.banner(`Ты выбыл. Возрождение ${GAME.RESPAWN_MS / 1000} с`, "dead", GAME.RESPAWN_MS);
          this.o.audio.say("Ты выбыл. Жди возрождения");
        } else if (m.killerId === this.world.myId) {
          this.o.audio.kill();
          this.o.audio.say(`Ты поразил ${v}`);
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
        this.hud?.banner(m.text, "warn", 3000);
        if (m.code === "no_room" || m.code === "kicked" || m.code === "room_full") {
          alert(m.text);
          this.exit();
        }
        break;
    }
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
    };
    const t = txt[kind] ?? kind;
    this.hud?.feed(t);
    if (kind === "round_start" || kind === "round_end") {
      this.hud?.banner(t, "", 3000);
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
    }
    this.world.interpolate(net.serverNow());
    const heading = sensors.orient.heading;
    this.world.me.heading = heading;

    // Respawn detection for banner clearing
    if (this.dead && this.world.me.alive) {
      this.dead = false;
      this.hud?.banner(null);
      audio.respawn();
    }

    if (this.scene && this.hud) {
      this.scene.updateView(sensors.orient, this.world.me, heading);
      this.scene.sync(this.world, now);
      this.scene.render();
      const room = this.world.room;
      if (room) {
        this.hud.setScore(room.score.red, room.score.blue);
        this.hud.setTimer(room.phase === "playing" ? fmtTime(room.phaseEndsAt - net.serverNow()) : room.phase === "countdown" ? "старт…" : room.phase === "ended" ? "конец" : "лобби");
      }
      this.hud.setGps(fix ? fix.acc : null, sensors.hasCompass);
      this.hud.setNet(net.rtt, net.connected);
      this.hud.setHp(this.world.me.hp);
      this.hud.setCompass(heading);
      const me = this.world.myPlayer();
      if (me) this.hud.setSupply(me.supply);
      const hot = resolveShot(
        { x: this.world.me.x, z: this.world.me.z, acc: this.world.me.acc },
        heading,
        this.world.enemies().map((e) => ({ id: e.id, x: e.rx, z: e.rz, acc: e.acc })),
      );
      this.hud.setCrosshairHot(!!hot);
      this.hud.drawRadar(this.world, heading);
    } else if (this.screenless && this.screenlessEl) {
      const r = this.screenless.update(heading, now);
      const zone = this.screenlessEl.querySelector(".zone")!;
      const big = this.screenlessEl.querySelector(".big")!;
      const target = this.screenlessEl.querySelector(".target")!;
      zone.className = "zone " + (r.locked ? "lock" : r.closeness > 0.7 ? "near" : "");
      big.textContent = r.targetId ? `${Math.round(r.distance)}м` : "—";
      target.textContent = r.targetId
        ? `${this.world.players.get(r.targetId)?.nick ?? ""} ${r.rel > 8 ? "→ правее" : r.rel < -8 ? "← левее" : "● в прицеле"}`
        : "Противников рядом нет";
      const room = this.world.room;
      if (room) {
        this.screenlessEl.querySelector(".sl-score")!.textContent = `${room.score.red} : ${room.score.blue}`;
        this.screenlessEl.querySelector(".sl-timer")!.textContent =
          room.phase === "playing" ? fmtTime(room.phaseEndsAt - net.serverNow()) : { lobby: "лобби", countdown: "старт…", ended: "конец", playing: "" }[room.phase];
      }
      this.screenlessEl.querySelector(".sl-gps")!.textContent = fix ? `±${Math.round(fix.acc)}м` : "GPS…";
      this.screenlessEl.querySelector(".sl-hp")!.textContent = this.world.me.alive ? `HP ${this.world.me.hp}` : "ВЫБЫЛ";
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
