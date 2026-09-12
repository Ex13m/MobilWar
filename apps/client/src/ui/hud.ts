import { GAME, type ObjectKind } from "@mobilwar/shared";
import type { WorldState } from "../state.js";

export interface HudCallbacks {
  onFire(): void;
  onPlace(kind: ObjectKind): void;
  onMenu(): void;
}

/** DOM heads-up display. Also used as the WebXR dom-overlay root. */
export class Hud {
  readonly el: HTMLElement;
  private score: HTMLElement;
  private timer: HTMLElement;
  private gps: HTMLElement;
  private net: HTMLElement;
  private hp: HTMLElement;
  private crosshair: HTMLElement;
  private feedEl: HTMLElement;
  private bannerEl: HTMLElement;
  private compass: HTMLElement;
  private supply: HTMLElement;
  private flashEl: HTMLElement;
  private radar: HTMLCanvasElement;
  private placeMenu: HTMLElement;
  private bannerTimer: number | null = null;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="hud">
        <div class="flash"></div>
        <div class="top">
          <div class="score"><span class="red">0</span>:<span class="blue">0</span> <span class="timer">--:--</span></div>
          <div class="status"><span class="gps">GPS…</span><span class="net">⇄</span></div>
        </div>
        <button class="btn secondary menu" style="min-height:36px;padding:6px 10px">☰</button>
        <div class="compass">— °</div>
        <div class="feed"></div>
        <div class="radar"><canvas width="192" height="192"></canvas></div>
        <div class="crosshair"></div>
        <div class="banner" hidden></div>
        <div class="place-menu" hidden style="position:absolute;bottom:110px;right:12px;display:flex;flex-direction:column;gap:8px">
          <button class="btn secondary" data-kind="turret">🔫 Турель (${GAME.TURRET.COST})</button>
          <button class="btn secondary" data-kind="barrier">🧱 Укрытие (1)</button>
          <button class="btn secondary" data-kind="medkit">➕ Аптечка (1)</button>
        </div>
        <div class="bottom">
          <div class="hpbar"><i style="width:100%"></i></div>
          <button class="place">🛠<small class="supply" style="font-size:11px;display:block">${GAME.SUPPLY_PER_PLAYER}</small></button>
          <button class="fire">Огонь</button>
        </div>
      </div>`,
    );
    this.el = root.querySelector(".hud")!;
    const q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
    this.score = q(".score");
    this.timer = q(".timer");
    this.gps = q(".gps");
    this.net = q(".net");
    this.hp = q(".hpbar i");
    this.crosshair = q(".crosshair");
    this.feedEl = q(".feed");
    this.bannerEl = q(".banner");
    this.compass = q(".compass");
    this.supply = q(".supply");
    this.flashEl = q(".flash");
    this.radar = q(".radar canvas");
    this.placeMenu = q(".place-menu");

    const fire = q<HTMLButtonElement>(".fire");
    const fireHandler = (e: Event) => {
      e.preventDefault();
      cb.onFire();
    };
    fire.addEventListener("pointerdown", fireHandler);
    q(".place").addEventListener("click", () => (this.placeMenu.hidden = !this.placeMenu.hidden));
    this.placeMenu.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
      b.addEventListener("click", () => {
        this.placeMenu.hidden = true;
        cb.onPlace(b.dataset.kind as ObjectKind);
      }),
    );
    q(".menu").addEventListener("click", () => cb.onMenu());
  }

  setScore(red: number, blue: number): void {
    this.score.querySelector(".red")!.textContent = String(red);
    this.score.querySelector(".blue")!.textContent = String(blue);
  }
  setTimer(text: string): void {
    this.timer.textContent = text;
  }
  setGps(acc: number | null, compass: boolean): void {
    if (acc === null) {
      this.gps.textContent = "GPS…";
      this.gps.className = "gps bad";
      return;
    }
    this.gps.textContent = `±${Math.round(acc)}м${compass ? "" : " ⚠️компас"}`;
    this.gps.className = "gps " + (acc <= 12 && compass ? "good" : "bad");
  }
  setNet(rtt: number, connected: boolean): void {
    this.net.textContent = connected ? `${Math.round(rtt)}ms` : "⛔";
  }
  setHp(hp: number): void {
    this.hp.style.width = `${Math.max(0, (hp / GAME.MAX_HP) * 100)}%`;
    this.hp.style.background = hp > 50 ? "var(--accent)" : hp > 25 ? "var(--warn)" : "var(--red)";
  }
  setSupply(n: number): void {
    this.supply.textContent = String(n);
  }
  setCrosshairHot(hot: boolean): void {
    this.crosshair.classList.toggle("hot", hot);
  }
  setCompass(h: number): void {
    this.compass.textContent = `${Math.round(h)}° ${cardinal(h)}`;
  }
  feed(text: string): void {
    const d = document.createElement("div");
    d.textContent = text;
    this.feedEl.prepend(d);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild?.remove();
    setTimeout(() => d.remove(), 6000);
  }
  banner(text: string | null, kind: "" | "warn" | "dead" = "", ms = 2500): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    if (!text) {
      this.bannerEl.hidden = true;
      return;
    }
    this.bannerEl.textContent = text;
    this.bannerEl.className = `banner ${kind}`;
    this.bannerEl.hidden = false;
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (this.bannerEl.hidden = true), ms);
  }
  flash(): void {
    this.flashEl.classList.add("on");
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove("on")));
  }

  /** Top-down minimap: me at centre, "up" = my heading. */
  drawRadar(world: WorldState, heading: number): void {
    const c = this.radar.getContext("2d");
    if (!c) return;
    const W = this.radar.width;
    const R = W / 2;
    const rangeM = GAME.RIFLE_RANGE_M;
    c.clearRect(0, 0, W, W);
    c.strokeStyle = "rgba(255,255,255,0.15)";
    c.beginPath();
    c.arc(R, R, R * 0.5, 0, Math.PI * 2);
    c.stroke();
    // cone
    c.fillStyle = "rgba(74,222,128,0.12)";
    c.beginPath();
    c.moveTo(R, R);
    c.arc(R, R, R, -Math.PI / 2 - (GAME.CONE_HALF_ANGLE_DEG * Math.PI) / 180, -Math.PI / 2 + (GAME.CONE_HALF_ANGLE_DEG * Math.PI) / 180);
    c.closePath();
    c.fill();
    const me = world.me;
    const rot = (-heading * Math.PI) / 180;
    const plot = (x: number, z: number) => {
      const dx = x - me.x;
      const dz = z - me.z;
      // world: x east, z south(+). Rotate so heading is up.
      const ex = dx * Math.cos(rot) - -dz * Math.sin(rot);
      const ny = dx * Math.sin(rot) + -dz * Math.cos(rot);
      const k = (R * 0.95) / rangeM;
      return { px: R + ex * k, py: R - ny * k, d: Math.hypot(dx, dz) };
    };
    const myTeam = world.myPlayer()?.team;
    for (const o of world.objects.values()) {
      const { px, py, d } = plot(o.x, o.z);
      if (d > rangeM) continue;
      c.fillStyle = o.team ? (o.team === "red" ? "#ef4444" : "#3b82f6") : "#fff";
      c.fillRect(px - 3, py - 3, 6, 6);
    }
    for (const p of world.players.values()) {
      if (p.id === world.myId || !p.alive) continue;
      const { px, py, d } = plot(p.rx, p.rz);
      if (d > rangeM) continue;
      c.fillStyle = p.team === myTeam ? "#4ade80" : p.team === "red" ? "#ef4444" : "#3b82f6";
      c.beginPath();
      c.arc(px, py, 5, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#fff";
    c.beginPath();
    c.moveTo(R, R - 8);
    c.lineTo(R - 6, R + 6);
    c.lineTo(R + 6, R + 6);
    c.closePath();
    c.fill();
  }

  destroy(): void {
    this.el.remove();
  }
}

export function cardinal(h: number): string {
  const names = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];
  return names[Math.round(h / 45) % 8]!;
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
