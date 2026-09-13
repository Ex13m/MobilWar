/**
 * Weapon catalog: 4 slots × 30 variants = 120 weapons, all data-driven.
 * The server reads the equipped variant for every rule (damage, cone, mags, traits);
 * the client reads the same record for presentation (model, colour, sound).
 * Balance numbers are deliberately spread wide — this catalog exists to TEST feel,
 * then prune. Every field is plain data so a spreadsheet can replace it later.
 */
import type { WeaponId } from "./constants.js";

export type Slot = WeaponId; // "pistol" | "blaster" (rifle slot) | "sniper" | "rocket" (heavy slot)
export const SLOTS: readonly Slot[] = ["pistol", "blaster", "sniper", "rocket"];
export const SLOT_NAMES: Record<Slot, string> = { pistol: "Пистолет", blaster: "Винтовка", sniper: "Снайперка", rocket: "Тяжёлое" };

/** Special behaviours the server implements. One per weapon (plus `none`). */
export type Trait =
  | "none"
  | "burst" // fires `burst` shots per trigger
  | "pellets" // shotgun: `pellets` cones, damage per pellet
  | "pierce" // ignores shield
  | "chain" // hits a second enemy within 6 m for 50 %
  | "burn" // damage over time: 3 dmg/s for `burnS` s
  | "stun" // victim cannot fire for `stunMs`
  | "lifesteal" // heals shooter 30 % of damage
  | "emp" // heavy: disables shields/turrets/drones in splash for 6 s
  | "homing" // heavy: wide aim-assist cone
  | "cluster" // heavy: 3 sub-explosions
  | "overheat" // rifle: 6 s continuous → 3 s lock
  | "charge" // sniper: hold for charged damage
  | "heal"; // pistol: heals allies it "hits"

export interface WeaponDef {
  id: string;
  slot: Slot;
  name: string;
  /** Short flavour line for the picker. */
  blurb: string;
  damage: number;
  cooldownMs: number;
  rangeM: number;
  /** Half-angle deg; pistols widen past 10 m by conePerM up to coneMax. */
  cone: number;
  coneMax: number;
  conePerM: number;
  bloom: number;
  bloomDecay: number;
  mag: number;
  /** -1 = infinite spare rounds. */
  reserve: number;
  reloadMs: number;
  /** Projectile speed (visual for hitscan, real for heavy). */
  speedMps: number;
  /** Heavy only. */
  splashM: number;
  damageEdge: number;
  fuseM: number;
  trait: Trait;
  burst: number;
  pellets: number;
  burnS: number;
  stunMs: number;
  chargeMs: number;
  chargedDamage: number;
  /** Presentation. */
  model: string;
  color: number;
  /** Playback-rate multiplier for the slot's base shot sample. */
  pitch: number;
}

type Row = [name: string, blurb: string, trait: Trait, dmg: number, cd: number, range: number, cone: number, mag: number, reload: number, model: string, color: number, pitch: number, extra?: Partial<WeaponDef>];

const PISTOLS: Row[] = [
  ["Искра", "базовый бластер, точен до 10 м", "none", 12, 200, 35, 5, 12, 1000, "pistol", 0x7dd3fc, 1.5],
  ["Оса", "быстрый, слабый", "none", 8, 120, 30, 6, 18, 900, "pistol", 0xfde047, 1.7],
  ["Жало", "два выстрела за нажатие", "burst", 9, 320, 32, 5, 14, 1100, "pistol2", 0xf97316, 1.6, { burst: 2 }],
  ["Шершень", "тройная очередь", "burst", 7, 380, 30, 6, 15, 1200, "pistol2", 0xfb923c, 1.65, { burst: 3 }],
  ["Кулак", "тяжёлый пистолет, медленный", "none", 22, 450, 38, 4, 8, 1300, "pistol3", 0xef4444, 1.1],
  ["Игла", "пробивает щит", "pierce", 10, 220, 35, 5, 12, 1000, "pistol", 0xa78bfa, 1.8],
  ["Уголёк", "поджигает: 3 урона/с 3 с", "burn", 8, 240, 33, 5, 12, 1000, "pistol3", 0xf87171, 1.4, { burnS: 3 }],
  ["Разряд", "оглушает на 0.6 с", "stun", 9, 300, 30, 6, 10, 1100, "pistol2", 0x38bdf8, 1.9, { stunMs: 600 }],
  ["Пиявка", "лечит стрелка 30 % урона", "lifesteal", 10, 230, 32, 5, 12, 1000, "pistol", 0x4ade80, 1.5],
  ["Дуга", "цепная молния на второго", "chain", 9, 260, 30, 5, 12, 1000, "pistol2", 0x67e8f9, 2.0],
  ["Пульс", "медик: лечит союзника при попадании", "heal", 10, 250, 25, 6, 12, 1000, "pistol", 0x86efac, 1.3],
  ["Дробь", "мини-дробовик: 4 дробины", "pellets", 5, 500, 14, 12, 6, 1400, "pistol3", 0xfbbf24, 0.9, { pellets: 4 }],
  ["Стилет", "узкий конус, длинная рука", "none", 11, 210, 45, 3, 10, 1100, "pistol", 0xc4b5fd, 1.8, { conePerM: 0.5 }],
  ["Маятник", "большой магазин", "none", 9, 180, 32, 6, 24, 1500, "pistol2", 0x93c5fd, 1.55],
  ["Кремень", "два патрона, огромный урон", "none", 40, 700, 30, 4, 2, 800, "pistol3", 0xf59e0b, 0.8],
  ["Вьюга", "холодная: оглушение 0.3 с", "stun", 7, 160, 30, 6, 16, 1000, "pistol", 0xbae6fd, 2.1, { stunMs: 300 }],
  ["Пламя", "поджигает 5 с", "burn", 6, 220, 28, 6, 12, 1000, "pistol3", 0xfb7185, 1.35, { burnS: 5 }],
  ["Скорпион", "двойной укус пробивает щит", "pierce", 8, 300, 33, 5, 14, 1100, "pistol2", 0xa3e635, 1.7, { burst: 2 }],
  ["Вакуум", "медленный снаряд, высокий урон", "none", 18, 400, 36, 5, 8, 1200, "pistol", 0xe879f9, 1.2, { speedMps: 30 }],
  ["Резонанс", "цепь на 2 целей, слабый", "chain", 7, 220, 28, 6, 14, 1000, "pistol2", 0x22d3ee, 2.2],
  ["Фитиль", "поджиг + стан", "burn", 7, 320, 30, 5, 10, 1100, "pistol3", 0xf97316, 1.4, { burnS: 2, stunMs: 200 }],
  ["Спутник", "далеко и точно, мал. магазин", "none", 13, 260, 50, 3, 7, 1200, "pistol", 0x60a5fa, 1.75, { conePerM: 0.4, coneMax: 9 }],
  ["Кактус", "6 дробин, близко", "pellets", 4, 600, 10, 14, 5, 1500, "pistol3", 0x84cc16, 0.85, { pellets: 6 }],
  ["Тик-так", "самый быстрый", "none", 6, 90, 26, 7, 30, 1600, "pistol2", 0xfacc15, 1.9],
  ["Клык", "бесшумный, дальше на 5 м", "none", 11, 240, 40, 5, 12, 1000, "pistol", 0x94a3b8, 1.0],
  ["Гвоздь", "пробивает щит, стан", "pierce", 9, 330, 32, 5, 10, 1100, "pistol2", 0xfb923c, 1.6, { stunMs: 250 }],
  ["Ёж", "3 дробины + поджиг", "pellets", 4, 550, 12, 12, 6, 1400, "pistol3", 0xf87171, 0.95, { pellets: 3, burnS: 2 }],
  ["Эхо", "цепь + лечение стрелка", "chain", 8, 270, 30, 5, 12, 1000, "pistol", 0x5eead4, 1.9, { lifestealNote: 1 } as Partial<WeaponDef>],
  ["Лазурь", "сбалансированный, красивый", "none", 11, 210, 34, 5, 12, 950, "pistol2", 0x38bdf8, 1.55],
  ["Ноль", "тренировочный: 1 урон, ∞ темп", "none", 1, 60, 30, 8, 60, 500, "pistol", 0xffffff, 2.3],
];

const RIFLES: Row[] = [
  ["Гроза", "плазменная штурмовая", "none", 9, 100, 60, 7, 30, 2000, "rifle", 0xffd23b, 1.15],
  ["Метель", "холодная, стан 0.2 с", "stun", 7, 110, 55, 7, 30, 2000, "rifle", 0xbae6fd, 1.4, { stunMs: 200 }],
  ["Вулкан", "ротационный, перегрев 6 с", "overheat", 6, 50, 45, 14, 150, 4500, "minigun", 0xfb923c, 0.9, { bloom: -0.3, bloomDecay: 4, coneMax: 14 }],
  ["Тройка", "очередь по 3", "burst", 10, 300, 60, 6, 30, 2000, "rifle2", 0xfde68a, 1.2, { burst: 3 }],
  ["Пила", "дробовик-автомат: 5 дробин", "pellets", 4, 350, 18, 12, 8, 2200, "rifle3", 0xfbbf24, 0.85, { pellets: 5 }],
  ["Шило", "пробивает щит", "pierce", 8, 120, 60, 7, 25, 2000, "rifle", 0xa78bfa, 1.3],
  ["Дракон", "огнемёт: поджиг 4 с", "burn", 5, 80, 25, 10, 60, 2500, "rifle3", 0xf87171, 0.8, { burnS: 4 }],
  ["Молния", "цепь на второго", "chain", 8, 130, 55, 7, 30, 2000, "rifle2", 0x67e8f9, 1.5],
  ["Вампир", "лечит стрелка", "lifesteal", 8, 110, 55, 7, 30, 2000, "rifle", 0x4ade80, 1.1],
  ["Тяжёлая гроза", "больше урон, медленней", "none", 14, 160, 65, 6, 24, 2300, "rifle2", 0xf59e0b, 1.0],
  ["Лёгкая гроза", "быстрая, слабая", "none", 6, 70, 55, 8, 40, 1800, "rifle", 0xfef08a, 1.3],
  ["Снайп-карабин", "точная полуавто", "none", 18, 260, 80, 4, 15, 2200, "rifle2", 0xc4b5fd, 1.4, { bloom: 0.2 }],
  ["Ливень", "громадный магазин", "none", 7, 90, 55, 8, 80, 3200, "minigun", 0x93c5fd, 1.2],
  ["Двойка", "очередь по 2 с пробитием", "burst", 9, 220, 60, 6, 30, 2000, "rifle", 0xa3e635, 1.25, { burst: 2, pierceNote: 1 } as Partial<WeaponDef>],
  ["Кузнец", "оглушение 0.5 с, редко", "stun", 12, 250, 55, 6, 20, 2100, "rifle3", 0x38bdf8, 1.0, { stunMs: 500 }],
  ["Роса", "медик-винтовка: лечит союзников", "heal", 8, 120, 45, 7, 30, 2000, "rifle", 0x86efac, 1.2],
  ["Град", "8 дробин, далеко", "pellets", 3, 400, 26, 10, 10, 2400, "rifle3", 0xfbbf24, 0.9, { pellets: 8 }],
  ["Кнут", "цепь + поджиг", "chain", 7, 140, 50, 7, 30, 2000, "rifle2", 0xf97316, 1.4, { burnS: 2 }],
  ["Буря", "bloom сильный, урон высокий", "none", 12, 100, 60, 6, 30, 2000, "rifle", 0xfde047, 1.15, { bloom: 1.6, bloomDecay: 12, coneMax: 20 }],
  ["Штиль", "без разброса вообще", "none", 8, 110, 60, 6, 30, 2000, "rifle2", 0x60a5fa, 1.2, { bloom: 0 }],
  ["Вулкан-2", "перегрев позже, урон ниже", "overheat", 5, 45, 45, 13, 200, 5000, "minigun", 0xfb7185, 0.95, { bloom: -0.4, bloomDecay: 4 }],
  ["Пятёрка", "очередь по 5", "burst", 6, 450, 55, 7, 30, 2000, "rifle", 0xfacc15, 1.3, { burst: 5 }],
  ["Игломёт", "пробивает + стан", "pierce", 7, 120, 55, 7, 25, 2000, "rifle2", 0xe879f9, 1.35, { stunMs: 150 }],
  ["Тлен", "поджиг 6 с, слабый", "burn", 4, 100, 40, 9, 40, 2200, "rifle3", 0xef4444, 0.85, { burnS: 6 }],
  ["Сирена", "цепь на 2, лечит стрелка", "chain", 7, 130, 50, 7, 30, 2000, "rifle", 0x5eead4, 1.45],
  ["Скала", "медленная, 20 урона", "none", 20, 240, 70, 5, 12, 2500, "rifle2", 0x94a3b8, 0.95],
  ["Стрекоза", "самая быстрая", "none", 5, 55, 50, 9, 50, 2000, "minigun", 0xfef3c7, 1.5],
  ["Рассвет", "сбалансированная-2", "none", 10, 110, 60, 7, 30, 1900, "rifle", 0xfdba74, 1.1],
  ["Вьюн", "6 дробин + цепь", "pellets", 3, 420, 20, 12, 8, 2200, "rifle3", 0x22d3ee, 0.9, { pellets: 6 }],
  ["Ноль-В", "тренировочная: 1 урон", "none", 1, 60, 60, 8, 100, 500, "rifle", 0xffffff, 1.6],
];

const SNIPERS: Row[] = [
  ["Горизонт", "рельсовая, заряд 100", "charge", 50, 1200, 120, 3, 5, 2800, "sniper", 0xc4b5fd, 0.6, { chargeMs: 800, chargedDamage: 100 }],
  ["Молот-С", "без заряда, 70 урона", "none", 70, 1500, 110, 3, 4, 3000, "sniper2", 0xf59e0b, 0.55],
  ["Игла-С", "пробивает щит, 45", "pierce", 45, 1100, 120, 3, 5, 2800, "sniper", 0xa78bfa, 0.7],
  ["Комета", "поджиг 5 с после попадания", "burn", 40, 1200, 110, 3, 5, 2800, "sniper2", 0xf87171, 0.6, { burnS: 5 }],
  ["Паралич", "стан 1.2 с", "stun", 35, 1300, 110, 3, 5, 2800, "sniper", 0x38bdf8, 0.75, { stunMs: 1200 }],
  ["Разряд-С", "цепь на второго 50 %", "chain", 45, 1300, 100, 3, 5, 2800, "sniper2", 0x67e8f9, 0.8],
  ["Пиявка-С", "лечит стрелка", "lifesteal", 45, 1200, 110, 3, 5, 2800, "sniper", 0x4ade80, 0.65],
  ["Скорострел", "полуавто 25 урона", "none", 25, 500, 100, 4, 10, 2600, "sniper2", 0xfde047, 0.9],
  ["Дальнобой", "150 м, узкий конус", "charge", 45, 1400, 150, 2, 4, 3200, "sniper", 0x60a5fa, 0.5, { chargeMs: 1000, chargedDamage: 100 }],
  ["Двустволка", "2 выстрела подряд", "burst", 35, 1600, 100, 4, 6, 3000, "sniper2", 0xfb923c, 0.7, { burst: 2 }],
  ["Заряд-2", "быстрый заряд 0.4 с → 80", "charge", 40, 1100, 110, 3, 5, 2800, "sniper", 0xe879f9, 0.6, { chargeMs: 400, chargedDamage: 80 }],
  ["Заряд-3", "долгий заряд 1.5 с → 130", "charge", 40, 1200, 120, 3, 5, 2800, "sniper2", 0xf43f5e, 0.55, { chargeMs: 1500, chargedDamage: 130 }],
  ["Буревестник", "широкий конус 6°, 40", "none", 40, 1000, 90, 6, 6, 2600, "sniper", 0x93c5fd, 0.8],
  ["Гарпун", "пробитие + стан", "pierce", 40, 1300, 110, 3, 4, 3000, "sniper2", 0xa3e635, 0.65, { stunMs: 500 }],
  ["Фонарь", "медик: лечит союзника на 40", "heal", 40, 1200, 100, 4, 5, 2800, "sniper", 0x86efac, 0.7],
  ["Ледник", "стан 2 с, 25 урона", "stun", 25, 1500, 110, 3, 5, 3000, "sniper2", 0xbae6fd, 0.85, { stunMs: 2000 }],
  ["Уголь-С", "поджиг 8 с, 30 урона", "burn", 30, 1200, 110, 3, 5, 2800, "sniper", 0xef4444, 0.6, { burnS: 8 }],
  ["Ветер", "лёгкая, 35, быстрая перезарядка", "none", 35, 900, 100, 4, 6, 1800, "sniper2", 0xfef3c7, 0.85],
  ["Титан", "90 урона, 2 патрона", "none", 90, 2000, 120, 3, 2, 3500, "sniper", 0xf59e0b, 0.45],
  ["Резак", "цепь + пробитие", "chain", 40, 1300, 100, 3, 5, 2800, "sniper2", 0x22d3ee, 0.8],
  ["Заря", "заряд 0.8 → 100, 10 патронов", "charge", 45, 1200, 120, 3, 10, 3200, "sniper", 0xfdba74, 0.6, { chargeMs: 800, chargedDamage: 100 }],
  ["Кнут-С", "стан + поджиг", "stun", 30, 1300, 100, 3, 5, 2800, "sniper2", 0xf97316, 0.75, { stunMs: 600, burnS: 3 }],
  ["Штык", "дальность 60, конус 2°, 60", "none", 60, 1300, 60, 2, 5, 2800, "sniper", 0x94a3b8, 0.65],
  ["Спрут", "цепь на 2 + лечение", "chain", 35, 1300, 100, 3, 5, 2800, "sniper2", 0x5eead4, 0.8],
  ["Тройник", "3 выстрела", "burst", 25, 1800, 100, 4, 6, 3000, "sniper", 0xfde68a, 0.75, { burst: 3 }],
  ["Прожектор", "заряд 0.6 → 90, конус 4", "charge", 40, 1200, 110, 4, 5, 2800, "sniper2", 0xfacc15, 0.6, { chargeMs: 600, chargedDamage: 90 }],
  ["Молчун", "тихий, 50, далеко", "none", 50, 1300, 130, 3, 5, 2800, "sniper", 0x64748b, 0.4],
  ["Ярость", "пробитие 60, 3 патрона", "pierce", 60, 1600, 110, 3, 3, 3200, "sniper2", 0xef4444, 0.5],
  ["Роса-С", "медик-снайперка 30/30", "heal", 30, 1000, 100, 4, 6, 2600, "sniper", 0x4ade80, 0.75],
  ["Ноль-С", "тренировочная: 1 урон", "none", 1, 300, 120, 4, 30, 500, "sniper2", 0xffffff, 1.0],
];

const HEAVIES: Row[] = [
  ["Молот", "ракета 50, сплэш 6", "homing", 50, 2500, 45, 10, 2, 3000, "rocket", 0xffa53b, 0.55, { splashM: 6, damageEdge: 15, fuseM: 3, speedMps: 22 }],
  ["Гранатомёт", "медленный снаряд, сплэш 5", "none", 40, 1500, 30, 12, 3, 2500, "rocket2", 0x84cc16, 0.7, { splashM: 5, damageEdge: 10, fuseM: 2.5, speedMps: 14 }],
  ["ЭМИ-пушка", "снимает щиты, глушит турели", "emp", 10, 3000, 40, 12, 1, 3000, "rocket", 0x38bdf8, 0.9, { splashM: 8, damageEdge: 5, fuseM: 4, speedMps: 25 }],
  ["Кассета", "3 подрыва", "cluster", 25, 3000, 40, 10, 1, 3200, "rocket2", 0xfbbf24, 0.6, { splashM: 5, damageEdge: 8, fuseM: 3, speedMps: 20 }],
  ["Огнемёт-Т", "поджиг всех в сплэше", "burn", 20, 2000, 30, 12, 2, 2800, "rocket", 0xf87171, 0.65, { splashM: 6, damageEdge: 10, fuseM: 3, speedMps: 18, burnS: 5 }],
  ["Оглушалка", "стан 1.5 с в 7 м", "stun", 15, 2500, 40, 12, 2, 2800, "rocket2", 0xbae6fd, 0.8, { splashM: 7, damageEdge: 10, fuseM: 3, speedMps: 22, stunMs: 1500 }],
  ["Самонавод", "летит точно в цель", "homing", 40, 2800, 60, 20, 1, 3000, "rocket", 0xe879f9, 0.5, { splashM: 4, damageEdge: 10, fuseM: 3, speedMps: 26 }],
  ["Тяжёлый молот", "70 центр, медленный", "none", 70, 3500, 40, 10, 1, 3500, "rocket2", 0xf59e0b, 0.45, { splashM: 7, damageEdge: 20, fuseM: 3, speedMps: 16 }],
  ["Ливень-Т", "3 ракеты в магазине", "none", 30, 1200, 40, 12, 3, 3500, "rocket", 0xfde047, 0.7, { splashM: 4, damageEdge: 8, fuseM: 2.5, speedMps: 24 }],
  ["Пиявка-Т", "лечит стрелка от сплэша", "lifesteal", 40, 2500, 45, 10, 1, 3000, "rocket2", 0x4ade80, 0.55, { splashM: 6, damageEdge: 12, fuseM: 3, speedMps: 22 }],
  ["Лечебная бомба", "медик: лечит союзников в 6 м", "heal", 40, 2500, 40, 12, 2, 3000, "rocket", 0x86efac, 0.75, { splashM: 6, damageEdge: 40, fuseM: 3, speedMps: 20 }],
  ["Игла-Т", "пробивает щит, малый сплэш", "pierce", 55, 2500, 50, 8, 1, 3000, "rocket2", 0xa78bfa, 0.6, { splashM: 3, damageEdge: 20, fuseM: 2, speedMps: 30 }],
  ["Цепная бомба", "сплэш + цепь", "chain", 35, 2500, 40, 10, 1, 3000, "rocket", 0x67e8f9, 0.65, { splashM: 5, damageEdge: 10, fuseM: 3, speedMps: 22 }],
  ["Кассета-2", "3 подрыва по 20", "cluster", 20, 2800, 45, 10, 2, 3200, "rocket2", 0xfb923c, 0.6, { splashM: 4, damageEdge: 6, fuseM: 3, speedMps: 22 }],
  ["Мортира", "дальняя, медленная", "none", 45, 3000, 70, 12, 1, 3200, "rocket", 0x94a3b8, 0.5, { splashM: 7, damageEdge: 15, fuseM: 3, speedMps: 12 }],
  ["Дробовик-Т", "8 дробин, 12 м", "pellets", 8, 900, 12, 14, 4, 2800, "rocket2", 0xfbbf24, 0.8, { pellets: 8, splashM: 0 }],
  ["ЭМИ-2", "ЭМИ + 20 урона", "emp", 20, 3000, 40, 12, 1, 3000, "rocket", 0x22d3ee, 0.9, { splashM: 7, damageEdge: 10, fuseM: 4, speedMps: 25 }],
  ["Огонь-2", "поджиг 8 с, слабый удар", "burn", 10, 2000, 35, 12, 2, 2800, "rocket2", 0xef4444, 0.65, { splashM: 7, damageEdge: 5, fuseM: 3, speedMps: 18, burnS: 8 }],
  ["Фугас", "сплэш 9 м, 35", "none", 35, 3000, 40, 12, 1, 3200, "rocket", 0xf97316, 0.5, { splashM: 9, damageEdge: 15, fuseM: 3, speedMps: 20 }],
  ["Стрела", "быстрая ракета 40 м/с", "homing", 45, 2500, 50, 12, 1, 3000, "rocket2", 0x60a5fa, 0.6, { splashM: 4, damageEdge: 10, fuseM: 2, speedMps: 40 }],
  ["Стан-2", "стан 2.5 с, 10 урона", "stun", 10, 3000, 40, 12, 1, 3000, "rocket", 0x93c5fd, 0.85, { splashM: 6, damageEdge: 5, fuseM: 3, speedMps: 22, stunMs: 2500 }],
  ["Двойной молот", "2 ракеты в магазине", "none", 45, 1800, 45, 10, 2, 3500, "rocket2", 0xfde68a, 0.55, { splashM: 5, damageEdge: 12, fuseM: 3, speedMps: 22 }],
  ["Кислота", "поджиг + пробитие", "pierce", 30, 2500, 40, 12, 1, 3000, "rocket", 0xa3e635, 0.7, { splashM: 6, damageEdge: 10, fuseM: 3, speedMps: 20, burnS: 4 }],
  ["Вакуум-Т", "тянет: стан 1 с, сплэш 8", "stun", 35, 2800, 40, 12, 1, 3000, "rocket2", 0xc4b5fd, 0.75, { splashM: 8, damageEdge: 15, fuseM: 3, speedMps: 20, stunMs: 1000 }],
  ["Кассета-3", "3 подрыва + поджиг", "cluster", 18, 3000, 40, 10, 1, 3200, "rocket", 0xfb7185, 0.6, { splashM: 4, damageEdge: 6, fuseM: 3, speedMps: 20, burnS: 3 }],
  ["Резонатор", "цепь + ЭМИ-эффект", "chain", 40, 2200, 40, 10, 1, 3000, "rocket2", 0x5eead4, 0.7, { splashM: 5, damageEdge: 10, fuseM: 3, speedMps: 22 }],
  ["Гром", "60 урона, сплэш 5, дальний", "none", 60, 3200, 55, 10, 1, 3500, "rocket", 0xfacc15, 0.45, { splashM: 5, damageEdge: 20, fuseM: 3, speedMps: 24 }],
  ["Пыль", "10 дробин, 15 м, 3 патрона", "pellets", 6, 800, 15, 16, 3, 2600, "rocket2", 0xfdba74, 0.85, { pellets: 10, splashM: 0 }],
  ["Санитар", "лечит 60 в 5 м", "heal", 60, 3000, 35, 12, 1, 3000, "rocket", 0x4ade80, 0.75, { splashM: 5, damageEdge: 60, fuseM: 3, speedMps: 20 }],
  ["Ноль-Т", "тренировочная: 1 урон", "none", 1, 1000, 40, 12, 5, 500, "rocket2", 0xffffff, 1.0, { splashM: 6, damageEdge: 1, fuseM: 3, speedMps: 22 }],
];

function build(slot: Slot, rows: Row[]): WeaponDef[] {
  return rows.map((r, i) => {
    const [name, blurb, trait, damage, cooldownMs, rangeM, cone, mag, reloadMs, model, color, pitch, extra] = r;
    const base: WeaponDef = {
      id: `${slot}_${String(i + 1).padStart(2, "0")}`,
      slot,
      name,
      blurb,
      damage,
      cooldownMs,
      rangeM,
      cone,
      coneMax: slot === "pistol" ? 14 : slot === "blaster" ? 16 : slot === "sniper" ? 12 : cone,
      conePerM: slot === "pistol" ? 0.9 : 0,
      bloom: slot === "blaster" ? 0.8 : 0,
      bloomDecay: slot === "blaster" ? 10 : 0,
      mag,
      reserve: slot === "pistol" ? -1 : slot === "blaster" ? mag * 4 : slot === "sniper" ? mag * 4 : 0,
      reloadMs,
      speedMps: slot === "rocket" ? 22 : slot === "sniper" ? 200 : 70,
      splashM: 0,
      damageEdge: 0,
      fuseM: 0,
      trait,
      burst: 1,
      pellets: 1,
      burnS: 0,
      stunMs: 0,
      chargeMs: 0,
      chargedDamage: 0,
      model,
      color,
      pitch,
    };
    return { ...base, ...(extra ?? {}) } as WeaponDef;
  });
}

export const WEAPON_CATALOG: Record<Slot, WeaponDef[]> = {
  pistol: build("pistol", PISTOLS),
  blaster: build("blaster", RIFLES),
  sniper: build("sniper", SNIPERS),
  rocket: build("rocket", HEAVIES),
};

const BY_ID = new Map<string, WeaponDef>();
for (const slot of SLOTS) for (const w of WEAPON_CATALOG[slot]) BY_ID.set(w.id, w);

export function weaponById(id: string): WeaponDef | undefined {
  return BY_ID.get(id);
}

export type Loadout = Record<Slot, string>;

export function defaultLoadout(): Loadout {
  return { pistol: "pistol_01", blaster: "blaster_01", sniper: "sniper_01", rocket: "rocket_01" };
}

/** Validate a loadout from the client: every slot must name a weapon of that slot. */
export function sanitizeLoadout(input: unknown): Loadout {
  const out = defaultLoadout();
  if (typeof input !== "object" || input === null) return out;
  for (const slot of SLOTS) {
    const v = (input as Record<string, unknown>)[slot];
    if (typeof v === "string") {
      const w = BY_ID.get(v);
      if (w && w.slot === slot) out[slot] = v;
    }
  }
  return out;
}

/** Cone for a catalog weapon (before the GPS floor). */
export function catalogCone(w: WeaponDef, dist: number, bloom: number, zoomed: boolean): number {
  if (w.slot === "pistol") return Math.min(w.coneMax, w.cone + Math.max(0, dist - 10) * w.conePerM);
  if (w.slot === "blaster") return Math.max(1, Math.min(w.coneMax, w.cone + bloom));
  if (w.slot === "sniper") return zoomed ? w.cone : Math.max(w.cone, 12);
  return w.cone;
}

/** Time-to-kill vs 100 HP in seconds (rough, ignores GPS misses). */
export function ttk(w: WeaponDef): number {
  const cluster = w.trait === "cluster" ? 2.5 : 1;
  const perTrigger = w.damage * Math.max(1, w.burst) * Math.max(1, w.pellets) * cluster + w.burnS * 3;
  const shots = Math.ceil(100 / Math.max(1, perTrigger));
  return ((shots - 1) * w.cooldownMs) / 1000;
}
