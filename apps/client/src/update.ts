/**
 * Update-on-launch.
 *
 * An installed PWA keeps running the bundle it cached, so a deploy would only
 * reach players when the browser happened to refresh the worker. On every
 * launch we ask the service worker to re-check, and compare the build id baked
 * into this bundle against version.json on the server. A mismatch means the
 * phone is running an old build, so we drop the caches and reload once.
 */

declare const __BUILD_ID__: string;

/** Build id of the running bundle ("dev" when served by the dev server). */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

const RELOAD_FLAG = "mw_update_reload";

/**
 * Registers the worker and reloads if the server has a newer build.
 * Resolves once it is safe to start the app; never rejects.
 */
export async function checkForUpdate(): Promise<{ reloading: boolean; build: string }> {
  const out = { reloading: false, build: BUILD_ID };
  if (location.protocol !== "https:") return out;

  let reg: ServiceWorkerRegistration | undefined;
  if ("serviceWorker" in navigator) {
    try {
      reg = await navigator.serviceWorker.register("/sw.js");
      await reg.update();
    } catch {
      /* the app works without the worker */
    }
  }

  let remote: string | null = null;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) remote = ((await r.json()) as { build?: string }).build ?? null;
  } catch {
    /* offline: keep playing what we have */
  }

  const stale = remote !== null && BUILD_ID !== "dev" && remote !== BUILD_ID;
  const waiting = !!reg?.waiting && !!navigator.serviceWorker.controller;
  if (!stale && !waiting) {
    sessionStorage.removeItem(RELOAD_FLAG);
    return out;
  }

  // One reload per launch: if the new bundle still reports the old id the
  // server is mid-deploy, and looping would leave the player staring at a
  // white screen.
  if (sessionStorage.getItem(RELOAD_FLAG)) return out;
  sessionStorage.setItem(RELOAD_FLAG, "1");

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* ignore */
  }
  reg?.waiting?.postMessage("skip-waiting");
  out.reloading = true;
  location.reload();
  return out;
}
