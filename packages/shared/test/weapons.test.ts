import { describe, expect, it } from "vitest";
import { SLOTS, WEAPON_CATALOG, catalogCone, defaultLoadout, sanitizeLoadout, ttk, weaponById } from "../src/weapons.js";
import { GAME } from "../src/constants.js";

describe("weapon catalog", () => {
  it("has 30 weapons per slot, 120 total, unique ids and names", () => {
    const all = SLOTS.flatMap((s) => WEAPON_CATALOG[s]);
    expect(all.length).toBe(120);
    for (const s of SLOTS) expect(WEAPON_CATALOG[s].length).toBe(30);
    expect(new Set(all.map((w) => w.id)).size).toBe(120);
    expect(new Set(all.map((w) => w.name)).size).toBe(120);
    for (const w of all) expect(w.slot).toBe(w.id.split("_")[0]);
  });
  it("every weapon has sane numbers", () => {
    for (const s of SLOTS)
      for (const w of WEAPON_CATALOG[s]) {
        expect(w.damage).toBeGreaterThan(0);
        expect(w.cooldownMs).toBeGreaterThanOrEqual(45);
        expect(w.mag).toBeGreaterThan(0);
        expect(w.reloadMs).toBeGreaterThanOrEqual(500);
        expect(w.rangeM).toBeGreaterThanOrEqual(10);
        expect(w.cone).toBeGreaterThan(0);
        if (w.slot === "rocket" && w.pellets === 1) expect(w.splashM).toBeGreaterThan(0);
        if (w.trait === "charge") expect(w.chargedDamage).toBeGreaterThan(w.damage);
        if (w.trait === "burst") expect(w.burst).toBeGreaterThan(1);
        if (w.trait === "pellets") expect(w.pellets).toBeGreaterThan(1);
        if (w.trait === "stun") expect(w.stunMs).toBeGreaterThan(0);
        if (w.trait === "burn") expect(w.burnS).toBeGreaterThan(0);
      }
  });
  it("time-to-kill stays within a testable band (training weapons excluded)", () => {
    for (const s of SLOTS)
      for (const w of WEAPON_CATALOG[s]) {
        if (w.name.startsWith("Ноль")) continue;
        const utility = w.trait === "heal" || w.trait === "emp" || (w.trait === "stun" && w.damage < 20);
        if (utility) continue;
        const t = ttk(w);
        expect(t, `${w.name} ttk=${t}`).toBeLessThanOrEqual(6);
      }
  });
  it("loadout sanitising rejects wrong slots", () => {
    expect(sanitizeLoadout({ pistol: "blaster_03", sniper: "sniper_05" })).toEqual({ ...defaultLoadout(), sniper: "sniper_05" });
    expect(weaponById("rocket_16")?.pellets).toBe(8);
  });
  it("pistol cone widens past 10 m", () => {
    const p = WEAPON_CATALOG.pistol[0]!;
    expect(catalogCone(p, 5, 0, false)).toBe(5);
    expect(catalogCone(p, 20, 0, false)).toBeCloseTo(14);
  });
});

describe("выбор оружия безопасен для ребёнка", () => {
  it("тренировочные стволы помечены и не стоят по умолчанию", () => {
    const training = SLOTS.flatMap((s) => WEAPON_CATALOG[s].filter((w) => w.training));
    expect(training.length).toBe(4);
    for (const w of training) expect(w.name.startsWith("Ноль")).toBe(true);
    const def = defaultLoadout();
    for (const s of SLOTS) expect(weaponById(def[s])?.training).toBeFalsy();
  });

  it("у тяжёлого слота есть запасной магазин на жизнь", () => {
    for (const w of WEAPON_CATALOG.rocket) expect(w.reserve).toBeGreaterThanOrEqual(w.mag);
  });

  it("темп возврата в бой не растягивает раунд", () => {
    // смерть → снова в строю: не дольше 15 с даже без похода на базу
    expect(GAME.RESPAWN_MS + GAME.RESPAWN_AUTO_MS).toBeLessThanOrEqual(15000);
    // радиус базы шире шума GPS, иначе «дойти до базы» превращается в поиск
    expect(GAME.BASE_RADIUS_M).toBeGreaterThan(GAME.HIT_RADIUS_BASE_M * 2);
    // зона по умолчанию — лужайка, а не парк
    expect(GAME.DEFAULT_ZONE_RADIUS_M).toBeLessThanOrEqual(80);
  });
});
