import { GameAudio } from "./audio.js";
import { Game } from "./game.js";
import { Net } from "./net.js";
import { Sensors, isSecure } from "./sensors.js";
import { loadProfile, wsUrl } from "./storage.js";
import { showLobby } from "./ui/lobby.js";

const root = document.getElementById("app")!;
const profile = loadProfile();
const net = new Net(wsUrl());
const sensors = new Sensors();
const audio = new GameAudio();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

async function boot(): Promise<void> {
  if (!isSecure()) {
    root.innerHTML = `<div class="screen"><div class="card"><h2>Нужен HTTPS</h2><p class="sub">Камера, GPS и компас работают только по защищённому соединению.</p></div></div>`;
    return;
  }
  net.connect();
  sensors.start(); // GPS starts asking permission immediately so the lobby can show nearby zones
  for (;;) {
    const res = await showLobby(root, profile, net, () => (sensors.fix ? { lat: sensors.fix.lat, lon: sensors.fix.lon } : null));
    // Permission gate (must be a user gesture on iOS)
    await permissionGate();
    const game = new Game({
      root,
      net,
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
