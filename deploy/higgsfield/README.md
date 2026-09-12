# Деплой на Cloudflare Workers (через Higgsfield)

`app/` — то, что заменяет папку `app/` в репозитории Higgsfield-проекта (тип `game`):

- `src/worker.ts` — маршрутизация: `/ws/<КОД>` → Durable Object комнаты, `/api/rooms` → DO-реестр `__lobby`, `/health`.
- `src/room.ts` — Durable Object: реестр зон + игровая комната (симуляция 10 Гц через alarm).
- `src/game/room.ts`, `src/shared/` — копии из `apps/server/src/room.ts` и `packages/shared/src` (делает `sync.sh`).
- `public/` — собранный клиент (`apps/client/dist`, API того же origin).

Обновление: `./deploy/higgsfield/sync.sh` → commit → в песочнице Higgsfield скопировать `app/` в их репо → `deploy_website`.
Локальная проверка в workerd: см. историю сессии (Miniflare 4, `routerConfig.has_user_worker`).
