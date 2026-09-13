import { SFX, type SfxId } from "./assets.js";

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
  play(id: SfxId, o: { gain?: number; rate?: number; rel?: { x: number; z: number }; dist?: number; reverb?: number } = {}): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (0.97 + Math.random() * 0.06);
    const g = this.ctx.createGain();
    g.gain.value = o.gain ?? 0.8;
    src.connect(g);
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

  /* ---------- synthesised layers ---------- */

  private osc(freq: number, dur: number, type: OscillatorType, gain: number, sweepTo?: number, dest?: AudioNode): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    g.gain.setValueAtTime(gain, t);
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

  shot(weapon: "blaster" | "rocket"): void {
    if (weapon === "rocket") {
      this.play("blaster", { gain: 0.9, rate: 0.55, reverb: 0.7 });
      this.noise(0.5, 0.6, 3000, 300);
      this.osc(90, 0.35, "sawtooth", 0.35, 40);
      this.vibrate(40);
    } else {
      this.play("laser4", { gain: 0.7, rate: 1.15, reverb: 0.4 });
      this.osc(140, 0.06, "square", 0.15, 60);
      this.vibrate(12);
    }
  }
  remoteShot(weapon: string, rel: { x: number; z: number }, dist: number): void {
    const gain = Math.max(0.05, 1 - dist / 90);
    if (weapon === "rocket") this.play("blaster", { gain, rate: 0.55, rel, dist, reverb: 0.8 });
    else if (weapon === "turret") this.play("zap", { gain: gain * 0.8, rate: 0.9, rel, dist });
    else if (weapon === "drone") this.play("laser1", { gain: gain * 0.6, rate: 1.6, rel, dist });
    else this.play("laser4", { gain, rate: 1.1, rel, dist, reverb: 0.6 });
  }
  explosion(dist: number, rel?: { x: number; z: number }): void {
    const g = Math.max(0.15, 1 - dist / 80);
    this.noise(1.4, 1.2 * g, 6000, 120);
    this.osc(60, 1.1, "sine", 0.9 * g, 28);
    this.osc(220, 0.25, "sawtooth", 0.3 * g, 50);
    this.play("destroy", { gain: 0.6 * g, rate: 0.7, rel, dist, reverb: 0.9 });
    this.vibrate(dist < 12 ? [120, 40, 80] : 60);
  }
  hitConfirm(kill = false): void {
    this.play("confirm", { gain: kill ? 0.9 : 0.55, rate: kill ? 1.0 : 1.4 });
    this.vibrate(15);
  }
  gotHit(dmg: number): void {
    this.play("impact", { gain: 0.9, rate: 0.9 });
    this.osc(110, 0.3, "sawtooth", 0.45, 45);
    this.vibrate(dmg >= 40 ? [120, 40, 120] : [60, 30, 60]);
  }
  shieldHit(): void {
    this.play("zap", { gain: 0.6, rate: 1.3 });
    this.vibrate(30);
  }
  kill(): void {
    this.play("confirm", { gain: 0.9, rate: 0.8 });
    setTimeout(() => this.play("powerup", { gain: 0.5, rate: 1.2 }), 120);
    this.vibrate([30, 30, 30, 30, 60]);
  }
  death(): void {
    this.play("lowDown", { gain: 1, rate: 0.8 });
    this.noise(0.8, 0.5, 2000, 100);
    this.vibrate(400);
  }
  respawn(): void {
    this.play("powerup", { gain: 0.8, rate: 1 });
  }
  pickup(kind: string): void {
    this.play("powerup", { gain: 0.8, rate: kind === "shield" ? 0.8 : kind === "medkit" ? 1.1 : 1.3 });
    this.vibrate(25);
  }
  empty(): void {
    this.play("error", { gain: 0.6, rate: 1.2 });
  }
  weaponSwitch(): void {
    this.play("change", { gain: 0.7 });
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
    this.osc(1500, 0.05, "sine", 0.3);
  }
  heartbeat(on: boolean): void {
    if (on && this.heartbeatTimer === null) {
      const beat = () => {
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
