# Библиотеки и ассеты для MobilWar — исследование (2026-09-13)

> ✅ — проверено из контейнера в день исследования (`npm view`, `curl -sI` → HTTP 200 + content-length, blobless `git clone` для листинга деревьев, разбор JSON-чанка GLB).
> ⚠️ — не проверено или есть оговорка.
> Важно: CLAUDE.md проекта требует «всё процедурно, без внешних ассетов». Этот документ — инвентаризация того, что *можно* подключить, если правило смягчить для нескольких файлов < 300 КБ. Рекомендация в §4 учитывает это ограничение.
> Скачанные кандидаты лежат в `docs/research/assets-candidates/` (2.48 МБ, 52 файла, НЕ закоммичены — см. §3.6).

---

## 1. Библиотеки (npm, `npm view` 2026-09-13)

| Пакет | Версия | peerDependencies | Лицензия | unpacked | ESM-бандл raw / gzip ✅ | three 0.186? |
|---|---|---|---|---|---|---|
| `postprocessing` | 6.39.5 | `three >= 0.168.0 < 0.187.0` | Zlib | 2.77 MB | 634 KB / **158 KB** (весь `build/index.js`; tree-shaking через Vite уберёт неиспользуемые эффекты) | ✅ (0.187 уже выпадет из диапазона — при апгрейде three ждать релиза pp) |
| `three.quarks` | 0.17.1 | `three >= 0.182.0` | MIT | 1.21 MB | 125 KB / **21 KB** | ✅ |
| `three-mesh-bvh` | 0.9.15 | `three >= 0.159.0` | MIT | 2.33 MB | 291 KB / **63 KB** | ✅ |
| `howler` | 2.2.4 | — | MIT | 318 KB | core.min 27 KB / **8 KB**; full (со spatial) 36 KB / 10 KB | ✅ (не зависит от three) |
| `troika-three-text` | 0.52.5 | `three >= 0.125.0` | MIT | 843 KB | 195 KB / **56 KB** + deps `bidi-js`, `troika-worker-utils`, `webgl-sdf-generator` (воркер) | ✅ |
| `locar` | 0.2.11 | нет peer; **`dependencies: three ^0.181.0`** | MIT | — | 20 KB / **6 KB**; ESM-сборка делает `import … from "three"` (three в бандл не вшит) | ⚠️ через pnpm получим вторую копию three 0.181 в `node_modules/locar/node_modules` → нужен `pnpm.overrides` или alias; либо просто скопировать 2 файла (см. §2) |
| `meshoptimizer` | 1.2.0 | — | MIT | 282 KB | — | декодер уже есть в `three/examples/jsm/libs/meshopt_decoder.module.js` ✅ |
| `draco3d` | 1.5.7 | — | Apache-2.0 | 873 KB | — | декодер уже есть в `three/examples/jsm/libs/draco/gltf/` ✅ (wasm ≈ 300+ КБ отдельной загрузкой) |
| `three` (текущий в проекте) | 0.186.0 | — | MIT | 20.4 MB | — | — |

### 1.1 `postprocessing` 6.39.5 — Bloom / SelectiveBloom на мобильном, прозрачный фон

Проверено по исходникам `src/effects/SelectiveBloomEffect.js`, `src/effects/BloomEffect.js`, `src/core/EffectComposer.js` (ветка `main`) ✅:

- `BloomEffect` опции: `blendFunction=SCREEN`, `luminanceThreshold=1.0`, `luminanceSmoothing=0.03`, `mipmapBlur=true`, `intensity=1.0`, `radius=0.85`, `levels=8`. Старые `kernelSize/resolutionScale` помечены deprecated → mip-map blur единственный актуальный путь. На телефоне снижать `levels` (4–5) и `radius`.
- `SelectiveBloomEffect extends BloomEffect`, конструктор `(scene, camera, options)`, свойства `selection` (класс `Selection`, работает через `camera.layers.set(selection.layer)`), `inverted`, `ignoreBackground`. Т.е. selective bloom = дополнительный проход рендера сцены с маской слоя — на мобильных это **второй полный проход** сцены; дешевле держать «светящиеся» вещи ярче `luminanceThreshold` и использовать обычный `BloomEffect`, либо рендерить светящееся в отдельный слой с MeshBasicMaterial.
- `EffectComposer` опции: `depthBuffer=true`, `stencilBuffer=false`, `multisampling=0` (требует WebGL2), `frameBufferType=UnsignedByteType`. README прямо говорит: `HalfFloatType` — «preferred option for HDR-like workflows **on desktop devices**»; на мобильных оставляем `UnsignedByteType` (sRGB-буфер, ценой бандинга в тёмном).
- **Прозрачный фон (AR поверх камеры).** `EffectComposer.initialize()` читает `renderer.getContext().getContextAttributes().alpha` и передаёт его в `pass.initialize(renderer, alpha, frameBufferType)` — т.е. composer *знает* про альфу, но Bloom с `BlendFunction.SCREEN` всё равно «светит» поверх прозрачных пикселей чёрным ореолом. Это давняя открытая тема: issues [#133](https://github.com/pmndrs/postprocessing/issues/133) («blackish glow» на прозрачном канвасе, `BlendFunction.ALPHA` не помогает) и [#286](https://github.com/pmndrs/postprocessing/issues/286) (белый фон вместо прозрачного при `alpha:true` + `setClearColor(0xffffff,0)`); [#475](https://github.com/pmndrs/postprocessing/issues/475) — на macOS mipmapBlur даёт бандинг на прозрачном фоне. Задокументированного «официального» воркэраунда в этих тредах нет ⚠️.
  **Практический вывод для MobilWar:** не рендерить three.js-канвас с `alpha:true` поверх `<video>`; вместо этого класть кадр камеры **внутрь** сцены (fullscreen-quad/`VideoTexture` на фоне, как делает `webcam-renderer` в AR.js/LocAR) и держать канвас непрозрачным. Тогда Bloom работает штатно, `ignoreBackground=true` у SelectiveBloom исключит видеофон из свечения.
- Цена: Bloom = downsample-цепочка из `levels` mip-уровней + композит; на слабом Android держать `renderer.setPixelRatio(min(dpr, 1.5))` и `composer.multisampling = 0`.

### 1.2 `three.quarks` 0.17.1 (GitHub ★ ~1.0k, MIT ✅)

- Peer `three >= 0.182.0` → совместим с 0.186. ESM 21 KB gzip — очень дёшево.
- Архитектура: `BatchedRenderer` собирает все `ParticleSystem` в минимальное число draw-call'ов (инстансинг + interleaved buffers); частицы считаются на CPU. Есть `QuarksLoader`/JSON-экспорт из редактора quarks.art, `QuarksUtil.setAutoDestroy`, ribbon-trails. Для дульной вспышки/попадания/взрыва — один `BatchedRenderer` на сцену, шаблоны эффектов клонировать (`effect.clone()` → `addToBatchRenderer`).
- WebGPU — только в roadmap; текущая версия WebGL2 (нам и нужно). Явных мобильных ограничений в README нет ⚠️ (не бенчмаркалось).
- Альтернатива без зависимости: собственный `InstancedMesh`/`Points` с 3–5 спрайтами (уже в духе «всё процедурно»).

### 1.3 `three-mesh-bvh` 0.9.15 (★ ~3.5k, MIT ✅)

`geometry.computeBoundsTree(); THREE.Mesh.prototype.raycast = acceleratedRaycast;` — «500 лучей против 80k полигонов в 60 fps». Для MobilWar попадания считает **сервер** (правило проекта), а клиент делает предсказание/хит-маркеры по low-poly моделям (< 2k треугольников) — BVH здесь избыточен. Брать только если появятся оклюдеры из OSM-зданий с тысячами треугольников.

### 1.4 Звук: `howler` 2.2.4 vs Web Audio / `THREE.Audio`

- howler: Web Audio API + fallback HTML5 Audio; аудиоспрайты (`sprite: {laser:[0,300]}`), `html5:true` для длинных треков, `Howler.ctx` unlock по первому тапу (Mobile Safari 6+ «after user input» — README ✅), плагин `howler.spatial` для 3D-панорамы (full build 10 KB gzip). Известная проблема на iOS: [#1220](https://github.com/goldfire/howler.js/issues/1220) (тишина до пользовательского жеста / после переключения на Bluetooth) ⚠️.
- Нативно: `THREE.AudioListener` + `THREE.PositionalAudio` (уже в three, 0 КБ) даёт позиционный звук, но без спрайтов, без пула и без unlock-обвязки — придётся писать ~80 строк самим (resume контекста по `pointerdown`, `decodeAudioData` кэш, пул `AudioBufferSourceNode`).
- Вывод: для 10–15 коротких OGG (< 20 КБ каждый) **хватает голого Web Audio** с одним `AudioContext`; howler имеет смысл, если нужны аудиоспрайты одним файлом (экономия запросов на 3G) — тогда `howler.core.min.js` (8 KB gzip).
- Форматы: OGG Vorbis играет в Safari 17+/iOS 17+ ✅ (по спецификации Apple; не проверялось на устройстве ⚠️). Для старых iOS нужен MP3/AAC-дубль.

### 1.5 `troika-three-text` 0.52.5 (MIT ✅)

SDF-текст в сцене: парсит TTF/WOFF в Web Worker, генерирует атлас на лету, патчит любой three-материал. 56 KB gzip + воркер. Нужен для 3D-надписей над игроками (ник, HP) и для WebXR-HUD (DOM недоступен внутри immersive-сессии). Для 2D-HUD в AR-lite режиме DOM/CSS дешевле.

### 1.6 GLTF: Draco vs Meshopt

- Meshopt (`EXT_meshopt_compression`, декодер `three/examples/jsm/libs/meshopt_decoder.module.js`, ~50 КБ) декодирует заметно быстрее Draco, жмёт анимации/морфы, стал дефолтом в `gltf-transform optimize`. Draco требует отдельный wasm (~300 КБ) и медленнее на старте.
- Для наших моделей (300–1700 треугольников, 25–100 КБ) **компрессия не нужна вообще**: gzip/brotli на сервере даёт 40–60 % на GLB с внешним colormap. Если всё-таки — Meshopt через `gltfpack -cc`.
- Источник: threejs.org docs GLTFLoader, gltf-transform docs (см. Sources внизу).

---

## 2. Open-source игры/библиотеки, откуда брать код

Все репозитории проверены `curl` по `raw.githubusercontent.com/<repo>/<branch>/README.md` → 200 ✅ (github.com HTML из контейнера отдаёт 403 через прокси, поэтому проверка по raw + blobless clone деревьев).

| Репо | ★ | Лицензия | Что брать (пути) |
|---|---|---|---|
| **[Hiraeth010/blackwater](https://github.com/Hiraeth010/blackwater)** — three.js + React + TS, three 0.180 | 14 | MIT ✅ (LICENSE 200) | `app/game/weapon.ts` (31.5 КБ ✅): **полностью процедурный карабин** из примитивов (идеально под правило «всё процедурно»), сокет `muzzle` (`new Object3D`, `position.set(0,0.013,-0.872)`), `PointLight(0xffbb58)` + `Sprite` вспышка со случайным `rotation`/`scale` и `flashTime=0.052`, viewmodel-функция `update(state)` с `recoil*0.038` по Z, `recoil*0.11` наклон, bob по `sin(t*9|13)`, ADS-lerp. `app/game/engine.ts` — синтез звука выстрела через Web Audio (без файлов!), hit-detection; `app/game/environment.ts` — процедурное окружение. |
| **[mohsenheydari/three-fps](https://github.com/mohsenheydari/three-fps)** — three.js FPS, ES6/Webpack, Ammo.js | 231 | MIT ✅ | `src/entities/Player/Weapon.js` (`SetMuzzleFlash()` — спрайт с `AdditiveBlending`, `fireRate`, `Raycast()`), `src/entities/Player/WeaponFSM.js`, `src/entities/Level/BulletDecals.js` (`DecalGeometry` из three examples — следы попаданий), `src/entities/UI/UIManager.js`, `src/entities/AmmoBox/AmmoBox.js` (пикап патронов). Ассеты (AK47, Mixamo) — не CC0, не брать. |
| **[im-oree/Three-FPS](https://github.com/im-oree/Three-FPS)** («OPERATOR», TS, three 0.170, Rapier) | 0 | **нет LICENSE** ⚠️ → только как справочник архитектуры, код не копировать | `src/weapons/RecoilSystem.ts` (2.6 КБ ✅: паттерны отдачи по оружию, jitter, сброс при смене), `src/weapons/MuzzleFlashEffect.ts` (пул `Sprite` + `AdditiveBlending`, «pool exhausted: drop the flash, never allocate»), `src/weapons/WeaponSway.ts`, `TracerEffect.ts`, `ImpactEffect.ts`, `WeaponProfile.ts`, `RecoilPatterns.ts`. Модели `assets/models/weapons/low-poly_ak-74.glb` и др. — происхождение неизвестно, не брать. README — это ИИ-спецификация, репо выглядит сгенерированным. |
| **[AR-js-org/locar.js](https://github.com/AR-js-org/locar.js)** — location-based AR на three.js | 62 | MIT ✅ | `lib/three/device-orientation-controls.ts` — единственная реально ценная часть: `deviceorientationabsolute` vs `deviceorientation`, `webkitCompassHeading` на iOS, `alphaOffset`, `orientationOffset`, fix из AR.js issue #466 (iOS), `requestPermission`. `lib/three/locar.ts` — `lonLatToWorldCoords`, `gpsMinDistance`/`gpsMinAccuracy` фильтр, `fakeGps`. `lib/three/sphmerc-projection.ts` — Web Mercator (у нас ENU, не нужно). `lib/three/webcam.ts` — `VideoTexture` фоном в сцене (см. §1.1). Тянуть как пакет не стоит (своя копия three 0.181); скопировать 2 файла с указанием MIT. |
| **[AR-js-org/AR.js](https://github.com/AR-js-org/AR.js)** | ~6.0k | MIT (artoolkit LGPLv3) | `three.js/src/location-based/js/{device-orientation-controls,location-based,webcam-renderer,sphmerc-projection}.js` ✅ — старая JS-версия того же кода. Маркерная часть не нужна. |
| **[KenneyNL/Starter-Kit-FPS](https://github.com/KenneyNL/Starter-Kit-FPS)** — Godot 4.6, GDScript | 987 | MIT код, **CC0 ассеты** ✅ (LICENSE.md 200) | Код не переносим (GDScript), но ассеты — см. §3. Логика бластера/отдачи в `scripts/` полезна как референс тайминга. |
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | — | MIT | `examples/jsm/geometries/DecalGeometry.js`, `examples/jsm/objects/Lensflare.js` (код MIT; **текстуры lensflare — CC BY-NC-SA, нельзя** ⚠️), `examples/jsm/libs/meshopt_decoder.module.js`. |

Не найдено ⚠️: репозиториев с готовым «hit marker»-компонентом для three.js кроме UIManager из three-fps; хит-маркер проще сделать CSS-анимацией.

---

## 3. Ассеты CC0 / permissive, реально скачиваемые с GitHub raw

### 3.0 Источники (зеркала) — все проверены

| Зеркало | Что внутри | Лицензия | Ветка |
|---|---|---|---|
| **[shorepine/kenney](https://github.com/shorepine/kenney)** (★1) | вся библиотека Kenney: `3d/` — 4 812 GLB в 49 китах (`3d/kits.tsv`), `2d/`, `ui/`, `icons/` | CC0 (LICENSE.txt Kenney) ✅ | `main` |
| **[ETdoFresh/kenney.nl](https://github.com/ETdoFresh/kenney.nl)** (★3) | распакованные zip'ы Kenney: `kenney_digitalaudio`, `kenney_impactsounds`, `kenney_interfacesounds`, `kenney_uiaudio`, `particlePack_1.1`, `smokeparticleassets`, `crosshairpack_kenney`, `uipack-space` … (46 424 файла) | CC0 (License.txt в каждом паке, проверено ✅) | `master` |
| **[KenneyNL/Starter-Kit-FPS](https://github.com/KenneyNL/Starter-Kit-FPS)** | `models/*.glb` + `models/Textures/colormap.png`, `sounds/*.ogg` | CC0 ассеты (LICENSE.md) ✅ | `main` |
| [KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0](https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0) (★9), [KayKit-Prototype-Bits-1.0](https://github.com/KayKit-Game-Assets/KayKit-Prototype-Bits-1.0) | `.gltf` (не glb, с внешними .bin/текстурами) — контейнеры, бочки, ящики, spacetruck, lander; **оружия и дронов нет** | CC0 ✅ | `main` |
| [iwenzhou/kenney](https://github.com/iwenzhou/kenney) | Kenney Asset Pack 1 (2014): `Audio (295 files)/Digital sounds (60 sounds)/…` — те же digital-звуки, пути с пробелами | CC0 | `master` |
| mrdoob/three.js `examples/textures/sprites/` | `spark1.png` 1.6 КБ, `disc.png` 0.9 КБ, `circle.png` 4.2 КБ, `ball.png`, `snowflake*.png` | ⚠️ репо MIT, но **отдельной лицензии на файлы в папке нет**; `textures/lensflare/` — **CC BY-NC-SA 3.0** (LICENSE.txt) — исключено | `dev` |
| **Не найдено на GitHub/npm** ⚠️ | Kenney **Sci-Fi Sounds** (2021, `laserLarge_000.ogg`, `explosionCrunch_000.ogg`) — только kenney.nl/OGA; **Quaternius** (Ultimate Guns, Sci-Fi Modular Gun) — только quaternius.com/poly.pizza/itch, на GitHub лишь анимации (`J-Ponzo/gltf-universal-animation-library`) и Godot-конверсия Modular Scifi (`Malcolmnixon/…`); низкополигональный **квадрокоптер** CC0 — не найден | — | — |
| npm | пакетов с CC0-SFX/моделями Kenney/Quaternius **нет** (только `kenney-hexagon-pack`, MCP-серверы `arcane-assets-mcp`, `threenative-asset-mcp`, индекс `@jgengine/assets`); генераторы `zzfx` 1.3.2 и `jsfxr` 1.4.1 — процедурный звук, 0 файлов | — | — |

### 3.1 Оружие (GLB, CC0)

Все GLB Kenney: без анимаций (кроме crate), 1–4 меша, `KHR_texture_transform` + **внешняя** `Textures/colormap.png` (Blaster Kit / Starter Kit) либо `KHR_materials_unlit` без текстур (Weapon Pack, Space Kit). Треугольники — из парсинга GLB ✅.

| Роль | URL (raw) | Размер | Tris | Примечание |
|---|---|---|---|---|
| Пистолет (sci-fi) | `https://raw.githubusercontent.com/shorepine/kenney/main/3d/blaster/blaster-h.glb` | 28 380 | 296 | самый лёгкий бластер, 1 меш |
| Пистолет | `…/3d/blaster/blaster-b.glb` | 34 380 | 368 | |
| Винтовка | `…/3d/blaster/blaster-a.glb` | 44 992 | 470 | 2 меша (съёмный магазин) |
| Снайперка | `…/3d/blaster/blaster-e.glb` | 75 444 | 802 | 3 меша (прицел) |
| Тяжёлое / миниган-стиль | `…/3d/blaster/blaster-p.glb` | 80 460 | 882 | самый большой; ещё варианты `blaster-c…r` 34–72 КБ |
| Общая текстура Blaster Kit | `…/3d/blaster/Textures/colormap.png` | 10 223 | — | **обязательна**, класть по относительному пути `Textures/colormap.png` |
| Магазин | `…/3d/blaster/clip-small.glb` | 7 808 | 76 | |
| Пистолет (реалистичный, unlit-цвета) | `…/3d/weapon/pistol.glb` | 24 144 | 350 | Weapon Pack, без текстур |
| Автомат | `…/3d/weapon/machinegun.glb` | 32 696 | 486 | |
| Снайперка | `…/3d/weapon/sniper.glb` | 100 640 | 1660 | тяжеловата |
| Ракетница | `…/3d/weapon/rocketlauncherModern.glb` | 72 284 | 1049 | есть `rocketlauncher.glb` 88 КБ |
| Ракета (снаряд) | `…/3d/weapon/ammo_rocket.glb` | 13 084 | 178 | |
| Бластер из Starter Kit FPS | `https://raw.githubusercontent.com/KenneyNL/Starter-Kit-FPS/main/models/blaster.glb` | 59 552 | 624 | + `models/Textures/colormap.png` 9 265; `blaster-repeater.glb` 66 288 |

Минигана как такового у Kenney нет ⚠️ (ближайшее — `blaster-p`, `machinegunLauncher.glb`, Space Kit `turret_single.glb` 38 940 / 576 tris как стационарная турель).

### 3.2 Дрон / летающая цель

| URL | Размер | Tris | Примечание |
|---|---|---|---|
| `https://raw.githubusercontent.com/KenneyNL/Starter-Kit-FPS/main/models/enemy-flying.glb` | 57 828 | 544 | летающий враг из Starter Kit FPS (4 меша, текстура `Textures/colormap.png`) — единственный найденный CC0 «дрон» на GitHub |
| `https://raw.githubusercontent.com/shorepine/kenney/main/3d/space/rover.glb` | 13 384 | 172 | наземный ровер, unlit |
| `…/3d/space/craft_speederA.glb` | 20 496 | — | спидер (не скачан) |

Квадрокоптер: не найден ⚠️ → делать процедурно (4 цилиндра + диски-пропеллеры) — это ~40 строк и 0 байт.

### 3.3 Пикапы (ящик / аптечка / патроны)

| URL | Размер | Tris | Примечание |
|---|---|---|---|
| `…/3d/blaster/crate-small.glb` | 59 020 | 628 | **3 анимации** (открытие крышки) — готовый анимированный ящик |
| `…/3d/blaster/crate-medium.glb`, `crate-wide.glb` | 59 344 / — | | |
| `…/3d/prototype/crate.glb` | 18 064 | — | + `3d/prototype/Textures/colormap.png` 8 706 |
| `…/3d/weapon/ammo_machinegun.glb` | 109 860 | — | коробка патронов (тяжёлая) |
| Аптечка | — | — | **у Kenney нет medkit-GLB** ⚠️; Space Kit `barrel.glb`, KayKit `Box_A.gltf`; проще процедурный куб с крестом |

### 3.4 Звуки (OGG, CC0, все < 20 КБ ✅)

`ET = https://raw.githubusercontent.com/ETdoFresh/kenney.nl/master`, `SK = https://raw.githubusercontent.com/KenneyNL/Starter-Kit-FPS/main`

| Роль | URL | Размер |
|---|---|---|
| Лазер/выстрел | `ET/kenney_digitalaudio/Audio/laser1.ogg` (также laser2…9: 8.5–9.3 КБ) | 9 315 |
| Лазер (вариант) | `ET/kenney_digitalaudio/Audio/laser4.ogg` | 9 208 |
| Выстрел бластера | `SK/sounds/blaster.ogg`; `blaster_repeater.ogg` 13 024 | 14 032 |
| Хит/зап | `ET/kenney_digitalaudio/Audio/zap1.ogg`, `zap2.ogg` 9 819 | 8 126 |
| Попадание по металлу | `ET/kenney_impactsounds/Audio/impactMetal_heavy_000.ogg` (…_000-004, light/medium) | 6 110 |
| Попадание generic | `ET/kenney_impactsounds/Audio/impactGeneric_light_000.ogg` | 5 827 |
| Взрыв / уничтожение | `SK/sounds/enemy_destroy.ogg` | 17 737 |
| Урон получен | `SK/sounds/enemy_hurt.ogg` 6 135; `ET/kenney_digitalaudio/Audio/lowDown.ogg` | 5 956 |
| Пикап | `ET/kenney_digitalaudio/Audio/powerUp5.ogg` (powerUp1–12) | 5 652 |
| Смена оружия | `SK/sounds/weapon_change.ogg` | 11 694 |
| UI ok / error | `ET/kenney_interfacesounds/Audio/confirmation_001.ogg` / `error_001.ogg` | 8 968 / 7 373 |
| UI click | `ET/kenney_interfacesounds/Audio/click_001.ogg`; `ET/kenney_uiaudio/Audio/switch1.ogg` | 4 876 / 6 104 |
| Ракета/двигатель | `ET/kenney_digitalaudio/Audio/spaceTrash1.ogg`, `phaserUp1.ogg` | 12 132 / 7 390 |

«Настоящего» взрыва и запуска ракеты в CC0-паках на GitHub нет ⚠️ (Kenney Sci-Fi Sounds не зеркалирован) — кандидаты: `enemy_destroy.ogg` + низкочастотный синтез через Web Audio (как в blackwater `engine.ts`) или `zzfx`.

### 3.5 Спрайты: дульная вспышка / дым / взрыв / UI

`ET/particlePack_1.1/PNG%20(Transparent)/` — Kenney Particle Pack 1.1, CC0 ✅, все 512×512 8-bit палитра (в GPU станут RGBA 1 МБ каждый — **ужимать до 128–256 px** перед использованием):

| Файл | Размер | Для чего |
|---|---|---|
| `muzzle_01.png` / `muzzle_03.png` / `muzzle_05.png` | 81 811 / 57 240 / 54 088 | дульная вспышка (есть `Rotated/muzzle_0N_rotated.png` для оси вдоль ствола) |
| `smoke_01.png` / `smoke_03.png` | 97 452 / 39 737 | дым |
| `flare_01.png`, `light_01.png`, `circle_01.png` | 42 886 / 93 470 / 69 755 | glow/лазерный болт/хит-спрайт |
| `spark_01.png`, `trace_01.png` | 95 070 / 38 406 | искры, трассер |
| `fire_01.png`, `scorch_01.png` | 99 891 / 60 598 | огонь, след на земле |
| `https://raw.githubusercontent.com/shorepine/kenney/main/2d/Explosion%20Pack/Regular%20explosion/regularExplosion00.png` … `08.png` | 2–5 КБ каждый, 192×192 | 9-кадровый взрыв (также `Simple/Sonic/Pixel/Ground explosion`) |
| `ET/smokeparticleassets/PNG/Flash/flash00.png` (…02) | 195 003 (550×496) | вспышка |
| `ET/smokeparticleassets/PNG/Explosion/explosion00.png` (…08) | 288 706 (583×536) | взрыв, крупный |
| `ET/smokeparticleassets/PNG/White%20puff/whitePuff00.png` | 121 747 | дымок |
| `ET/crosshairpack_kenney/Tilesheet/crosshairs_tilesheet_white.png` | 39 440 (1375×685) | 200 прицелов; `Vector/crosshairs_vector.svg` 119 830 — можно вырезать один прицел inline-SVG |
| three.js `examples/textures/sprites/spark1.png` / `disc.png` / `circle.png` | 1 608 / 866 / 4 158 (32–64 px) | микро-спрайты для `Points` ⚠️ лицензия файла не указана |

### 3.6 Что скачано в `docs/research/assets-candidates/` (52 файла, 2 476 387 байт, не коммитить)

```
kenney-blaster/     blaster-a/b/e/h/p.glb, clip-small.glb, crate-small.glb, Textures/colormap.png   (340 707)
kenney-weapon/      pistol, machinegun, sniper, rocketlauncherModern, ammo_rocket .glb              (242 848)
kenney-space/       turret_single.glb, rover.glb                                                    ( 52 324)
kenney-starter-fps/ blaster.glb, enemy-flying.glb, Textures/colormap.png, blaster.ogg,
                    enemy_destroy.ogg, weapon_change.ogg, LICENSE.md                                (180 435)
kenney-audio/       laser1, laser4, zap1, powerUp5, lowDown, impactMetal_heavy_000,
                    confirmation_001, error_001 .ogg                                                ( 60 708)
kenney-particles/   muzzle_01/03/05, smoke_01/03, flare_01, circle_01, spark_01, trace_01,
                    scorch_01, light_01, fire_01, regularExplosion00/04, flash00, whitePuff00,
                    explosion00 .png                                                                (1 442 728)
kenney-ui/          crosshairs_tilesheet_white.png, crosshairs_vector.svg                           (159 270)
threejs-sprites/    spark1.png, disc.png, circle.png                                                (  6 632)
```
Удалены после скачивания: `lensflare0_alpha.png`, `lensflare3.png` (CC BY-NC-SA).

---

## 4. Рекомендация

### Библиотеки
1. **`postprocessing` 6.39.5 — оставить** (уже в `apps/client/package.json`). Один `EffectPass(camera, new BloomEffect({ luminanceThreshold: 0.9, mipmapBlur: true, levels: 4, intensity: 0.8 }))`, `frameBufferType: UnsignedByteType`, `multisampling: 0`. Канвас **непрозрачный**, кадр камеры — `VideoTexture` внутри сцены (см. §1.1). SelectiveBloom не брать (второй проход сцены).
2. **`three.quarks` 0.17.1 — брать** (21 KB gzip): один `BatchedRenderer`, 4 шаблона (muzzle, hit, explosion, pickup) на 2–3 спрайта. Если хочется совсем без зависимостей — свой `InstancedMesh` с 5 спрайтами; quarks экономит неделю.
3. **Звук — голый Web Audio** (`AudioContext` + `decodeAudioData` + пул источников, unlock по первому `pointerdown`), без howler. Если позже понадобятся аудиоспрайты — `howler.core` 8 KB gzip.
4. **`troika-three-text` — только для WebXR-HUD**, отложить; в AR-lite HUD делать DOM/CSS.
5. **`three-mesh-bvh` — не брать** (сервер авторитарен по попаданиям, клиентские модели < 2k tris).
6. **`locar` — не брать как пакет**; скопировать `device-orientation-controls.ts` (+ MIT-заголовок) в `apps/client/src/ar/`, остальное (ENU, GPS-фильтр) у нас уже своё в `packages/shared`.
7. GLTF: `GLTFLoader` без Draco/Meshopt; серверный brotli.

### Ассеты (набор «Kenney Blaster», ~0.6 МБ) — если смягчить правило «всё процедурно»
| | Файлы | Байт |
|---|---|---|
| Оружие ×5 | `blaster-h`, `blaster-b`, `blaster-a`, `blaster-e`, `blaster-p` + `Textures/colormap.png` | 273 900 |
| Дрон | `enemy-flying.glb` + его `colormap.png` (или процедурный квадрокоптер — 0 байт) | 67 093 |
| Пикап | `crate-small.glb` (анимированный) — аптечка/патроны различаем цветом эмиссии | 59 020 |
| Звуки ×8 | laser1, zap1, impactMetal_heavy_000, enemy_destroy, powerUp5, weapon_change, confirmation_001, error_001 | 74 800 |
| Спрайты ×4 (ужать до 128 px) | muzzle_03, smoke_03, circle_01, regularExplosion00–08 (атлас) | ≈ 60 000 после ресайза |
| Прицел | один inline-SVG из `crosshairs_vector.svg` | ≈ 1 000 |
| **Итого ассеты** | | **≈ 540 КБ** (до gzip) |

**Бюджет загрузки (gzip):** three core ≈ 170 KB + postprocessing (tree-shaken Bloom) ≈ 60–80 KB + three.quarks 21 KB + leaflet ≈ 42 KB + код игры ≈ 50 KB ≈ **350 KB JS**; ассеты ≈ 540 KB (GLB почти не жмутся, OGG не жмутся) → **< 1 МБ суммарно**, в 3 раза ниже лимита 3 МБ. Всё остальное из §3 — резерв.

**Если правило «всё процедурно» сохраняется:** взять только код — viewmodel/recoil/muzzle из `blackwater/app/game/weapon.ts` (MIT, сам процедурный), `device-orientation-controls.ts` из LocAR, спрайты рисовать в `CanvasTexture` (радиальный градиент = flare/smoke), звук — `zzfx`-подобный синтез. Единственное, что реально сложно сделать процедурно и стоит 30 КБ — узнаваемый силуэт оружия (`blaster-h.glb` + colormap = 38 КБ).

---

### Sources
- npm registry (`npm view`, 2026-09-13): postprocessing, three.quarks, three-mesh-bvh, howler, troika-three-text, meshoptimizer, draco3d, locar
- https://github.com/pmndrs/postprocessing (README, `src/effects/BloomEffect.js`, `src/effects/SelectiveBloomEffect.js`, `src/core/EffectComposer.js`), issues [#133](https://github.com/pmndrs/postprocessing/issues/133), [#286](https://github.com/pmndrs/postprocessing/issues/286), [#475](https://github.com/pmndrs/postprocessing/issues/475)
- https://github.com/Alchemist0823/three.quarks · https://github.com/gkjohnson/three-mesh-bvh · https://github.com/goldfire/howler.js (README, issue #1220) · https://github.com/protectwise/troika
- https://threejs.org/docs/pages/GLTFLoader.html · https://gltf-transform.dev/modules/extensions/classes/EXTMeshoptCompression
- https://github.com/Hiraeth010/blackwater · https://github.com/mohsenheydari/three-fps · https://github.com/im-oree/Three-FPS
- https://github.com/AR-js-org/locar.js · https://github.com/AR-js-org/AR.js · https://www.npmjs.com/package/locar
- https://github.com/shorepine/kenney · https://github.com/ETdoFresh/kenney.nl · https://github.com/KenneyNL/Starter-Kit-FPS · https://github.com/KayKit-Game-Assets/KayKit-Space-Base-Bits-1.0 · https://github.com/iwenzhou/kenney
- https://kenney.nl/assets/blaster-kit · https://kenney.nl/assets/sci-fi-sounds · https://quaternius.com/packs/ultimategun.html · https://poly.pizza/bundle/Ultimate-Guns-Pack-cpgUfI4t2F (не доступны из контейнера, не проверены)
- https://github.com/mrdoob/three.js (`examples/textures/sprites/`, `examples/textures/lensflare/LICENSE.txt`, `examples/sounds/readme.txt`)
