# Фокси-слайм — настольный питомец для Kimi Work

Настольный питомец (desktop pet): оранжево-чёрный слайм с лисьей мордочкой.
Две версии пакета: классическая спрайтовая и 3D (Three.js + GLB).

## Структура

- `pets/fox-slime/` — **активная версия**: спрайтовый пакет (pet.json + spritesheet.png),
  8 состояний: idle, working, waiting, failed, running_left/right, idle_random_1/2.
- `pets/fox-slime-3d/` — 3D-версия (`renderer: "three"`, pet.js — собранный бандл
  three.js + GLTFLoader + рантайм + GLB в base64). Сейчас внутри реалистичная
  лисичка, сгенерированная по фото-референсу (Tripo API), ~30 тыс. полигонов.
- `runtime/` — исходники рантаймов:
  - `runtime.js` — рантайм для Blender-модели с именованными частями (уши, глаза, хвост).
  - `runtime-real.js` — рантайм для цельной (монолитной) GLB: плавные движения всего тела
    (дыхание, покачивание, наклон к курсору, сердечко при поглаживании).
  - `three.min.js`, `GLTFLoader.js` — three@0.147.0 UMD.
- `tools/` — `build_petjs.py` (сборка pet.js) и `build_model.py` (Blender headless сборка GLB).
- `assets/` — референсы и модели: master-reference.png (одобренный 2D-референс),
  reference-want.jpg (фото-образец лисички), fox-20k.glb (облегчённая 3D-модель),
  fox-slime.glb (Blender-модель), превью.
- `test/test2.html` — тестовая страница: `?state=working`, `?pat=1`.

## Сборка pet.js

```
python tools/build_petjs.py --glb assets/fox-20k.glb \
  --three runtime/three.min.js --loader runtime/GLTFLoader.js \
  --runtime runtime/runtime-real.js --out pets/fox-slime-3d/pet.js
```

В рантайме должен быть плейсхолдер `__GLB_BASE64__`.

## Установка

Через Kimi Work: `Widget.installPet` с `packagePath` на папку пакета
(`pets/fox-slime` или `pets/fox-slime-3d`). Один и тот же `id: fox-slime` —
переустановка обновляет существующий виджет.

## Рабочий процесс

Все изменения делаются локально в этой папке, проверяются, и только после
подтверждения владельца выгружаются на GitHub.
