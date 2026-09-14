import { GAME, weaponById, type Loadout, type ObjectKind, type WeaponId } from "@mobilwar/shared";
import { renderLoadout } from "./loadout.js";
import type { WorldState } from "../state.js";

export interface HudCallbacks {
  onFire(): void;
  onFireEnd(): void;
  onFireRocket(): void;
  onWeapon(w: WeaponId): void;
  /** Picker on the HUD: a catalog variant chosen for a slot, or cycle ±1 in the active slot. */
  onPick(slot: WeaponId, weaponId: string): void;
  onCycle(dir: 1 | -1): void;
  onReload(): void;
  onZoom(): void;
  onPlace(kind: Extract<ObjectKind, "turret" | "barrier" | "drone" | "medkit">): void;
  onMenu(): void;
}

/** DOM heads-up display. Also used as the WebXR dom-overlay root. */
export class Hud {
  readonly el: HTMLElement;
  private q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
  private bannerTimer: number | null = null;
  private lastHp = GAME.MAX_HP as number;

  constructor(root: HTMLElement, cb: HudCallbacks) {
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="hud">
        <div class="flash"></div>
        <div class="vignette"></div>
        <div class="burnfx"></div>
        <div class="stunfx"></div>
        <div class="dmgdir"></div>
        <div class="top">
          <div class="score"><span class="red">0</span>:<span class="blue">0</span> <span class="timer">--:--</span></div>
          <div class="topright">
            <div class="status"><span class="gps">GPS…</span><span class="net">⇄</span></div>
            <button class="btn secondary menu" style="min-height:36px;padding:6px 10px">☰</button>
          </div>
        </div>
        <div class="compass"><b>—</b>°<span>—</span></div>
        <div class="streak" hidden>серия <b>0</b></div>
        <div class="feed"></div>
        <div class="radar"><canvas width="192" height="192"></canvas></div>
        <div class="crosshair"><i class="hm"></i><i class="charge"></i></div>
        <div class="scope" hidden></div>
        <div class="reloadbar" hidden><i></i><span>перезарядка</span></div>
        <div class="banner" hidden></div>
        <div class="dead" hidden>
          <div class="dead-title">ТЫ ВЫБЫЛ</div>
          <div class="dead-by"></div>
          <div class="dead-timer">8</div>
          <div class="dead-hint">Иди на свою базу</div>
          <div class="dead-arrow">➤</div>
          <div class="dead-dist">— м</div>
        </div>
        <div class="place-menu" hidden>
          <button class="btn secondary" data-kind="turret">🔫 Турель · ${GAME.TURRET.COST}</button>
          <button class="btn secondary" data-kind="drone">🛸 Дрон · ${GAME.DRONE.COST}</button>
          <button class="btn secondary" data-kind="barrier">🧱 Укрытие · 1</button>
          <button class="btn secondary" data-kind="medkit">➕ Аптечка · 1</button>
        </div>
        <div class="picker" hidden><div class="picker-head"><span class="picker-title">Оружие</span><button class="picker-close">✕</button></div><div class="picker-body"></div></div>
        <div class="bottom">
          <div class="vitals">
            <div class="hpnum">100</div>
            <div class="hpbar">${Array.from({ length: 10 }, () => "<i></i>").join("")}</div>
            <div class="shieldbar"><i></i></div>
            <div class="weapons">
              <button class="wbtn" data-w="pistol"><b>Искра</b><small class="mag" data-w="pistol">12</small></button>
              <button class="wbtn active" data-w="blaster"><b>Гроза</b><small class="mag" data-w="blaster">30/120</small></button>
              <button class="wbtn" data-w="sniper"><b>Горизонт</b><small class="mag" data-w="sniper">5/20</small></button>
              <button class="wbtn" data-w="rocket"><b>Молот</b><small class="ammo">2</small></button>
            </div>
            <div class="weapons">
              <button class="place">🛠 <small class="supply">${GAME.SUPPLY_PER_PLAYER}</small></button>
              <button class="wprev" title="Предыдущий вариант">‹</button>
              <button class="wpick">Выбор ▾</button>
              <button class="wnext" title="Следующий вариант">›</button>
              <button class="reload">⟳</button>
              <button class="zoom" hidden>🔭</button>
            </div>
          </div>
          <div class="firecol">
            <button class="fire2" title="Ракета">🚀</button>
            <button class="fire">Огонь</button>
          </div>
        </div>
      </div>`,
    );
    this.el = root.querySelector(".hud")!;
    const fire = this.q<HTMLButtonElement>(".fire");
    let holdTimer: number | null = null;
    const startFire = (e: Event) => {
      e.preventDefault();
      cb.onFire();
      if (holdTimer) clearInterval(holdTimer);
      holdTimer = window.setInterval(() => cb.onFire(), 120);
    };
    const stopFire = () => {
      if (holdTimer) clearInterval(holdTimer);
      holdTimer = null;
      cb.onFireEnd();
    };
    fire.addEventListener("pointerdown", startFire);
    fire.addEventListener("pointerup", stopFire);
    fire.addEventListener("pointercancel", stopFire);
    fire.addEventListener("pointerleave", stopFire);
    this.q(".fire2").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cb.onFireRocket();
    });
    this.q(".place").addEventListener("click", () => {
      const m = this.q<HTMLElement>(".place-menu");
      m.hidden = !m.hidden;
    });
    this.el.querySelectorAll<HTMLButtonElement>(".place-menu button").forEach((b) =>
      b.addEventListener("click", () => {
        this.q<HTMLElement>(".place-menu").hidden = true;
        cb.onPlace(b.dataset.kind as "turret" | "barrier" | "drone" | "medkit");
      }),
    );
    this.el.querySelectorAll<HTMLButtonElement>(".wbtn").forEach((b) =>
      b.addEventListener("click", () => {
        const w = b.dataset.w as WeaponId;
        if (b.classList.contains("active")) {
          this.togglePicker(w);
          return;
        }
        this.setWeapon(w);
        cb.onWeapon(w);
      }),
    );
    this.q(".wpick").addEventListener("click", () => this.togglePicker(this.activeSlot()));
    this.q(".picker-close").addEventListener("click", () => this.togglePicker(null));
    this.q(".wprev").addEventListener("click", () => cb.onCycle(-1));
    this.q(".wnext").addEventListener("click", () => cb.onCycle(1));
    this.cb = cb;
    this.q(".reload").addEventListener("click", () => cb.onReload());
    this.q(".zoom").addEventListener("click", () => cb.onZoom());
    this.q(".menu").addEventListener("click", () => cb.onMenu());
  }

  private cb!: HudCallbacks;
  private loadout: Loadout | null = null;
  private pickerOff: (() => void) | null = null;
  activeSlot(): WeaponId {
    return (this.el.querySelector<HTMLButtonElement>(".wbtn.active")?.dataset.w as WeaponId) ?? "blaster";
  }
  /** Show the 30-card strip for a slot on the HUD (null = close). */
  togglePicker(slot: WeaponId | null): void {
    const p = this.q<HTMLElement>(".picker");
    const body = this.q<HTMLElement>(".picker-body");
    this.pickerOff?.();
    this.pickerOff = null;
    if (!slot || !this.loadout || (!p.hidden && p.dataset.slot === slot)) {
      p.hidden = true;
      body.innerHTML = "";
      return;
    }
    p.hidden = false;
    p.dataset.slot = slot;
    const names: Record<WeaponId, string> = { pistol: "Пистолет", blaster: "Винтовка", sniper: "Снайперка", rocket: "Тяжёлое" };
    this.q(".picker-title").textContent = `${names[slot]} · 30 вариантов`;
    this.pickerOff = renderLoadout(body, this.loadout, (s, id) => {
      this.setLoadout(this.loadout!);
      this.cb.onPick(s, id);
    }, [slot]);
  }

  setLoadout(lo: Loadout): void {
    this.loadout = lo;
    this.el.querySelectorAll<HTMLButtonElement>(".wbtn").forEach((b) => {
      const w = weaponById(lo[b.dataset.w as WeaponId]);
      if (w) {
        b.querySelector("b")!.textContent = w.name;
        b.style.setProperty("--c", `#${w.color.toString(16).padStart(6, "0")}`);
      }
    });
  }
  private fxTimers: Record<string, number> = {};
  fx(kind: "burn" | "stun", ms: number): void {
    const el = this.q<HTMLElement>(`.${kind}fx`);
    el.classList.add("on");
    if (this.fxTimers[kind]) clearTimeout(this.fxTimers[kind]);
    this.fxTimers[kind] = window.setTimeout(() => el.classList.remove("on"), ms);
  }

  /** Magazine / reserve per weapon; -1 reserve = infinite. */
  setAmmo(mag: Record<WeaponId, number>, reserve: Record<WeaponId, number>): void {
    for (const w of ["pistol", "blaster", "sniper"] as const) {
      const el = this.el.querySelector<HTMLElement>(`.mag[data-w="${w}"]`);
      if (el) {
        el.textContent = reserve[w] < 0 ? `${mag[w]}` : `${mag[w]}/${reserve[w]}`;
        el.classList.toggle("empty", mag[w] === 0);
      }
    }
  }
  setReloading(k: number | null): void {
    const b = this.q<HTMLElement>(".reloadbar");
    b.hidden = k === null;
    if (k !== null) b.querySelector("i")!.style.width = `${Math.round(k * 100)}%`;
  }
  setCharge(k: number): void {
    const c = this.q<HTMLElement>(".charge");
    c.style.setProperty("--k", String(k));
    c.classList.toggle("full", k >= 1);
  }
  setZoom(on: boolean, available: boolean): void {
    this.q<HTMLElement>(".zoom").hidden = !available;
    this.q<HTMLElement>(".zoom").classList.toggle("active", on);
    this.q<HTMLElement>(".scope").hidden = !on;
    this.el.classList.toggle("zoomed", on);
  }

  setWeapon(w: WeaponId): void {
    this.el.querySelectorAll<HTMLButtonElement>(".wbtn").forEach((b) => b.classList.toggle("active", b.dataset.w === w));
    this.q(".fire").textContent = w === "rocket" ? "Ракета" : w === "sniper" ? "Держи" : "Огонь";
  }
  setScore(red: number, blue: number): void {
    this.q(".score .red").textContent = String(red);
    this.q(".score .blue").textContent = String(blue);
  }
  setTimer(text: string): void {
    this.q(".timer").textContent = text;
  }
  setGps(acc: number | null, compass: boolean): void {
    const g = this.q<HTMLElement>(".gps");
    if (acc === null) {
      g.textContent = "GPS…";
      g.className = "gps bad";
      return;
    }
    g.textContent = `±${Math.round(acc)}м${compass ? "" : " ⚠️компас"}`;
    g.className = "gps " + (acc <= 12 && compass ? "good" : "bad");
  }
  setNet(rtt: number, connected: boolean): void {
    this.q(".net").textContent = connected ? `${Math.round(rtt)}ms` : "⛔";
  }
  setVitals(hp: number, shield: number, ammo: number, supply: number): void {
    const segs = this.el.querySelectorAll<HTMLElement>(".hpbar i");
    segs.forEach((s, i) => {
      const on = hp > i * 10;
      s.classList.toggle("on", on);
      s.classList.toggle("low", on && hp <= 30);
    });
    this.q(".hpnum").textContent = String(hp);
    this.q<HTMLElement>(".hpnum").classList.toggle("low", hp <= 25);
    this.q<HTMLElement>(".shieldbar i").style.width = `${Math.max(0, (shield / GAME.SHIELD_MAX) * 100)}%`;
    this.q(".ammo").textContent = String(ammo);
    this.q<HTMLElement>(".fire2").classList.toggle("empty", ammo <= 0);
    this.q(".supply").textContent = String(supply);
    this.q<HTMLElement>(".vignette").classList.toggle("low", hp <= 25 && hp > 0);
    if (hp < this.lastHp) this.q<HTMLElement>(".hpbar").animate([{ transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "none" }], { duration: 160 });
    this.lastHp = hp;
  }
  setStreak(n: number): void {
    const s = this.q<HTMLElement>(".streak");
    s.hidden = n < 2;
    s.querySelector("b")!.textContent = String(n);
  }
  setCrosshairHot(hot: boolean): void {
    this.q(".crosshair").classList.toggle("hot", hot);
  }
  hitMarker(kill = false): void {
    const hm = this.q<HTMLElement>(".hm");
    hm.className = "hm " + (kill ? "kill" : "hit");
    void hm.offsetWidth;
    hm.classList.add("show");
    setTimeout(() => hm.classList.remove("show"), 180);
  }
  /** Directional damage indicator; rel = bearing relative to view (deg, + = right). */
  damageFrom(rel: number, strength: number): void {
    const d = this.q<HTMLElement>(".dmgdir");
    d.style.setProperty("--a", `${rel}deg`);
    d.style.setProperty("--s", String(Math.min(1, 0.4 + strength)));
    d.classList.remove("show");
    void d.offsetWidth;
    d.classList.add("show");
  }
  setCompass(h: number): void {
    const c = this.q(".compass");
    // Split so the bearing reads as an instrument. As one string the degree
    // sign next to a cardinal letter looked like a temperature.
    c.querySelector("b")!.textContent = String(Math.round(h)).padStart(3, "0");
    c.querySelector("span")!.textContent = cardinal(h);
  }
  feed(text: string): void {
    const d = document.createElement("div");
    d.textContent = text;
    const f = this.q(".feed");
    f.prepend(d);
    while (f.children.length > 5) f.lastChild?.remove();
    setTimeout(() => d.remove(), 6000);
  }
  banner(text: string | null, kind: "" | "warn" | "dead" | "good" = "", ms = 2500): void {
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    const b = this.q<HTMLElement>(".banner");
    if (!text) {
      b.hidden = true;
      return;
    }
    b.textContent = text;
    b.className = `banner ${kind}`;
    b.hidden = false;
    if (ms > 0) this.bannerTimer = window.setTimeout(() => (b.hidden = true), ms);
  }
  flash(strength = 0.35): void {
    const f = this.q<HTMLElement>(".flash");
    f.style.setProperty("--f", String(strength));
    f.classList.add("on");
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove("on")));
  }
  /** Dead overlay with base direction. rel = relative bearing to base (deg), dist in m, secs to respawn. */
  setDead(dead: boolean, by = "", rel = 0, dist = 0, secs = 0): void {
    const d = this.q<HTMLElement>(".dead");
    d.hidden = !dead;
    if (!dead) return;
    this.q(".dead-by").textContent = by;
    this.q(".dead-timer").textContent = secs > 0 ? String(Math.ceil(secs)) : "";
    this.q(".dead-hint").textContent = secs > 0 ? "Возрождение через" : "Иди на свою базу";
    this.q<HTMLElement>(".dead-arrow").style.transform = `rotate(${rel}deg)`;
    this.q(".dead-dist").textContent = `${Math.round(dist)} м до базы`;
  }
  drawRadar(world: WorldState, heading: number): void {
    const cv = this.q<HTMLCanvasElement>(".radar canvas");
    const c = cv.getContext("2d");
    if (!c) return;
    const W = cv.width;
    const R = W / 2;
    const rangeM = GAME.RIFLE_RANGE_M;
    c.clearRect(0, 0, W, W);
    c.strokeStyle = "rgba(255,255,255,0.15)";
    c.beginPath();
    c.arc(R, R, R * 0.5, 0, Math.PI * 2);
    c.stroke();
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
      const ex = dx * Math.cos(rot) - -dz * Math.sin(rot);
      const ny = dx * Math.sin(rot) + -dz * Math.cos(rot);
      const k = (R * 0.95) / rangeM;
      return { px: R + ex * k, py: R - ny * k, d: Math.hypot(dx, dz) };
    };
    const myTeam = world.myPlayer()?.team;
    for (const o of world.objects.values()) {
      const { px, py, d } = plot(o.x, o.z);
      if (d > rangeM) continue;
      c.fillStyle = o.team ? (o.team === "red" ? "#ef4444" : "#3b82f6") : "#fde047";
      if (o.team) c.fillRect(px - 3, py - 3, 6, 6);
      else {
        c.beginPath();
        c.moveTo(px, py - 4);
        c.lineTo(px + 4, py);
        c.lineTo(px, py + 4);
        c.lineTo(px - 4, py);
        c.closePath();
        c.fill();
      }
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
    if (world.room && myTeam) {
      const b = world.room.bases[myTeam];
      const { px, py } = plot(b.x, b.z);
      const cx = Math.min(W - 6, Math.max(6, px));
      const cy = Math.min(W - 6, Math.max(6, py));
      c.strokeStyle = myTeam === "red" ? "#ef4444" : "#3b82f6";
      c.lineWidth = 2;
      c.strokeRect(cx - 4, cy - 4, 8, 8);
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
