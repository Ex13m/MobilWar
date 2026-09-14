import { GameAudio } from "./audio.js";
import { Game } from "./game.js";
import { Sensors, isSecure } from "./sensors.js";
import { loadProfile } from "./storage.js";
import { showLobby } from "./ui/lobby.js";
import { ONBOARDING_VERSION, showOnboarding } from "./ui/onboarding.js";
import { checkForUpdate } from "./update.js";

const root = document.getElementById("app")!;
const profile = loadProfile();
const sensors = new Sensors();
const audio = new GameAudio();

async function boot(): Promise<void> {
  if (!isSecure()) {
    root.innerHTML = `<div class="screen"><div class="card"><h2>Нужен HTTPS</h2><p class="sub">Камера, GPS и компас работают только по защищённому соединению.</p></div></div>`;
    return;
  }
  // Installed PWAs keep serving their cached bundle, so every launch checks for
  // a newer build first; if one exists this reloads and never comes back.
  root.innerHTML = `<div class="screen"><div class="card"><h2>MobilWar</h2><p class="sub">Проверяю обновления…</p></div></div>`;
  const { reloading } = await checkForUpdate();
  if (reloading) return;

  sensors.start(); // GPS starts asking permission immediately so the lobby can show nearby zones
  if ((profile.onboarded ?? 0) < ONBOARDING_VERSION) await showOnboarding(root, profile);
  for (;;) {
    const res = await showLobby(root, profile, () => (sensors.fix ? { lat: sensors.fix.lat, lon: sensors.fix.lon } : null));
    // Permission gate (must be a user gesture on iOS)
    await permissionGate();
    const game = new Game({
      root,
      sensors,
      audio,
      profile,
      roomId: res.roomId,
      playMode: res.playMode,
      onExit: () => {
        /* loop continues to lobby */
      },
    });
    await new Promise<void>((resolve) => {
      const orig = game.exit.bind(game);
      game.exit = () => {
        orig();
        resolve();
      };
      void game.start();
    });
  }
}

function permissionGate(): Promise<void> {
  return new Promise((resolve) => {
    root.innerHTML = `<div class="screen"><div class="card">
      <h2>Разрешения</h2>
      <p class="sub">Нужны GPS (позиция), компас (прицел), камера (AR) и звук (радар). Нажми кнопку и разреши всё.</p>
      <button class="btn block" id="go">Разрешить и играть</button>
      <p class="hint" style="margin-top:10px">Калибровка компаса: нарисуй телефоном восьмёрку в воздухе.</p>
      <p class="hint">Правила безопасности: не бегай через дорогу, смотри под ноги, слушай судью.</p>
      <div class="error" id="perr"></div>
    </div></div>`;
    root.querySelector("#go")!.addEventListener("click", async () => {
      audio.unlock();
      const r = await sensors.requestPermissions();
      sensors.stop();
      sensors.start();
      if (!r.geo) {
        root.querySelector("#perr")!.textContent = "Без GPS играть нельзя. Разреши геолокацию в настройках браузера.";
        return;
      }
      if (!r.orientation) root.querySelector("#perr")!.textContent = "Компас не разрешён — прицел будет неточным.";
      try {
        await document.documentElement.requestFullscreen?.();
      } catch {
        /* ignore */
      }
      try {
        // Lock portrait where supported (Android PWA)
        await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("portrait");
      } catch {
        /* ignore */
      }
      resolve();
    });
  });
}

void boot();
