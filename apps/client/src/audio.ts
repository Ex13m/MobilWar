/**
 * Audio + haptics. Everything is synthesised (no asset downloads):
 * - shot / hit / kill / death cues
 * - screenless "radar": a spatialised ping whose rate & pitch encode distance and
 *   whose stereo position encodes bearing relative to the phone heading.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private radarPanner: PannerNode | null = null;
  private radarTimer: number | null = null;
  private radarNextAt = 0;
  private speaking = false;
  enabled = true;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "linear";
    p.refDistance = 1;
    p.maxDistance = 100;
    p.rolloffFactor = 0.3;
    p.connect(this.master);
    this.radarPanner = p;
    this.ctx.listener.setPosition?.(0, 0, 0);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain = 0.4, dest?: AudioNode, sweepTo?: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(dest ?? this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain = 0.5): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.floor(sr * dur), sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start();
  }

  shot(): void {
    this.noise(0.12, 0.7);
    this.tone(180, 0.1, "square", 0.25, undefined, 60);
    this.vibrate(20);
  }
  remoteShot(distanceM: number): void {
    const g = Math.max(0.05, 1 - distanceM / 80) * 0.4;
    this.noise(0.08, g);
  }
  hitConfirm(): void {
    this.tone(1200, 0.08, "sine", 0.35);
    this.tone(1600, 0.08, "sine", 0.25);
    this.vibrate(15);
  }
  gotHit(): void {
    this.tone(120, 0.25, "sawtooth", 0.5, undefined, 50);
    this.vibrate([60, 30, 60]);
  }
  kill(): void {
    this.tone(660, 0.1, "triangle", 0.4);
    setTimeout(() => this.tone(880, 0.1, "triangle", 0.4), 90);
    setTimeout(() => this.tone(1320, 0.18, "triangle", 0.4), 180);
    this.vibrate([30, 30, 30]);
  }
  death(): void {
    this.tone(400, 0.6, "sawtooth", 0.5, undefined, 40);
    this.vibrate(300);
  }
  respawn(): void {
    this.tone(500, 0.12, "sine", 0.3, undefined, 1000);
  }
  warn(): void {
    this.tone(900, 0.15, "square", 0.3);
    setTimeout(() => this.tone(900, 0.15, "square", 0.3), 200);
    this.vibrate([100, 50, 100]);
  }
  lockOn(): void {
    this.tone(1500, 0.05, "sine", 0.3);
  }

  /**
   * Radar for screenless mode. bearingRel: degrees, 0 = straight ahead, + = right.
   * distance: metres. Call every frame; it schedules pings itself.
   */
  radar(bearingRel: number | null, distance: number, now = performance.now()): void {
    if (!this.ctx || !this.radarPanner || !this.enabled) return;
    if (bearingRel === null) return;
    if (now < this.radarNextAt) return;
    const d = Math.min(100, Math.max(0, distance));
    const interval = 150 + (1500 - 150) * Math.min(1, d / 60);
    this.radarNextAt = now + interval;
    const r = bearingRel * (Math.PI / 180);
    // three.js-like coords: x right, z forward negative
    this.radarPanner.positionX?.setValueAtTime(Math.sin(r) * 5, this.ctx.currentTime);
    this.radarPanner.positionZ?.setValueAtTime(-Math.cos(r) * 5, this.ctx.currentTime);
    const freq = 1200 - 900 * Math.min(1, d / 60);
    this.tone(freq, 0.06, "sine", 0.5, this.radarPanner);
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
