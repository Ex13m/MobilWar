import { HeadingFilter, LowPass, normalizeDeg } from "@mobilwar/shared";

export interface GeoFix {
  lat: number;
  lon: number;
  acc: number;
  t: number;
}

export interface Orientation {
  /** Compass heading (deg, 0 = north, clockwise) of the direction the phone's back camera points. */
  heading: number;
  /** Pitch of the camera (deg, + = up). */
  pitch: number;
  /** Roll (deg). */
  roll: number;
  /** Raw device orientation angles for the 3D camera. */
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
  /**
   * The compass heading before any smoothing. The AR camera uses it only as a
   * slow calibration of where north is; motion comes from the raw quaternion.
   */
  headingRaw: number;
  /** performance.now() of the last compass reading (0 = none yet). */
  compassAt: number;
  /** Which stream alpha/beta/gamma come from: 0 relative gyro, 1 absolute. Their zeros differ. */
  frame: number;
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
type IOSMotion = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Wraps Geolocation + DeviceOrientation with the platform quirks:
 * - iOS needs requestPermission() from a user gesture and exposes webkitCompassHeading.
 * - Android exposes 'deviceorientationabsolute' with alpha relative to north.
 * - Motion comes from the relative gyro stream; the compass only calibrates north.
 */
export class Sensors {
  fix: GeoFix | null = null;
  orient: Orientation = { heading: 0, pitch: 0, roll: 0, alpha: 0, beta: 0, gamma: 0, absolute: false, headingRaw: 0, compassAt: 0, frame: 0 };
  hasCompass = false;
  private headingF = new HeadingFilter(0.35);
  private pitchF = new LowPass(0.3);
  private geoWatch: number | null = null;
  private listeners = new Set<() => void>();
  private orientHandlers: Array<[string, (e: DeviceOrientationEvent) => void]> = [];
  /** performance.now() of the last compass reading. */
  private compassAt = 0;
  /** Manual calibration offset added to heading (deg). */
  headingOffset = 0;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Must be called from a user gesture (tap). */
  async requestPermissions(): Promise<{ orientation: boolean; geo: boolean }> {
    let orientation = true;
    const DOE = DeviceOrientationEvent as IOSOrientation;
    const DME = DeviceMotionEvent as IOSMotion;
    try {
      if (typeof DOE.requestPermission === "function") orientation = (await DOE.requestPermission()) === "granted";
      if (typeof DME.requestPermission === "function") await DME.requestPermission().catch(() => undefined);
    } catch {
      orientation = false;
    }
    const geo = await new Promise<boolean>((res) => {
      if (!("geolocation" in navigator)) return res(false);
      if (this.fix) return res(true); // watchPosition already delivered a fix — permission is granted
      navigator.geolocation.getCurrentPosition(
        () => res(true),
        () => res(false),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });
    return { orientation, geo };
  }

  start(): void {
    this.startGeo();
    this.startOrientation();
  }

  stop(): void {
    if (this.geoWatch !== null) navigator.geolocation.clearWatch(this.geoWatch);
    for (const [n, h] of this.orientHandlers) window.removeEventListener(n, h as EventListener);
    this.orientHandlers = [];
    this.geoWatch = null;
  }

  private startGeo(): void {
    if (!("geolocation" in navigator)) return;
    this.geoWatch = navigator.geolocation.watchPosition(
      (pos) => {
        this.fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          acc: pos.coords.accuracy,
          t: performance.now(),
        };
        this.emit();
      },
      (err) => console.warn("geo", err.message),
      { enableHighAccuracy: true, maximumAge: 500, timeout: 15000 },
    );
  }

  /*
   * Two streams: TreaskaAr's, plus a compass.
   *  - motion: the relative 'deviceorientation' (gyro + accelerometer, no
   *    magnetometer). It is all TreaskaAr uses and why its aim is silky; a
   *    compass in the loop jitters near steel and lags. It moves the camera
   *    every frame, unfiltered.
   *  - compass: only says where north is. Android: 'deviceorientationabsolute'
   *    turned into the back camera's heading (cameraAim — gimbal-safe, and the
   *    same in portrait and landscape because the camera does not turn with the
   *    screen). iOS: webkitCompassHeading, which CoreLocation reports along the
   *    back camera when the phone is upright, so no screen angle is added
   *    (LocAR reads it the same way); the old "+ screen angle" put landscape
   *    90° off. The AR camera folds it in slowly, only while still.
   * If a browser never sends a relative stream, the absolute one drives motion.
   */
  private startOrientation(): void {
    let relSeenAt = 0;
    let compass = NaN;
    const startedAt = performance.now();
    const publish = (alpha: number, beta: number, gamma: number, frame: number) => {
      const cam = cameraAim(alpha, beta, gamma);
      const heading = Number.isFinite(compass) ? compass : normalizeDeg(cam.heading + this.headingOffset);
      this.orient = {
        heading: this.headingF.push(heading),
        pitch: this.pitchF.push(cam.pitch),
        roll: gamma,
        alpha,
        beta,
        gamma,
        absolute: this.hasCompass,
        headingRaw: heading,
        compassAt: this.compassAt,
        frame,
      };
      this.emit();
    };
    const rel = (e: DeviceOrientationEvent) => {
      if (e.alpha === null && e.beta === null) return;
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      relSeenAt = performance.now();
      const wch = ev.webkitCompassHeading;
      if (typeof wch === "number" && Number.isFinite(wch) && wch >= 0 && (ev.webkitCompassAccuracy ?? 0) >= 0) {
        compass = normalizeDeg(wch + this.headingOffset);
        this.hasCompass = true;
        this.compassAt = relSeenAt;
      } else if (e.absolute === true) {
        // some browsers send an absolute frame under this name
        compass = normalizeDeg(cameraAim(alpha, beta, gamma).heading + this.headingOffset);
        this.hasCompass = true;
        this.compassAt = relSeenAt;
      }
      publish(alpha, beta, gamma, 0);
    };
    const abs = (e: DeviceOrientationEvent) => {
      if (e.alpha === null) return;
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      compass = normalizeDeg(cameraAim(alpha, beta, gamma).heading + this.headingOffset);
      this.hasCompass = true;
      this.compassAt = performance.now();
      // No relative stream (or it died): drive the camera from this one. Wait a
      // second first so a relative stream that starts late does not flip frames.
      if (this.compassAt - relSeenAt > 500 && this.compassAt - startedAt > 1000) publish(alpha, beta, gamma, 1);
    };
    this.orientHandlers = [
      ["deviceorientation", rel],
      ["deviceorientationabsolute", abs],
    ];
    for (const [n, h] of this.orientHandlers) window.addEventListener(n, h as EventListener, { passive: true });
  }
}

/**
 * Compass heading and pitch of the back camera, from the full device rotation
 * (W3C DeviceOrientation spec, "compass heading" example, plus the up component).
 *
 * `360 - alpha` is only the heading while the phone lies flat. Held upright
 * (beta ≈ 90°) — exactly how you aim at the horizon — the Z-X'-Y'' angles hit
 * gimbal lock: alpha and gamma trade off wildly for a hair of wrist roll while
 * the camera does not move at all. That garbage used to feed the north
 * calibration, so level shots wandered and a slight upward tilt "fixed" it.
 * The camera direction itself has no such singularity (only straight up/down).
 */
export function cameraAim(alpha: number, beta: number, gamma: number): { heading: number; pitch: number } {
  const D = Math.PI / 180;
  const cX = Math.cos(beta * D);
  const sX = Math.sin(beta * D);
  const cY = Math.cos(gamma * D);
  const sY = Math.sin(gamma * D);
  const cZ = Math.cos(alpha * D);
  const sZ = Math.sin(alpha * D);
  const vx = -cZ * sY - sZ * sX * cY; // east
  const vy = -sZ * sY + cZ * sX * cY; // north
  const vz = -cX * cY; // up
  return {
    heading: normalizeDeg(Math.atan2(vx, vy) / D),
    pitch: Math.asin(Math.max(-1, Math.min(1, vz))) / D,
  };
}

export function isSecure(): boolean {
  return window.isSecureContext;
}
