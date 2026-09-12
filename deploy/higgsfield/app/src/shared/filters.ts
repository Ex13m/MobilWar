import { angleDiff, normalizeDeg } from "./geo";

/** Exponential low-pass for scalar values. */
export class LowPass {
  private v: number | null = null;
  constructor(private alpha: number) {}
  push(x: number): number {
    this.v = this.v === null ? x : this.v + this.alpha * (x - this.v);
    return this.v;
  }
  get value(): number | null {
    return this.v;
  }
  reset(): void {
    this.v = null;
  }
}

/** Low-pass for compass headings (handles wrap-around at 0/360). */
export class HeadingFilter {
  private v: number | null = null;
  constructor(private alpha = 0.25) {}
  push(h: number): number {
    if (this.v === null) this.v = normalizeDeg(h);
    else this.v = normalizeDeg(this.v + this.alpha * angleDiff(h, this.v));
    return this.v;
  }
  get value(): number | null {
    return this.v;
  }
}

/**
 * Accuracy-weighted 2D position smoother ("Kalman-lite").
 * Better-accuracy samples pull harder; velocity is estimated for dead reckoning.
 */
export class PositionFilter {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  acc = Infinity;
  t = 0;
  private init = false;

  constructor(private processNoiseMps = 1.5) {}

  push(x: number, z: number, acc: number, t: number): { x: number; z: number } {
    if (!this.init) {
      this.x = x;
      this.z = z;
      this.acc = acc;
      this.t = t;
      this.init = true;
      return { x, z };
    }
    const dt = Math.max(0, (t - this.t) / 1000);
    // predict
    const px = this.x + this.vx * dt;
    const pz = this.z + this.vz * dt;
    const pacc = Math.hypot(this.acc, this.processNoiseMps * dt);
    // gain
    const k = pacc ** 2 / (pacc ** 2 + acc ** 2);
    const nx = px + k * (x - px);
    const nz = pz + k * (z - pz);
    if (dt > 0.05) {
      this.vx = 0.7 * this.vx + 0.3 * ((nx - this.x) / dt);
      this.vz = 0.7 * this.vz + 0.3 * ((nz - this.z) / dt);
    }
    this.x = nx;
    this.z = nz;
    this.acc = Math.sqrt((1 - k) * pacc ** 2);
    this.t = t;
    return { x: nx, z: nz };
  }

  /** Dead-reckoned position at time t (clamped extrapolation of 1 s). */
  predict(t: number): { x: number; z: number } {
    const dt = Math.min(1, Math.max(0, (t - this.t) / 1000));
    return { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
  }
}
