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
}

type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };
type IOSMotion = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

/**
 * Wraps Geolocation + DeviceOrientation with the platform quirks:
 * - iOS needs requestPermission() from a user gesture and exposes webkitCompassHeading.
 * - Android exposes 'deviceorientationabsolute' with alpha relative to north.
 * - Both are converted into the heading of the back camera, which is what the player aims with.
 */
export class Sensors {
  fix: GeoFix | null = null;
  orient: Orientation = { heading: 0, pitch: 0, roll: 0, alpha: 0, beta: 0, gamma: 0, absolute: false, headingRaw: 0 };
  hasCompass = false;
  private headingF = new HeadingFilter(0.35);
  private pitchF = new LowPass(0.3);
  private geoWatch: number | null = null;
  private listeners = new Set<() => void>();
  private orientListener: ((e: DeviceOrientationEvent) => void) | null = null;
  private orientEventName: "deviceorientationabsolute" | "deviceorientation" = "deviceorientation";
  /** Manual calibration offset added to heading (deg). */
  headingOffset = 0;
  /** Detects screen orientation angle to correct heading in landscape. */
  private screenAngle(): number {
    const so = screen.orientation?.angle;
    if (typeof so === "number") return so;
    return typeof window.orientation === "number" ? (window.orientation as number) : 0;
  }

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
    if (this.orientListener) window.removeEventListener(this.orientEventName, this.orientListener as EventListener);
    this.geoWatch = null;
    this.orientListener = null;
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

  private startOrientation(): void {
    const handler = (e: DeviceOrientationEvent) => {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const alpha = e.alpha ?? 0;
      const beta = e.beta ?? 0;
      const gamma = e.gamma ?? 0;
      let heading: number;
      let absolute = false;
      const cam = cameraAim(alpha, beta, gamma);
      if (typeof ev.webkitCompassHeading === "number" && !Number.isNaN(ev.webkitCompassHeading)) {
        // iOS: alpha is relative, webkitCompassHeading is the device heading
        // (tilt-compensated by the OS), screen rotation still to be added.
        heading = normalizeDeg(ev.webkitCompassHeading + this.screenAngle() + this.headingOffset);
        absolute = true;
      } else {
        // Android absolute: alpha is from north, so the full rotation gives the
        // back camera's true heading — gimbal-safe, independent of screen rotation.
        heading = normalizeDeg(cam.heading + this.headingOffset);
        absolute = e.absolute === true || this.orientEventName === "deviceorientationabsolute";
      }
      // Camera pitch from the full rotation (beta - 90 ignored roll).
      const pitch = cam.pitch;
      this.hasCompass = absolute;
      this.orient = {
        heading: this.headingF.push(heading),
        pitch: this.pitchF.push(pitch),
        roll: gamma,
        alpha,
        beta,
        gamma,
        absolute,
        headingRaw: heading,
      };
      this.emit();
    };
    this.orientListener = handler;
    this.orientEventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(this.orientEventName, handler as EventListener, { passive: true });
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
