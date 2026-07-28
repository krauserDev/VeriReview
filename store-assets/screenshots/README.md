# Capturas para la Chrome Web Store

Las 4 capturas forman un mini-tutorial. Tú haces las capturas **reales**; el
script las enmarca a 1280×800 con el número de paso y el título.

## 1. Prepara el navegador

```
chrome://extensions  →  Modo desarrollador  →  Cargar descomprimida  →  dist/
```

Recarga la extensión y la página antes de capturar, para que salga el nombre
e icono nuevos (VeriReview).

## 2. Haz estas 4 capturas

Guárdalas en `raw/` con estos nombres exactos, en PNG:

| Archivo | Qué debe verse |
|---|---|
| `raw/1.png` | Una página **real** de reseñas: producto de Amazon o ficha de Google Maps, con las opiniones visibles. |
| `raw/2.png` | La misma página con el **menú del clic derecho abierto**. |
| `raw/3.png` | El menú con **"Analyze reviews with VeriReview"** resaltado (pásale el ratón por encima). |
| `raw/4.png` | El **panel de VeriReview ya abierto**: Trust Index, gráfico de estrellas y veredictos. |

Consejos:

- Captura la ventana completa del navegador (Alt+Impr Pant) — el script la
  escala y recorta el marco por ti.
- No hace falta que midan 1280×800; cualquier tamaño vale.
- Deben ser páginas **reales**. La Store rechaza capturas simuladas o
  engañosas.

## 3. Genera las imágenes finales

```bash
npm run screenshots
```

Salida: `01-step.png` … `04-step.png` (1280×800). Esas son las que subes al
dashboard, en orden, en la sección **Capturas de pantalla**.

Los títulos de cada paso están en `tools/screenshots/build-screenshots.mjs`
(constante `STEPS`) por si quieres reescribirlos.
