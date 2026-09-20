import { AVATARS, GAME, type AvatarId, type GameMode, type PlayMode, type RoomInfo } from "@mobilwar/shared";
import { createRoom, listRooms } from "../api.js";
import { renderLoadout } from "./loadout.js";
import { saveProfile, type Profile } from "../storage.js";
import { showOnboarding } from "./onboarding.js";
import { BUILD_ID } from "../update.js";

export interface LobbyResult {
  roomId: string;
  playMode: PlayMode;
}

const AVATAR_NAMES: Record<AvatarId, string> = {
  scout: "🟢 Разведчик",
  heavy: "🟠 Штурмовик",
  medic: "⚪ Медик",
  sniper: "🟣 Снайпер",
  robot: "🔵 Робот",
  ninja: "⚫ Ниндзя",
};

export const MODE_NAMES: Record<GameMode, string> = {
  tdm: "Командный бой",
  ctf: "Захват флага",
  koth: "Царь горы",
  infection: "Заражение",
  turret_defense: "Оборона турелей",
};

/** Lobby: profile, room list (nearest first), create/join. Resolves when the player taps "Играть". */
export function showLobby(root: HTMLElement, profile: Profile, getFix: () => { lat: number; lon: number } | null): Promise<LobbyResult> {
  return new Promise((resolve) => {
    const params = new URLSearchParams(location.search);
    const preRoom = (params.get("room") ?? profile.lastRoom ?? "").toUpperCase();
    root.innerHTML = `
      <div class="screen hero art-lobby">
        <h1>MobilWar</h1>
        <p class="sub">AR-бой на школьном дворе. Телефон — оружие, двор — карта.</p>
        <div class="card">
          <label>Позывной</label>
          <input id="nick" maxlength="16" placeholder="Например, Сокол" value="${esc(profile.nick)}" />
          <label>Аватар (его видят все)</label>
          <div class="avatar-grid" id="avatars">${AVATARS.map((a) => `<div class="chip ${a === profile.avatar ? "active" : ""}" data-a="${a}">${AVATAR_NAMES[a]}</div>`).join("")}</div>
          <label>Режим управления</label>
          <div class="chips" id="pm">
            <div class="chip ${profile.playMode === "ar" ? "active" : ""}" data-m="ar">📷 AR — смотрю в экран</div>
            <div class="chip ${profile.playMode === "screenless" ? "active" : ""}" data-m="screenless">🎧 Без экрана — навожу телефон</div>
          </div>
        </div>
        <div class="card">
          <h2>Оружие <span class="hint" style="font-weight:400">4 слота × 30 вариантов, листай</span></h2>
          <div id="loadout"></div>
        </div>
        <div class="card">
          <h2>Войти по коду</h2>
          <div class="row">
            <input id="code" maxlength="4" placeholder="КОД" style="text-transform:uppercase;letter-spacing:.2em;font-weight:700" value="${esc(preRoom)}" />
            <button class="btn" id="join">Играть</button>
          </div>
          <div class="error" id="err"></div>
        </div>
        <div class="card">
          <h2>Зоны рядом</h2>
          <div class="rooms" id="rooms"><span class="hint">Ищу зоны…</span></div>
        </div>
        <div class="card">
          <h2>Создать зону</h2>
          <label>Название</label>
          <input id="rname" maxlength="32" placeholder="Двор школы №1" />
          <label>Режим игры</label>
          <select id="rmode">${(Object.keys(MODE_NAMES) as GameMode[]).map((m) => `<option value="${m}">${MODE_NAMES[m]}</option>`).join("")}</select>
          <label>Радиус зоны, м (центр — там, где ты стоишь)</label>
          <input id="rradius" type="number" min="20" max="500" value="${GAME.DEFAULT_ZONE_RADIUS_M}" />
          <label class="row-check"><input id="rdoom" type="checkbox" /> Дум-режим — правила 1993</label>
          <p class="hint">Урон кубиками, без падения на дистанции, попадание сбивает прицел, высота не важна, перезарядка мгновенная, своя ракета бьёт в полную силу.</p>
          <div style="height:12px"></div>
          <button class="btn secondary block" id="create">Создать и войти</button>
          <p class="hint" style="margin-top:8px">Судья: открой <b>/referee.html?room=КОД</b> на планшете.</p>
        </div>
        <p class="hint" id="netstat">Подключение…</p>
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
          <button class="btn secondary" id="howto">Как играть</button>
          <span class="hint">сборка ${esc(BUILD_ID)}</span>
        </div>
      </div>`;

    const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    const err = $("#err");

    $("#howto").addEventListener("click", () => {
      // Replay the walkthrough, then rebuild the lobby from scratch.
      void showOnboarding(root, profile).then(() => {
        void showLobby(root, profile, getFix).then(resolve);
      });
    });

    $("#avatars").addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
      if (!chip) return;
      $("#avatars").querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      profile.avatar = chip.dataset.a as AvatarId;
    });
    $("#pm").addEventListener("click", (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
      if (!chip) return;
      $("#pm").querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      profile.playMode = chip.dataset.m as PlayMode;
    });

    renderLoadout($("#loadout"), profile.loadout, () => saveProfile(profile));

    function commitProfile(): boolean {
      profile.nick = $<HTMLInputElement>("#nick").value.trim();
      if (!profile.nick) {
        err.textContent = "Введи позывной";
        return false;
      }
      saveProfile(profile);
      return true;
    }

    function go(roomId: string): void {
      profile.lastRoom = roomId;
      saveProfile(profile);
      resolve({ roomId, playMode: profile.playMode });
    }

    $("#join").addEventListener("click", () => {
      if (!commitProfile()) return;
      const code = $<HTMLInputElement>("#code").value.trim().toUpperCase();
      if (code.length < 3) {
        err.textContent = "Введи код зоны";
        return;
      }
      go(code);
    });

    $("#create").addEventListener("click", () => {
      if (!commitProfile()) return;
      const fix = getFix();
      if (!fix) {
        err.textContent = "Нет GPS. Разреши геолокацию и выйди на улицу";
        return;
      }
      err.textContent = "";
      createRoom({
        name: $<HTMLInputElement>("#rname").value.trim() || "Зона",
        mode: $<HTMLSelectElement>("#rmode").value as GameMode,
        origin: fix,
        radiusM: Number($<HTMLInputElement>("#rradius").value) || GAME.DEFAULT_ZONE_RADIUS_M,
        doom: $<HTMLInputElement>("#rdoom").checked,
      })
        .then((room) => go(room.id))
        .catch((e: Error) => (err.textContent = `Не удалось создать зону: ${e.message}`));
    });

    const roomsEl = $("#rooms");
    function renderRooms(rooms: RoomInfo[]): void {
      if (!rooms.length) {
        roomsEl.innerHTML = `<span class="hint">Пока пусто — создай зону</span>`;
        return;
      }
      roomsEl.innerHTML = rooms
        .slice(0, 8)
        .map(
          (r) =>
            `<div class="room" data-id="${r.id}"><div><b>${esc(r.name)}</b><br><small>${MODE_NAMES[r.mode]}${r.doom ? " · DOOM" : ""} · ${r.playerCount} игр. · ${r.phase === "playing" ? "идёт бой" : "лобби"}</small></div><b>${r.id}</b></div>`,
        )
        .join("");
    }
    roomsEl.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".room");
      if (!el || !commitProfile()) return;
      go(el.dataset.id!);
    });
    const poll = () =>
      listRooms(getFix())
        .then((rooms) => {
          $("#netstat").textContent = "Сервер на связи";
          renderRooms(rooms);
        })
        .catch(() => ($("#netstat").textContent = "Нет связи с сервером…"));
    poll();
    const timer = setInterval(poll, 5000);
    const cleanup = () => clearInterval(timer);
    // resolve wrapper cleanup
    const origResolve = resolve;
    resolve = ((v: LobbyResult) => {
      cleanup();
      origResolve(v);
    }) as typeof resolve;
  });
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
