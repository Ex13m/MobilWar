/** Back-camera video background for AR-lite mode (iOS Safari has no WebXR). */
export class CameraFeed {
  private stream: MediaStream | null = null;
  constructor(private video: HTMLVideoElement) {}

  async start(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      this.video.muted = true;
      this.video.setAttribute("playsinline", "true");
      await this.video.play().catch(() => undefined);
      return true;
    } catch (e) {
      console.warn("camera", (e as Error).message);
      return false;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
