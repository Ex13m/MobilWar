# MobilWar — заметки для агентов

Монорепо pnpm: `packages/shared` (гео-математика, протокол, попадания), `apps/server` (Node 22 + ws, авторитарная симуляция 10 Гц, SQLite), `apps/client` (Vite + three.js PWA: AR-lite/WebXR, режим без экрана, страница судьи).

Команды: `pnpm install` → `pnpm typecheck` → `pnpm test` → `pnpm build`. Дев: `pnpm dev` (сервер :8080, клиент https://<lan-ip>:5173).

Правила:
- Сервер — единственный источник истины по попаданиям/урону/очкам. Клиент только предсказывает визуал.
- Координаты: ENU относительно `room.origin`, x = восток, z = юг (three.js: север = -Z). Все константы в `packages/shared/src/constants.ts`.
- Любое изменение протокола — в `packages/shared/src/protocol.ts` + тест в `apps/server/test`.
- Ассеты: только CC0/MIT (реестр в `apps/client/public/assets/LICENSES.md`, регистр в `apps/client/src/assets.ts`). Бюджет загрузки клиента 3 МБ; модели GLB ≤ 150 КБ, спрайты ≤ 256 px, звуки OGG. Эффекты (заряды, взрывы, цифры урона) — `apps/client/src/fx`, оружие от первого лица — `apps/client/src/ar/weapons.ts`.
- Дизайн: `docs/DESIGN.md` — визуальный канон (основа AgentQL из Refero). Обязателен для всего UI.
- Полевой тест: `docs/TESTING.md` — инструкция на первый бой вдвоём.
- Документация: `docs/HEURISTICS.md` (эвристический разбор: играбельность и качество оружия, с замерами), `docs/REVIEW.md` (обзор для ревьюера: боевая модель, пробелы, что проверять), `docs/TZ.md` (ТЗ на полноценный бой), `docs/GDD.md`, `docs/ARCHITECTURE.md`, `docs/LOOT_AND_RESPAWN.md`, `docs/research/` (рынок, библиотеки и ассеты).
- Смоук в headless Chromium: сервер `:8080`, `vite preview :4173`, скрипт в scratchpad `smoke2.mjs` (синтетическая ориентация через DeviceOrientationEvent на оба имени события).
