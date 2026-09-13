import { SLOTS, SLOT_NAMES, WEAPON_CATALOG, ttk, type Loadout, type Slot, type WeaponDef } from "@mobilwar/shared";
import { esc } from "./lobby.js";

const TRAIT_RU: Record<string, string> = {
  none: "", burst: "очередь", pellets: "дробь", pierce: "пробитие щита", chain: "цепь", burn: "поджиг", stun: "стан",
  lifesteal: "вампиризм", emp: "ЭМИ", homing: "самонаведение", cluster: "кассета", overheat: "перегрев", charge: "заряд", heal: "лечение",
};

/**
 * Loadout picker: one horizontally scrollable row per slot with 30 cards.
 * Tap a card to equip; `onChange` fires with the slot and weapon id.
 */
export function renderLoadout(root: HTMLElement, loadout: Loadout, onChange: (slot: Slot, id: string) => void): () => void {
  root.innerHTML = SLOTS.map((slot) => `
    <div class="lo-slot" data-slot="${slot}">
      <div class="lo-head"><b>${SLOT_NAMES[slot]}</b><span class="lo-cur">${esc(nameOf(loadout[slot]))}</span></div>
      <div class="lo-row">${WEAPON_CATALOG[slot].map((w, i) => card(w, i + 1, loadout[slot] === w.id)).join("")}</div>
    </div>`).join("");
  const handler = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".lo-card");
    if (!el) return;
    const slot = el.dataset.slot as Slot;
    const id = el.dataset.id!;
    loadout[slot] = id;
    root.querySelectorAll<HTMLElement>(`.lo-card[data-slot="${slot}"]`).forEach((c) => c.classList.toggle("active", c.dataset.id === id));
    const cur = root.querySelector<HTMLElement>(`.lo-slot[data-slot="${slot}"] .lo-cur`);
    if (cur) cur.textContent = nameOf(id);
    onChange(slot, id);
  };
  root.addEventListener("click", handler);
  // scroll each row to its active card
  root.querySelectorAll<HTMLElement>(".lo-card.active").forEach((c) => c.scrollIntoView({ block: "nearest", inline: "center" }));
  return () => root.removeEventListener("click", handler);
}

function nameOf(id: string): string {
  for (const s of SLOTS) {
    const w = WEAPON_CATALOG[s].find((x) => x.id === id);
    if (w) return w.name;
  }
  return id;
}

function card(w: WeaponDef, n: number, active: boolean): string {
  const rpm = Math.round(60000 / w.cooldownMs);
  const t = ttk(w);
  const bar = (v: number, max: number) => `<i style="width:${Math.min(100, Math.round((v / max) * 100))}%"></i>`;
  return `<div class="lo-card ${active ? "active" : ""}" data-slot="${w.slot}" data-id="${w.id}" style="--c:#${w.color.toString(16).padStart(6, "0")}">
    <div class="lo-n">${n}</div>
    <b>${esc(w.name)}</b>
    <small>${esc(w.blurb)}</small>
    <div class="lo-stat"><span>урон</span><div>${bar(w.damage * Math.max(1, w.pellets) * Math.max(1, w.burst), 100)}</div></div>
    <div class="lo-stat"><span>темп</span><div>${bar(rpm, 600)}</div></div>
    <div class="lo-stat"><span>дальн.</span><div>${bar(w.rangeM, 120)}</div></div>
    <div class="lo-meta">${w.damage}×${Math.max(1, w.pellets) * Math.max(1, w.burst)} · ${rpm}/мин · ${w.rangeM} м · маг ${w.mag}${w.reserve > 0 ? "/" + w.reserve : w.reserve < 0 ? "/∞" : ""} · TTK ${t.toFixed(1)} с${TRAIT_RU[w.trait] ? " · " + TRAIT_RU[w.trait] : ""}</div>
  </div>`;
}
