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
  orient: Orientation = { heading: 0, pitch: 0, roll: 0, alpha: 0, beta: 0, gamma: 0, absolute: false };
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
      if (typeof ev.webkitCompassHeading === "number" && !Number.isNaN(ev.webkitCompassHeading)) {
        // iOS: compass heading of the top of the device (portrait). Convert to back-camera heading.
        heading = ev.webkitCompassHeading;
        absolute = true;
      } else {
        // Android absolute: alpha is rotation of device around Z from north, counter-clockwise.
        heading = normalizeDeg(360 - alpha);
        absolute = e.absolute === true || this.orientEventName === "deviceorientationabsolute";
      }
      // When the phone is held upright (beta ~ 90), the camera points where the top edge points -> heading OK.
      // Correct for screen rotation (landscape).
      heading = normalizeDeg(heading + this.screenAngle() + this.headingOffset);
      // Camera pitch: upright phone => beta 90 => pitch 0. Flat on table (beta 0) => camera points down => -90.
      const pitch = beta - 90;
      this.hasCompass = absolute;
      this.orient = {
        heading: this.headingF.push(heading),
        pitch: this.pitchF.push(pitch),
        roll: gamma,
        alpha,
        beta,
        gamma,
        absolute,
      };
      this.emit();
    };
    this.orientListener = handler;
    this.orientEventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(this.orientEventName, handler as EventListener, { passive: true });
  }
}

export function isSecure(): boolean {
  return window.isSecureContext;
}
