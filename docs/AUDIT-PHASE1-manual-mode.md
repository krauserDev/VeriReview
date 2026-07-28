# VeriReview — Auditoría Fase 1: Modo Manual + Optimización de la base

Fecha: 2026-07-10

Esta primera fase reorienta la extensión al **modo manual** (requisito de diseño
central) y limpia/optimiza la base para poder añadir funcionalidades poco a poco
sobre una arquitectura sólida. **No** se han añadido aún las 20 funcionalidades
del brief: eso es trabajo incremental posterior (ver "Roadmap").

## 1. Cambio de arquitectura: idle por defecto

**Antes:** al cargar cualquier página soportada, el content script ejecutaba
`main()` y montaba de inmediato panel + botón flotante + un `MutationObserver`
sobre `document.body` + tres `setInterval` (reintentos, navegación SPA). Eso
consumía CPU permanentemente y era la causa raíz del parpadeo del Trust Index
(79↔80): el observer reaccionaba a los propios cambios de la extensión y a los
tokens volátiles de la URL de Google (`sxsrf`), re-analizando en bucle.

**Ahora:** el content script queda **completamente inactivo** al cargar. Lo único
que registra es un listener de mensajes y una comprobación del ajuste opcional
`autoScan`. No hay observers, ni timers en marcha, ni UI inyectada, ni consultas
al DOM hasta que el usuario lo pide explícitamente.

- Archivo reescrito: [src/content/index.ts](../src/content/index.ts)
- **Por qué mejora:** elimina por completo el consumo de CPU en reposo y hace
  imposible el bucle de re-análisis (no existe ningún lazo permanente en todo el
  código: verificado con grep de `setInterval`/`observe`/`MutationObserver` → 0
  coincidencias). El parpadeo desaparece *por construcción*, no por parche.

## 2. Tres vías para iniciar el análisis (control del usuario)

1. **Popup (principal):** nuevo estado "listo para analizar" que muestra el sitio
   detectado, tiempo estimado (según profundidad) y features, con un botón
   primario grande **"Analyze reviews"**. Si ya hay un análisis para la página,
   muestra el resultado con acciones *Re-analyze / Full report / Clear*.
   - [src/popup/popup.html](../src/popup/popup.html),
     [popup.css](../src/popup/popup.css), [popup.ts](../src/popup/popup.ts)
2. **Menú contextual (clic derecho):** "Analyze reviews with VeriReview".
   Se ha corregido un bug: antes solo se registraba para `amazon.com`/`google.com`;
   ahora cubre **todos los dominios soportados** (`.es`, `.de`, `.fr`, …) desde
   una única lista compartida.
3. **Atajo de teclado:** `Alt+Shift+A` (personalizable en `chrome://extensions/shortcuts`),
   añadido vía `commands` en el manifest y manejado en el service worker.

- [src/background/service-worker.ts](../src/background/service-worker.ts),
  [public/manifest.json](../public/manifest.json)

## 3. Limpieza total al cerrar (sin residuos)

El botón **✕** del panel ahora ejecuta un `teardown()` completo:
elimina el panel y el botón flotante, destruye el tooltip, quita todos los
highlights/chips de las reseñas, cancela cualquier reintento pendiente, limpia el
badge y resetea el estado. La página queda **exactamente** como estaba.

- El tooltip tenía una **fuga de listeners** (se añadían a `document`/`window` sin
  poder quitarse). Ahora `destroyTooltip()` los elimina limpiamente.
  [src/content/tooltip.ts](../src/content/tooltip.ts)
- El `Panel` también quita su listener global de `keydown` al destruirse.
  [src/content/panel.ts](../src/content/panel.ts)
- **Sesión efímera:** al no persistir ningún flag "seguir analizando", **refrescar
  la página elimina todo** automáticamente.

## 4. Ajuste opcional de modo automático

`autoScan` pasa a **`false` por defecto** (antes `true`). Si el usuario lo activa
en Ajustes, la extensión vuelve a analizar automáticamente las páginas
soportadas. La copy de Ajustes se ha reescrito para explicarlo y mencionar el
atajo de teclado.

- [src/types/index.ts](../src/types/index.ts),
  [src/options/options.html](../src/options/options.html)

## 5. Robustez de identidad de reseñas

Los ids de reseña se **fijan al elemento del DOM** (`WeakMap`) la primera vez que
se ven, de modo que un re-render trivial del sitio (espacios, carga diferida) no
cambia el id y no rompe la deduplicación. El detector universal también **excluye
la propia UI** de la extensión (`[data-verireview]`, `.rs-fab`, `.rs-tooltip`,
`.rs-chip`) para no confundirla nunca con una reseña.

## 6. Verificación

- `tsc --noEmit`: sin errores.
- `eslint src --max-warnings 0`: sin warnings.
- Build correcto. Bundle del content script: 43.3kb → **42.3kb**.
- Sin bucles/observers/timers permanentes en `src` (verificado por grep).
- Sin referencias muertas a mensajes o callbacks eliminados.

## Roadmap (siguientes fases, incremental)

Pendiente del brief, a abordar poco a poco sobre esta base:
Trust Breakdown, Confidence Meter, Product Trust History + tendencia, Compare
Products, Seller Reputation, Smart Purchase Recommendation, Fake Review Timeline,
Smart Warnings, Review Search, Export PDF profesional, Scan History Dashboard,
"Explain this review", Read-before-buying, Privacy Dashboard, y ampliar la
arquitectura de adapters (Trustpilot, eBay, AliExpress, TripAdvisor, Booking…).
