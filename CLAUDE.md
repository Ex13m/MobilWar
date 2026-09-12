# MobilWar — заметки для агентов

Монорепо pnpm: `packages/shared` (гео-математика, протокол, попадания), `apps/server` (Node 22 + ws, авторитарная симуляция 10 Гц, SQLite), `apps/client` (Vite + three.js PWA: AR-lite/WebXR, режим без экрана, страница судьи).

Команды: `pnpm install` → `pnpm typecheck` → `pnpm test` → `pnpm build`. Дев: `pnpm dev` (сервер :8080, клиент https://<lan-ip>:5173).

Правила:
- Сервер — единственный источник истины по попаданиям/урону/очкам. Клиент только предсказывает визуал.
- Координаты: ENU относительно `room.origin`, x = восток, z = юг (three.js: север = -Z). Все константы в `packages/shared/src/constants.ts`.
- Любое изменение протокола — в `packages/shared/src/protocol.ts` + тест в `apps/server/test`.
- Не добавлять внешние ассеты (модели/звуки): всё процедурно, чтобы грузилось мгновенно на слабых телефонах.
- Документация: `docs/GDD.md`, `docs/ARCHITECTURE.md`, `docs/research/competitive-analysis.md`.
