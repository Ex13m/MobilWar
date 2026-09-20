import { GEN_SHIPPED, SFX, type SfxId } from "./assets.js";

/**
 * Audio: CC0 samples (Kenney) for shots/hits/UI + synthesised explosions & rockets,
 * all routed through a small mixer with a convolution reverb send (outdoor tail),
 * HRTF spatialisation for remote sources, and the screenless-mode radar.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbSend: GainNode | null = null;
  private buffers = new Map<SfxId, AudioBuffer>();
  private radarPanner: PannerNode | null = null;
  private radarNextAt = 0;
  private speaking = false;
  private heartbeatTimer: number | null = null;
  enabled = true;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    // reverb send
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 1.6, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    const p = ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "linear";
    p.refDistance = 1;
    p.maxDistance = 100;
    p.rolloffFactor = 0.3;
    p.connect(this.master);
    this.radarPanner = p;
    void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(
      (Object.keys(SFX) as SfxId[]).map(async (id) => {
        if (id.startsWith("g_") && !GEN_SHIPPED.has(id)) return;
        try {
          const r = await fetch(SFX[id]);
          const buf = await this.ctx!.decodeAudioData(await r.arrayBuffer());
          this.buffers.set(id, buf);
        } catch (e) {
          console.warn("sfx", id, (e as Error).message);
        }
      }),
    );
  }

  /** Play a sample. rel = {x right, z forward(-)} in metres for spatial sources. */
  play(id: SfxId, o: { gain?: number; rate?: number; rel?: { x: number; z: number }; dist?: number; reverb?: number; tilt?: number; body?: number } = {}): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.97 + Math.random() * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = o.gain ?? 0.8;
    let head: AudioNode = src;
    // Per-weapon spectral character: tilt < 0 darkens (heavy, suppressed),
    // tilt > 0 brightens (light, high-velocity). body boosts the low mids.
    if (o.tilt) {
      const sh = this.ctx.createBiquadFilter();
      sh.type = o.tilt > 0 ? "highshelf" : "lowpass";
      sh.frequency.value = o.tilt > 0 ? 2600 : Math.max(900, 9000 + o.tilt * 5200);
      if (o.tilt > 0) sh.gain.value = Math.min(12, o.tilt * 12);
      head.connect(sh);
      head = sh;
    }
    if (o.body) {
      const pk = this.ctx.createBiquadFilter();
      pk.type = "peaking";
      pk.frequency.value = 220;
      pk.Q.value = 0.9;
      pk.gain.value = Math.max(-9, Math.min(9, o.body * 9));
      head.connect(pk);
      head = pk;
    }
    head.connect(g);
    let out: AudioNode = g;
    if (o.rel) {
      const pan = this.ctx.createPanner();
      pan.panningModel = "HRTF";
      pan.distanceModel = "inverse";
      pan.refDistance = 3;
      pan.rolloffFactor = 1;
      pan.positionX.value = o.rel.x;
      pan.positionZ.value = o.rel.z;
      // distant shots sound muffled
      const lp = this.ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = Math.max(600, 8000 - (o.dist ?? 0) * 90);
      g.connect(lp);
      lp.connect(pan);
      out = pan;
    }
    out.connect(this.master);
    if (this.reverbSend) {
      const rs = this.ctx.createGain();
      rs.gain.value = o.reverb ?? 0.5;
      out.connect(rs);
      rs.connect(this.reverbSend);
    }
    src.start();
  }

  /** Play the first available sample from a preference list (generated set first, Kenney fallback). */
  private playFirst(ids: SfxId[], o: Parameters<GameAudio["play"]>[1] = {}): boolean {
    for (const id of ids) {
      if (this.buffers.has(id)) {
        this.play(id, o);
        return true;
      }
    }
    return false;
  }
  private flip = false;

  /* ---------- synthesised layers ---------- */

  private osc(freq: number, dur: number, type: OscillatorType, gain: number, sweepTo?: number, dest?: AudioNode): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    // A gain that starts at full value is a step, and a step on a phone speaker
    // is a click. Four milliseconds of attack removes it and changes nothing else.
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, lpFrom: number, lpTo: number, dest?: AudioNode): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 1.5;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    const t = this.ctx.currentTime;
    f.frequency.setValueAtTime(lpFrom, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, lpTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(f);
    f.connect(g);
    g.connect(dest ?? this.master);
    if (this.reverbSend) g.connect(this.reverbSend);
    s.start();
  }

  /* ---------- game cues ---------- */

  /** Stable 0..1 hash of a catalog id, so a weapon always sounds like itself. */
  private static idHash(id: string | undefined): number {
    if (!id) return 0.5;
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 10000) / 10000;
  }

  /**
   * The layer under the recorded shot. It used to be a square/saw/triangle blip,
   * which is a chiptune beep sitting on top of a cinematic recording — that is
   * what made every shot sound wrong. A shot is a transient plus a body: a short
   * filtered noise click and one sine thump, both of which a phone speaker can
   * actually reproduce.
   */
  private punch(h: number, weapon: "pistol" | "blaster" | "sniper" | "rocket"): void {
    const low = weapon === "rocket" ? 58 : weapon === "sniper" ? 76 : weapon === "pistol" ? 150 : 98;
    const light = weapon === "pistol";
    this.noise(0.03 + h * 0.025, light ? 0.09 : 0.15, light ? 9000 : 6000, 1100);
    this.osc(low * (0.9 + h * 0.25), weapon === "rocket" ? 0.2 : light ? 0.08 : 0.13, "sine", light ? 0.1 : 0.18, low * 0.55);
  }

  shot(weapon: "pistol" | "blaster" | "sniper" | "rocket", pitch?: number, weaponId?: string): void {
    const r = (base: number) => (pitch ? base * (pitch / (weapon === "rocket" ? 0.55 : weapon === "pistol" ? 1.5 : weapon === "sniper" ? 0.6 : 1.15)) : base);
    // Generated cinematic set: pitch scales lightly around 1.0 so variants still differ.
    const h = GameAudio.idHash(weaponId);
    // Variants still differ, but inside a range where a recording still sounds
    // like itself: below ~0.85 a clip turns into mud, above ~1.15 into a toy.
    const v = Math.max(0.86, Math.min(1.14, (pitch ? 0.94 + 0.06 * pitch : 1) * (0.94 + h * 0.13)));
    this.flip = !this.flip;
    // Each slot draws from a small pool; the id picks the pool entry, so the
    // same weapon always fires the same recording.
    const pools: Record<string, SfxId[][]> = {
      pistol: [
        ["g_pistol_a", "g_pistol_b"],
        ["g_pistol_b", "g_pistol_a"],
        ["g_ricochet", "g_pistol_a"],
      ],
      blaster: [
        ["g_rifle_a", "g_rifle_b"],
        ["g_rifle_b", "g_rifle_a"],
        ["g_minigun", "g_rifle_a"],
      ],
      sniper: [
        ["g_sniper"],
        ["g_sniper_charge", "g_sniper"],
        ["g_rifle_b", "g_sniper"],
      ],
      rocket: [
        ["g_rocket"],
        ["g_grenade", "g_rocket"],
        ["g_explosion_mid", "g_rocket"],
      ],
    };
    const pool = pools[weapon]!;
    const ids = pool[Math.floor(h * pool.length) % pool.length]!;
    const heavy = weapon === "sniper" || weapon === "rocket";
    if (
      this.playFirst(ids, {
        gain: heavy ? 0.95 : 0.8,
        rate: v,
        // A shot a metre from your face is not a cathedral: the long tail was
        // most of the "strange" in the old mix.
        reverb: weapon === "sniper" ? 0.45 : 0.18,
        tilt: (h - 0.5) * 0.7,
        body: (0.5 - h) * 0.6,
      })
    ) {
      this.punch(h, weapon);
      this.vibrate(weapon === "rocket" ? 40 : weapon === "sniper" ? 35 : 12);
      return;
    }
    switch (weapon) {
      case "rocket":
        this.play("blaster", { gain: 0.9, rate: r(0.55), reverb: 0.4 });
        this.noise(0.45, 0.5, 3000, 300);
        this.punch(h, "rocket");
        this.vibrate(40);
        break;
      case "pistol":
        this.play("laser1", { gain: 0.6, rate: r(1.5), reverb: 0.25 });
        this.punch(h, "pistol");
        this.vibrate(10);
        break;
      case "sniper":
        this.play("zap", { gain: 0.95, rate: r(0.6), reverb: 0.5 });
        this.noise(0.22, 0.55, 5000, 400);
        this.osc(52, 0.42, "sine", 0.55, 30);
        this.vibrate(35);
        break;
      default:
        this.play("laser4", { gain: 0.7, rate: r(1.15), reverb: 0.25 });
        this.punch(h, "blaster");
        this.vibrate(12);
    }
  }
  private chargeStarted = false;
  /** Sniper charge: one generated riser at the start of the hold, else a rising tone. */
  charge(k: number): void {
    if (k <= 0.12 && !this.chargeStarted) {
      this.chargeStarted = true;
      if (this.playFirst(["g_sniper_charge"], { gain: 0.7 })) return;
    }
    if (k >= 1) this.chargeStarted = false;
    if (!this.buffers.has("g_sniper_charge")) this.osc(300 + 900 * k, 0.09, "triangle", 0.12 + 0.2 * k);
  }
  minigunSpin(): void {
    this.playFirst(["g_minigun"], { gain: 0.7 });
  }
  reload(weapon: string, ms: number): void {
    const gen: Record<string, SfxId> = { pistol: "g_pistol_reload", blaster: "g_rifle_reload", sniper: "g_sniper_reload", rocket: "g_rifle_reload" };
    const id = gen[weapon];
    if (id && this.buffers.has(id)) {
      const buf = this.buffers.get(id)!;
      this.play(id, { gain: 0.8, rate: Math.max(0.6, Math.min(1.6, (buf.duration * 1000) / ms)) });
      return;
    }
    this.play("change", { gain: 0.6, rate: weapon === "sniper" ? 0.7 : 1.0 });
    setTimeout(() => this.play("impact", { gain: 0.35, rate: 1.6 }), ms * 0.5);
    setTimeout(() => this.play("confirm", { gain: 0.4, rate: 0.9 }), ms * 0.92);
  }
  remoteShot(weapon: string, rel: { x: number; z: number }, dist: number): void {
    const gain = Math.max(0.05, 1 - dist / 90);
    const gen: Record<string, SfxId[]> = { pistol: ["g_pistol_b", "g_pistol_a"], blaster: ["g_rifle_b", "g_rifle_a"], sniper: ["g_sniper"], rocket: ["g_rocket"], turret: ["g_turret"], drone: ["g_pistol_b"] };
    if (gen[weapon] && this.playFirst(gen[weapon]!, { gain, rel, dist, reverb: 0.8 })) return;
    if (weapon === "rocket") this.play("blaster", { gain, rate: 0.55, rel, dist, reverb: 0.8 });
    else if (weapon === "pistol") this.play("laser1", { gain: gain * 0.8, rate: 1.5, rel, dist, reverb: 0.4 });
    else if (weapon === "sniper") this.play("zap", { gain, rate: 0.6, rel, dist, reverb: 1 });
    else if (weapon === "turret") this.play("zap", { gain: gain * 0.8, rate: 0.9, rel, dist });
    else if (weapon === "drone") this.play("laser1", { gain: gain * 0.6, rate: 1.6, rel, dist });
    else this.play("laser4", { gain, rate: 1.1, rel, dist, reverb: 0.6 });
  }
  explosion(dist: number, rel?: { x: number; z: number }): void {
    const g = Math.max(0.15, 1 - dist / 80);
    if (this.playFirst(dist > 35 ? ["g_explosion_far", "g_explosion_big"] : dist > 12 ? ["g_explosion_mid", "g_explosion_big"] : ["g_explosion_big", "g_explosion_mid"], { gain: Math.min(1, g * 1.2), rel: dist > 6 ? rel : undefined, dist, reverb: 0.9 })) {
      this.vibrate(dist < 12 ? [120, 40, 80] : 60);
      return;
    }
    this.noise(1.4, 1.2 * g, 6000, 120);
    this.osc(60, 1.1, "sine", 0.9 * g, 28);
    this.osc(220, 0.25, "sawtooth", 0.3 * g, 50);
    this.play("destroy", { gain: 0.6 * g, rate: 0.7, rel, dist, reverb: 0.9 });
    this.vibrate(dist < 12 ? [120, 40, 80] : 60);
  }
  hitConfirm(kill = false): void {
    if (!this.playFirst(["g_hit_confirm"], { gain: kill ? 0.9 : 0.6, rate: kill ? 0.9 : 1.15 })) this.play("confirm", { gain: kill ? 0.9 : 0.55, rate: kill ? 1.0 : 1.4 });
    this.vibrate(15);
  }
  gotHit(dmg: number): void {
    if (!this.playFirst(["g_hit_body"], { gain: 1, rate: dmg >= 40 ? 0.85 : 1 })) this.play("impact", { gain: 0.9, rate: 0.9 });
    this.osc(110, 0.3, "sawtooth", 0.35, 45);
    this.vibrate(dmg >= 40 ? [120, 40, 120] : [60, 30, 60]);
  }
  /** A grenade striking the ground: a short, dry knock, positioned in the world. */
  grenadeBounce(rel?: { x: number; z: number }, dist = 5): void {
    if (!this.playFirst(["g_hit_metal"], { gain: 0.5, rate: 1.25, rel, dist, reverb: 0.15 })) this.osc(180, 0.07, "sine", 0.12, 90);
  }

  /** A shell tearing open in the air: a crack, then the crackle of the salute. */
  airburst(rel?: { x: number; z: number }, dist = 10): void {
    if (!this.playFirst(["g_explosion_mid", "g_grenade"], { gain: 0.75, rate: 1.2, rel, dist, reverb: 0.45 })) {
      this.noise(0.25, 0.5, 6000, 500);
      this.osc(70, 0.25, "sine", 0.3, 40);
    }
    this.vibrate(dist < 8 ? [60, 30, 40] : 15);
  }

  shieldHit(): void {
    if (!this.playFirst(["g_hit_shield"], { gain: 0.8 })) this.play("zap", { gain: 0.6, rate: 1.3 });
    this.vibrate(30);
  }
  barrierHit(rel?: { x: number; z: number }, dist = 5): void {
    this.playFirst(["g_hit_metal"], { gain: 0.7, rel, dist });
  }
  emp(dist: number): void {
    this.playFirst(["g_emp"], { gain: Math.max(0.3, 1 - dist / 40) });
  }
  lowHealthLoopId: number | null = null;
  kill(): void {
    if (!this.playFirst(["g_hit_confirm"], { gain: 1, rate: 0.8 })) this.play("confirm", { gain: 0.9, rate: 0.8 });
    setTimeout(() => this.playFirst(["g_victory", "powerup"], { gain: 0.5, rate: 1.1 }), 120);
    this.vibrate([30, 30, 30, 30, 60]);
  }
  death(): void {
    if (!this.playFirst(["g_death"], { gain: 1 })) {
      this.play("lowDown", { gain: 1, rate: 0.8 });
      this.noise(0.8, 0.5, 2000, 100);
    }
    this.vibrate(400);
  }
  respawn(): void {
    this.playFirst(["g_respawn", "powerup"], { gain: 0.8 });
  }
  pickup(kind: string): void {
    if (kind === "shield") this.playFirst(["g_shield_up", "g_pickup", "powerup"], { gain: 0.9 });
    else this.playFirst(["g_pickup", "powerup"], { gain: 0.8, rate: kind === "medkit" ? 1.05 : 1.2 });
    this.vibrate(25);
  }
  empty(): void {
    this.playFirst(["g_empty", "error"], { gain: 0.7, rate: 1.1 });
  }
  weaponSwitch(): void {
    this.playFirst(["g_switch", "change"], { gain: 0.7 });
  }
  overheat(): void {
    this.playFirst(["g_overheat"], { gain: 0.8 });
  }
  roundStart(): void {
    this.playFirst(["g_round_start"], { gain: 0.9 });
  }
  siren(): void {
    this.playFirst(["g_siren"], { gain: 0.8 });
  }
  crate(rel?: { x: number; z: number }, dist = 20): void {
    this.playFirst(["g_crate"], { gain: 0.8, rel, dist });
  }
  placed(): void {
    this.play("confirm", { gain: 0.6, rate: 0.7 });
  }
  warn(): void {
    this.play("error", { gain: 0.8, rate: 0.7 });
    setTimeout(() => this.play("error", { gain: 0.8, rate: 0.7 }), 220);
    this.vibrate([100, 50, 100]);
  }
  lockOn(): void {
    if (!this.playFirst(["g_lockon"], { gain: 0.5 })) this.osc(1500, 0.05, "sine", 0.3);
  }
  heartbeat(on: boolean): void {
    if (on && this.heartbeatTimer === null) {
      const beat = () => {
        if (this.playFirst(["g_heartbeat"], { gain: 0.7 })) return;
        this.osc(55, 0.12, "sine", 0.5, 40);
        setTimeout(() => this.osc(50, 0.1, "sine", 0.35, 35), 160);
      };
      beat();
      this.heartbeatTimer = window.setInterval(beat, 900);
    } else if (!on && this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  radar(bearingRel: number | null, distance: number, now = performance.now()): void {
    if (!this.ctx || !this.radarPanner || !this.enabled) return;
    if (bearingRel === null) return;
    if (now < this.radarNextAt) return;
    const d = Math.min(100, Math.max(0, distance));
    const interval = 150 + (1500 - 150) * Math.min(1, d / 60);
    this.radarNextAt = now + interval;
    const r = bearingRel * (Math.PI / 180);
    this.radarPanner.positionX.setValueAtTime(Math.sin(r) * 5, this.ctx.currentTime);
    this.radarPanner.positionZ.setValueAtTime(-Math.cos(r) * 5, this.ctx.currentTime);
    const freq = 1200 - 900 * Math.min(1, d / 60);
    this.osc(freq, 0.06, "sine", 0.5, undefined, this.radarPanner);
  }

  say(text: string): void {
    if (!("speechSynthesis" in window) || this.speaking) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = 1.15;
    this.speaking = true;
    u.onend = () => (this.speaking = false);
    u.onerror = () => (this.speaking = false);
    speechSynthesis.speak(u);
  }

  vibrate(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* iOS has no Vibration API */
    }
  }
}

/** Exponentially decaying noise impulse response (outdoor-ish tail). */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
