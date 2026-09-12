import type { ClientMsg, ServerMsg } from "@mobilwar/shared";

type Handler = (msg: ServerMsg) => void;

/** WebSocket client with auto-reconnect, RTT estimate and server clock offset. */
export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: ClientMsg[] = [];
  private closed = false;
  private retry = 0;
  private pingTimer: number | null = null;
  rtt = 0;
  /** serverTime ≈ performance.now() + clockOffset */
  clockOffset = 0;
  connected = false;
  onStatus: (s: "connecting" | "open" | "closed") => void = () => {};
  /** Called after each (re)connect so the app can re-join. */
  onOpen: () => void = () => {};

  constructor(private url: string) {}

  connect(): void {
    this.closed = false;
    this.onStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.onStatus("open");
      this.onOpen();
      for (const m of this.queue.splice(0)) this.send(m);
      this.pingTimer = window.setInterval(() => this.send({ type: "ping", ct: performance.now() }), 3000);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.type === "pong") {
        const now = performance.now();
        this.rtt = now - msg.ct;
        this.clockOffset = msg.st - (msg.ct + this.rtt / 2);
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.onStatus("closed");
      if (!this.closed) {
        const delay = Math.min(8000, 500 * 2 ** this.retry++);
        setTimeout(() => this.connect(), delay);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (msg.type !== "pos" && msg.type !== "ping") this.queue.push(msg);
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  serverNow(): number {
    return performance.now() + this.clockOffset;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
