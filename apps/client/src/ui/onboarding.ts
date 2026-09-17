import { saveProfile, type Profile } from "../storage.js";
import type { Sensors } from "../sensors.js";

/**
 * Bump when the steps change so returning players see the new explanation once.
 */
export const ONBOARDING_VERSION = 2;

interface Step {
  title: string;
  body: string;
  /** Renders the live readiness panel under the copy. */
  checks?: boolean;
  /** Inline SVG illustration; plain shapes, no assets to load. */
  art: string;
}

const STEPS: Step[] = [
  {
    title: "Двор — это карта",
    body: "Соперники стоят там же, где стоят в жизни. Игра берёт твою точку по GPS и показывает их через камеру телефона. Играй на открытой площадке и держись подальше от дороги.",
    art: `<circle cx="60" cy="60" r="46" fill="none" stroke="#22d3ee" stroke-width="2" opacity=".5"/>
      <circle cx="60" cy="60" r="26" fill="none" stroke="#22d3ee" stroke-width="2" opacity=".8"/>
      <circle cx="60" cy="60" r="5" fill="#22d3ee"/>
      <circle cx="92" cy="44" r="6" fill="#ef4444"/><circle cx="34" cy="84" r="6" fill="#ef4444"/>`,
  },
  {
    title: "Телефон — это ствол",
    body: "Куда смотрит камера, туда и летит выстрел. Наводись всем корпусом по горизонтали и наклоном по вертикали: если ткнуть телефоном в небо или себе под ноги — промах.",
    art: `<rect x="34" y="26" width="52" height="86" rx="10" fill="none" stroke="#e5e7eb" stroke-width="2"/>
      <path d="M60 26 L60 4" stroke="#22d3ee" stroke-width="3"/>
      <path d="M46 14 L60 2 L74 14" fill="none" stroke="#22d3ee" stroke-width="3"/>
      <path d="M22 78 A 40 40 0 0 1 98 78" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4 4"/>`,
  },
  {
    title: "Четыре слота, 120 стволов",
    body: "Пистолет, винтовка, снайперка, тяжёлое. В каждом слоте 30 вариантов со своим уроном, разбросом, магазином, видом и звуком. Меняй прямо в бою: тапни активный слот.",
    art: `<rect x="12" y="30" width="44" height="24" rx="6" fill="#1f2937" stroke="#22d3ee"/>
      <rect x="64" y="30" width="44" height="24" rx="6" fill="#1f2937" stroke="#4b5563"/>
      <rect x="12" y="66" width="44" height="24" rx="6" fill="#1f2937" stroke="#4b5563"/>
      <rect x="64" y="66" width="44" height="24" rx="6" fill="#1f2937" stroke="#4b5563"/>`,
  },
  {
    title: "Попадания считает сервер",
    body: "Ты видишь трассу сразу, но урон подтверждает сервер — он один знает, где стоят все. Красная рамка и вибрация значат, что попали в тебя. Ноль здоровья — respawn на своей базе.",
    art: `<rect x="18" y="18" width="84" height="84" rx="12" fill="none" stroke="#ef4444" stroke-width="4" opacity=".8"/>
      <path d="M30 60 L54 60 L60 44 L70 76 L76 60 L92 60" fill="none" stroke="#22d3ee" stroke-width="3"/>`,
  },
  {
    title: "Проверка перед боем",
    body: "Прямо сейчас видно, готов ли телефон. Зелёная галочка у всех четырёх строк означает, что можно играть. Если GPS показывает хуже ±12 м, отойди от стен и подожди минуту: в помещении и у зданий погрешность больше радиуса поражения, и попадания станут случайными.",
    art: `<circle cx="60" cy="60" r="40" fill="none" stroke="#4ade80" stroke-width="3"/>
      <path d="M40 60 L54 74 L82 46" fill="none" stroke="#4ade80" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    checks: true,
  },
  {
    title: "Без экрана — тоже игра",
    body: "Режим без экрана ведёт тебя звуком и вибрацией: телефон в кармане, глаза на дворе. Судья запускает раунд со своей страницы и следит за безопасностью.",
    art: `<rect x="40" y="20" width="40" height="66" rx="8" fill="#1f2937" stroke="#4b5563"/>
      <path d="M86 40 A 18 18 0 0 1 86 66" fill="none" stroke="#22d3ee" stroke-width="3"/>
      <path d="M96 32 A 30 30 0 0 1 96 74" fill="none" stroke="#22d3ee" stroke-width="2" opacity=".6"/>
      <path d="M34 40 A 18 18 0 0 0 34 66" fill="none" stroke="#22d3ee" stroke-width="3"/>`,
  },
];

/**
 * First-run walkthrough. Shown before the lobby the first time (and again after
 * the steps change), skippable, and reachable later from the lobby.
 * Resolves when the player is done.
 */
export function showOnboarding(root: HTMLElement, profile: Profile, sensors?: Sensors): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    let checkTimer: number | null = null;
    const el = document.createElement("div");
    el.className = "screen onboarding hero art-lobby";
    root.innerHTML = "";
    root.appendChild(el);

    const done = (): void => {
      if (checkTimer) window.clearInterval(checkTimer);
      checkTimer = null;
      profile.onboarded = ONBOARDING_VERSION;
      saveProfile(profile);
      resolve();
    };

    /**
     * Live readiness check. Telling a parent "make sure GPS is good" is useless
     * on a lawn; showing them the number their phone is actually reporting, and
     * whether it is good enough to play, is not.
     */
    const renderCheck = (): void => {
      const acc = sensors?.fix?.acc ?? null;
      const compass = !!sensors?.hasCompass;
      const secure = location.protocol === "https:";
      const row = (ok: boolean | null, name: string, value: string, hint: string) =>
        `<div class="chk ${ok === null ? "wait" : ok ? "ok" : "bad"}">
           <b>${ok === null ? "…" : ok ? "✓" : "✕"}</b>
           <span class="chk-n">${name}</span>
           <span class="chk-v">${value}</span>
           <small>${hint}</small>
         </div>`;
      const gpsOk = acc === null ? null : acc <= 12;
      const box = el.querySelector(".checks");
      if (!box) return;
      box.innerHTML =
        row(secure, "Защищённое соединение", secure ? "есть" : "нет", "Без него камера и компас не включатся") +
        row(gpsOk, "Точность GPS", acc === null ? "жду сигнал…" : `±${Math.round(acc)} м`, "Нужно ±12 м или лучше. Выйди на открытое место, подожди минуту") +
        row(compass, "Компас", compass ? "работает" : "нет данных", "Нарисуй телефоном восьмёрку в воздухе") +
        row(navigator.onLine, "Сеть", navigator.onLine ? "есть" : "нет", "Нужен интернет: бой идёт через сервер");
    };

    const render = (): void => {
      const s = STEPS[i]!;
      el.innerHTML = `<div class="card ob-card">
        <svg class="ob-art" viewBox="0 0 120 120" aria-hidden="true">${s.art}</svg>
        <h2>${s.title}</h2>
        <p class="sub">${s.body}</p>
        ${s.checks ? '<div class="checks"></div>' : ""}
        <div class="ob-dots">${STEPS.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}</div>
        <button class="btn block" id="ob-next">${i === STEPS.length - 1 ? "Начать" : "Дальше"}</button>
        <button class="btn secondary block" id="ob-skip" style="margin-top:8px">${i === STEPS.length - 1 ? "Назад" : "Пропустить"}</button>
      </div>`;
      if (checkTimer) window.clearInterval(checkTimer);
      checkTimer = null;
      if (s.checks) {
        renderCheck();
        checkTimer = window.setInterval(renderCheck, 1000);
      }
      el.querySelector("#ob-next")!.addEventListener("click", () => {
        if (i === STEPS.length - 1) done();
        else {
          i++;
          render();
        }
      });
      el.querySelector("#ob-skip")!.addEventListener("click", () => {
        if (i === STEPS.length - 1) {
          i--;
          render();
        } else done();
      });
    };
    render();
  });
}
