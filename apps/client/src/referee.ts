import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { fromLocal, type GameMode, type LatLon, type PlayerPublic, type RoomInfo, type ServerMsg, type Snapshot, type WorldObject } from "@mobilwar/shared";
import { Net } from "./net.js";
import { loadProfile } from "./storage.js";
import { wsUrlFor } from "./api.js";
import { MODE_NAMES, esc } from "./ui/lobby.js";

/**
 * Referee dashboard (tablet): live map of players/objects, geofence editing,
 * start/stop/reset, kick. Joins the room with playMode "referee" (invisible, non-combatant).
 */
const root = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
let roomId = (params.get("room") ?? "").toUpperCase();
const profile = loadProfile();

root.innerHTML = `
  <div class="bar">
    <b>Судья</b>
    <input id="code" placeholder="КОД" maxlength="4" style="width:90px;text-transform:uppercase" value="${esc(roomId)}" />
    <button class="btn secondary" id="connect">Подключить</button>
    <select id="mode">${(Object.keys(MODE_NAMES) as GameMode[]).map((m) => `<option value="${m}">${MODE_NAMES[m]}</option>`).join("")}</select>
    <button class="btn" id="start">▶ Старт</button>
    <button class="btn danger" id="stop">■ Стоп</button>
    <button class="btn secondary" id="reset">↺ Сброс</button>
    <button class="btn secondary" id="zone">⌖ Зона = центр карты</button>
    <input id="radius" type="number" min="20" max="500" value="150" style="width:80px" title="Радиус, м" />
    <span id="status" class="hint">не подключено</span>
  </div>
  <div style="position:relative"><div id="map"></div><div class="side" id="side"></div></div>
  <div class="log" id="log"></div>`;

const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
const logEl = $("#log");
function log(t: string): void {
  const d = document.createElement("div");
  d.textContent = `${new Date().toLocaleTimeString()} ${t}`;
  logEl.prepend(d);
  while (logEl.children.length > 50) logEl.lastChild?.remove();
}

const map = L.map("map", { zoomControl: true }).setView([55.75, 37.62], 17);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, attribution: "© OpenStreetMap" }).addTo(map);
let zoneCircle: L.Circle | null = null;
const playerMarkers = new Map<string, L.Marker>();
const objectMarkers = new Map<string, L.Marker>();
let room: RoomInfo | null = null;
let centered = false;

let net: Net | null = null;
function connect(): void {
  net?.close();
  if (!roomId) return;
  net = new Net(wsUrlFor(roomId));
  net.onStatus = (s) => ($("#status").textContent = s);
  net.onOpen = () => join();
  net.on(onMsg);
  net.connect();
}
function join(): void {
  net?.send({ type: "join", roomId, nick: "Судья", avatar: "robot", playMode: "referee", deviceId: profile.deviceId + "_ref" });
}
if (roomId) connect();

$("#connect").addEventListener("click", () => {
  roomId = $<HTMLInputElement>("#code").value.trim().toUpperCase();
  history.replaceState(null, "", `?room=${roomId}`);
  connect();
});
$("#start").addEventListener("click", () => net?.send({ type: "ref", cmd: "start" }));
$("#stop").addEventListener("click", () => net?.send({ type: "ref", cmd: "stop" }));
$("#reset").addEventListener("click", () => net?.send({ type: "ref", cmd: "reset" }));
$("#mode").addEventListener("change", () => net?.send({ type: "ref", cmd: "set_mode", mode: $<HTMLSelectElement>("#mode").value as GameMode }));
$("#zone").addEventListener("click", () => {
  const c = map.getCenter();
  net?.send({ type: "ref", cmd: "set_zone", origin: { lat: c.lat, lon: c.lng }, radiusM: Number($<HTMLInputElement>("#radius").value) || 150 });
});

function onMsg(m: ServerMsg): void {
  switch (m.type) {
    case "welcome":
      room = m.room;
      log(`Подключено к ${room.name} (${room.id})`);
      $<HTMLSelectElement>("#mode").value = room.mode;
      $<HTMLInputElement>("#radius").value = String(room.radiusM);
      break;
    case "snapshot":
      render(m.snap);
      break;
    case "kill":
      log(`${name(m.killerId)} → ${name(m.victimId)} (${m.weapon === "turret" ? "турель" : "винтовка"})`);
      break;
    case "event":
      log(`событие: ${m.kind}`);
      break;
    case "error":
      if (m.code === "rejoin") join();
      else log(`ошибка: ${m.text}`);
      break;
  }
}

let lastSnap: Snapshot | null = null;
function name(id: string): string {
  return lastSnap?.players.find((p) => p.id === id)?.nick ?? id;
}

function render(s: Snapshot): void {
  lastSnap = s;
  room = s.room;
  const o = room.origin;
  if (!centered) {
    map.setView([o.lat, o.lon], 18);
    centered = true;
  }
  if (!zoneCircle) zoneCircle = L.circle([o.lat, o.lon], { radius: room.radiusM, color: "#fbbf24", fillOpacity: 0.05 }).addTo(map);
  zoneCircle.setLatLng([o.lat, o.lon]).setRadius(room.radiusM);

  const seen = new Set<string>();
  for (const p of s.players) {
    seen.add(p.id);
    const ll = fromLocal(o, p);
    let mk = playerMarkers.get(p.id);
    if (!mk) {
      mk = L.marker([ll.lat, ll.lon], { icon: playerIcon(p) }).addTo(map);
      playerMarkers.set(p.id, mk);
    }
    mk.setLatLng([ll.lat, ll.lon]).setIcon(playerIcon(p));
    mk.bindTooltip(`${p.nick} · ${p.hp} HP · ±${Math.round(p.acc)}м`, { permanent: false });
  }
  for (const [id, mk] of playerMarkers) if (!seen.has(id)) (mk.remove(), playerMarkers.delete(id));

  const seenO = new Set<string>();
  for (const ob of s.objects) {
    seenO.add(ob.id);
    const ll = fromLocal(o, ob);
    let mk = objectMarkers.get(ob.id);
    if (!mk) {
      mk = L.marker([ll.lat, ll.lon], { icon: objIcon(ob) }).addTo(map);
      objectMarkers.set(ob.id, mk);
    }
    mk.setLatLng([ll.lat, ll.lon]);
  }
  for (const [id, mk] of objectMarkers) if (!seenO.has(id)) (mk.remove(), objectMarkers.delete(id));

  const left = Math.max(0, room.phaseEndsAt - s.t);
  $("#side").innerHTML =
    `<div><b>${esc(room.name)}</b> · ${MODE_NAMES[room.mode]}<br>${phaseName(room.phase)} ${room.phase === "playing" ? fmt(left) : ""}<br><span style="color:#ef4444">${room.score.red}</span> : <span style="color:#3b82f6">${room.score.blue}</span></div>` +
    s.players
      .map(
        (p) =>
          `<div class="p"><span style="color:${p.team === "red" ? "#ef4444" : "#3b82f6"}">${p.alive ? "●" : "○"} ${esc(p.nick)}</span><span>${p.kills}/${p.deaths} · ${p.hp} <button data-kick="${p.id}" style="background:none;border:0;color:#9ca3af;cursor:pointer">✖</button></span></div>`,
      )
      .join("");
  $("#side").querySelectorAll<HTMLButtonElement>("[data-kick]").forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm("Исключить игрока?")) net?.send({ type: "ref", cmd: "kick", playerId: b.dataset.kick });
    }),
  );
}

function playerIcon(p: PlayerPublic): L.DivIcon {
  const c = p.team === "red" ? "#ef4444" : "#3b82f6";
  return L.divIcon({ className: "", html: `<div class="marker-player" style="background:${c};opacity:${p.alive ? 1 : 0.4}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
}
function objIcon(o: WorldObject): L.DivIcon {
  const c = o.team ? (o.team === "red" ? "#ef4444" : "#3b82f6") : "#fff";
  const sym = o.kind === "turret" ? "T" : o.kind === "barrier" ? "▬" : o.kind === "medkit" ? "+" : "⚑";
  return L.divIcon({ className: "", html: `<div class="marker-obj" style="background:${c}"></div><div style="position:absolute;top:-2px;left:18px;color:#fff;font-size:11px">${sym}</div>`, iconSize: [14, 14], iconAnchor: [7, 7] });
}
function phaseName(p: RoomInfo["phase"]): string {
  return { lobby: "Лобби", countdown: "Отсчёт", playing: "Бой", ended: "Завершено" }[p];
}
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export type { LatLon };
