/** Styles for the floating panel's Shadow DOM. Isolated from the host page.
 *
 * Design language — "forensic dossier": warm paper/ink surfaces (no glass), a
 * gold "seal of authenticity" accent, monospaced data (scores, counts, field
 * labels read as instrument output) against a humanist sans for prose, and
 * squared geometry with crisp hairlines instead of pills and blur. */
export const PANEL_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.rs-panel {
  --bg: #f2efe7;
  --bg-solid: #f2efe7;
  --card: #fbfaf5;
  --ink: #1b1b1d;
  --ink-soft: #6c6a63;
  --line: rgba(27, 24, 18, 0.13);
  --line-strong: rgba(27, 24, 18, 0.22);
  --accent: #8a6410;
  --accent-fill: #c48f2c;
  --on-fill: #241c09;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace;
  --shadow: 0 26px 64px -18px rgba(26, 19, 6, 0.42), 0 2px 8px -2px rgba(26, 19, 6, 0.16);

  position: fixed;
  top: 16px; right: 16px; bottom: 16px;
  width: min(400px, calc(100vw - 32px));
  z-index: 2147483646;
  display: flex; flex-direction: column;
  border-radius: 13px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--ink);
  font: 400 13.5px/1.55 var(--font-sans);
  box-shadow: var(--shadow);
  overflow: hidden;
  transform: translateX(calc(100% + 28px));
  transition: transform 0.34s cubic-bezier(0.22, 1, 0.36, 1);
}
.rs-panel--open { transform: translateX(0); }
.rs-panel--dark {
  --bg: #191816;
  --bg-solid: #191816;
  --card: #232220;
  --ink: #ebe7de;
  --ink-soft: #9a968b;
  --line: rgba(235, 231, 222, 0.12);
  --line-strong: rgba(235, 231, 222, 0.2);
  --accent: #d9ab4d;
  --accent-fill: #d9ab4d;
  --on-fill: #201a0b;
  --shadow: 0 26px 64px -18px rgba(0, 0, 0, 0.62), 0 2px 8px -2px rgba(0, 0, 0, 0.4);
}

.rs-head {
  display: flex; align-items: center; gap: 11px;
  padding: 15px 16px 13px;
  border-bottom: 1px solid var(--line);
  box-shadow: inset 0 2px 0 var(--accent-fill);
}
.rs-head__logo { width: 25px; height: 25px; border-radius: 6px; }
.rs-head__name {
  font: 700 14px/1.1 var(--font-mono); letter-spacing: 0.01em;
}
.rs-head__site { color: var(--ink-soft); font-size: 11.5px; margin-top: 2px; }
.rs-head__spacer { flex: 1; }

.rs-iconbtn {
  width: 29px; height: 29px; display: grid; place-items: center;
  border: 1px solid var(--line-strong); border-radius: 7px;
  background: var(--card); color: var(--ink);
  font-size: 13px; cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.rs-iconbtn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.rs-iconbtn:focus-visible, .rs-btn:focus-visible, .rs-tab:focus-visible,
.rs-review__open:focus-visible, .rs-review__author:focus-visible,
.rs-starbar:focus-visible, .rs-authorbar__clear:focus-visible {
  outline: 2px solid var(--accent-fill); outline-offset: 2px;
}

.rs-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px 16px; }
.rs-body::-webkit-scrollbar { width: 9px; }
.rs-body::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 2px; }

.rs-hero { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.rs-hero__label { font-size: 17px; font-weight: 800; letter-spacing: -0.01em; }
.rs-hero__meta { color: var(--ink-soft); font-size: 11.5px; margin-top: 3px; }
.rs-hero__meta:last-child { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.01em; }
.rs-badge {
  display: inline-block; margin: 7px 0 4px; padding: 3px 9px;
  border-radius: 5px; font: 700 11px var(--font-mono); letter-spacing: 0.03em; color: #fff;
}

.rs-breakdown {
  font-size: 12px; line-height: 1.5; color: var(--ink-soft);
  padding: 11px 12px; margin-bottom: 12px;
  border-radius: 8px; border: 1px solid var(--line);
  border-left: 3px solid var(--accent-fill);
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}
.rs-breakdown b { color: var(--ink); font-variant-numeric: tabular-nums; }

.rs-more {
  display: grid; gap: 9px; margin-bottom: 12px;
  padding: 11px 12px; border-radius: 8px;
  border: 1px solid var(--accent-fill);
  background: color-mix(in srgb, var(--accent) 11%, transparent);
  font-size: 12px; line-height: 1.5; color: var(--ink-soft);
}
.rs-more b { color: var(--ink); }
.rs-more__btn { flex: none; }

.rs-explain { margin-bottom: 14px; font-size: 12px; }
.rs-explain > summary {
  cursor: pointer; color: var(--accent); font-weight: 700; list-style: none;
  padding: 3px 0; font-family: var(--font-mono); font-size: 11.5px;
}
.rs-explain > summary::-webkit-details-marker { display: none; }
.rs-explain > summary::before { content: "[+] "; }
.rs-explain[open] > summary::before { content: "[-] "; }
.rs-explain ul { margin: 8px 0 0; padding-left: 16px; display: grid; gap: 6px; }
.rs-explain li { color: var(--ink-soft); line-height: 1.5; }
.rs-explain b { color: var(--ink); }
.rs-disclaimer {
  margin-top: 10px; padding: 9px 11px; border-radius: 7px;
  border: 1px solid var(--line); background: var(--card);
  color: var(--ink-soft); font-size: 11.5px; line-height: 1.5;
}

.rs-hint { font-weight: 500; text-transform: none; letter-spacing: 0; opacity: 0.85; font-family: var(--font-sans); }

.rs-note {
  margin: 9px 2px 0; color: var(--ink-soft);
  font-size: 11.5px; line-height: 1.5;
}
.rs-note b { color: var(--ink); }

.rs-legend { display: grid; gap: 8px; }
.rs-legend__row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ink-soft); }
.rs-legend__row b { color: var(--ink); margin-left: auto; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.rs-legend__dot { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }

.rs-gauge__arc { transition: stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1); }
.rs-gauge__num { font: 800 34px var(--font-mono); font-variant-numeric: tabular-nums; }
.rs-gauge__sub { font: 600 10px var(--font-mono); opacity: 0.6; letter-spacing: 0.05em; }

.rs-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 15px; }
.rs-stat {
  padding: 11px 8px; border-radius: 8px; border: 1px solid var(--line);
  background: var(--card); text-align: center;
}
.rs-stat__num { font: 800 18px var(--font-mono); font-variant-numeric: tabular-nums; }
.rs-stat__label { font: 600 9.5px var(--font-mono); color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

.rs-section { margin-bottom: 17px; }
.rs-section__title {
  font: 700 10.5px var(--font-mono); text-transform: uppercase;
  letter-spacing: 0.11em; color: var(--ink-soft); margin-bottom: 9px;
}
.rs-section__title::before {
  content: ""; display: inline-block; width: 9px; height: 2px;
  background: var(--accent-fill); vertical-align: middle;
  margin-right: 7px; margin-bottom: 2px;
}
.rs-section__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  flex-wrap: wrap; margin-bottom: 9px;
}
.rs-section__head .rs-section__title { margin-bottom: 0; }
.rs-section__controls { display: flex; gap: 6px; flex-wrap: wrap; }
.rs-tab[hidden] { display: none; }
.rs-select {
  font: 600 11.5px var(--font-mono);
  color: var(--ink); background: var(--card);
  border: 1px solid var(--line-strong); border-radius: 6px;
  padding: 4px 23px 4px 10px; cursor: pointer;
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23908c82' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 8px center;
}
.rs-select:focus-visible { outline: 2px solid var(--accent-fill); outline-offset: 2px; }
/* The native dropdown list is OS-rendered: without explicit colors the options
   inherit the panel's light ink over a white popup and become unreadable. */
.rs-select option { color: #1b1b1d; background: #ffffff; }
.rs-panel--dark .rs-select { color-scheme: dark; }
.rs-panel--dark .rs-select option { color: #ebe7de; background: #232220; }
.rs-card { padding: 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); }
.rs-chart__label, .rs-chart__value { font: 600 10px var(--font-mono); fill: var(--ink-soft); }

/* Clickable rating-distribution bars (filter reviews by customer star rating). */
.rs-starbar {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 5px 7px; margin: 1px 0; border: 1px solid transparent; border-radius: 6px;
  background: none; color: var(--ink); cursor: pointer; text-align: left;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.rs-starbar:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 13%, transparent); }
.rs-starbar--on { border-color: var(--accent-fill); background: color-mix(in srgb, var(--accent) 17%, transparent); }
.rs-starbar:disabled { cursor: default; opacity: 0.5; }
.rs-starbar__label { flex: 0 0 28px; font: 700 12px var(--font-mono); font-variant-numeric: tabular-nums; }
.rs-starbar__track { flex: 1 1 auto; height: 11px; border-radius: 2px; background: color-mix(in srgb, var(--ink) 10%, transparent); overflow: hidden; }
.rs-starbar__fill { display: block; height: 100%; border-radius: 2px; min-width: 0; }
.rs-starbar__count { flex: 0 0 auto; min-width: 26px; text-align: right; font: 600 12px var(--font-mono); color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.rs-donut__num { font: 800 20px var(--font-mono); fill: var(--ink); }
.rs-donut__sub { font: 600 8px var(--font-mono); fill: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.05em; }
.rs-empty { color: var(--ink-soft); font-size: 12px; padding: 4px 0; }
.rs-split { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center; }

.rs-pattern { display: flex; gap: 9px; padding: 9px 0; border-bottom: 1px solid var(--line); }
.rs-pattern:last-child { border-bottom: 0; }
.rs-pattern__dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 2px; margin-top: 5px; }
.rs-pattern__label { font-weight: 700; font-size: 12.5px; }
.rs-pattern__detail { color: var(--ink-soft); font-size: 12px; }

.rs-rec { display: flex; gap: 8px; padding: 5px 0; font-size: 12.5px; }
.rs-rec::before { content: "\\2192"; color: var(--accent); font-weight: 700; }

.rs-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
.rs-tab {
  padding: 5px 10px; border-radius: 6px; border: 1px solid var(--line-strong);
  background: var(--card); color: var(--ink-soft); font: 600 11px var(--font-mono);
  letter-spacing: 0.01em; cursor: pointer; transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.rs-tab:hover { color: var(--ink); }
.rs-tab[aria-pressed="true"] { background: var(--accent-fill); border-color: var(--accent-fill); color: var(--on-fill); }

.rs-review {
  display: block;
  padding: 11px 12px; margin-bottom: 8px;
  border-radius: 8px; border: 1px solid var(--line);
  background: var(--card); color: var(--ink);
  font: inherit;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.rs-review:hover { border-color: var(--accent-fill); box-shadow: inset 3px 0 0 var(--accent-fill); }
.rs-review__top { display: flex; align-items: center; gap: 9px; }
.rs-review__score { font: 800 13px var(--font-mono); font-variant-numeric: tabular-nums; }
.rs-review__author {
  flex: 1; min-width: 0; text-align: left;
  font: 600 12px var(--font-sans);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: none; border: none; padding: 0; color: var(--ink); cursor: pointer;
  border-radius: 3px;
}
.rs-review__author:hover { color: var(--accent); text-decoration: underline; }
.rs-review__author--multi { color: var(--accent); }
.rs-review__author--multi::before {
  content: "\\29C9"; margin-right: 4px; font-weight: 700; text-decoration: none;
}
.rs-review__meta { color: var(--ink-soft); font: 500 10.5px var(--font-mono); flex: 0 0 auto; }
.rs-review__open {
  display: block; width: 100%; text-align: left;
  background: none; border: none; padding: 0; margin-top: 5px;
  color: inherit; font: inherit; cursor: pointer;
}
.rs-review__text {
  color: var(--ink-soft); font-size: 12px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.rs-review__tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }

.rs-authorbar {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 10px; margin-bottom: 8px;
  border-radius: 7px; border: 1px solid var(--accent-fill);
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  font: 600 12px var(--font-mono);
}
.rs-authorbar__clear {
  flex: 0 0 auto; background: none; border: none; cursor: pointer;
  color: var(--accent); font: inherit; font-weight: 700; padding: 2px 4px; border-radius: 5px;
}
.rs-authorbar__clear:hover { text-decoration: underline; }
.rs-tag {
  padding: 1px 6px; border-radius: 3px; font: 700 10px var(--font-mono); letter-spacing: 0.01em;
  background: color-mix(in srgb, var(--ink) 8%, transparent); color: var(--ink-soft);
  border: 1px solid var(--line);
}

.rs-foot {
  display: flex; gap: 7px; padding: 11px 16px;
  border-top: 1px solid var(--line);
  background: var(--card);
}
.rs-btn {
  flex: 1; padding: 9px 8px; border-radius: 7px;
  border: 1px solid var(--line-strong); background: var(--card); color: var(--ink);
  font: 700 11.5px var(--font-mono); letter-spacing: 0.03em; text-transform: uppercase;
  cursor: pointer; transition: background 0.15s ease, border-color 0.15s ease;
}
.rs-btn:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
.rs-btn--primary {
  background: var(--ink); border-color: var(--ink); color: var(--bg);
  text-transform: none; letter-spacing: 0.01em;
}
.rs-btn--primary:hover { background: color-mix(in srgb, var(--ink) 86%, var(--accent-fill)); }

.rs-scanning { display: flex; align-items: center; gap: 10px; padding: 30px 0; justify-content: center; color: var(--ink-soft); font-family: var(--font-mono); font-size: 12px; }
.rs-spinner {
  width: 17px; height: 17px; border-radius: 50%;
  border: 2.5px solid var(--line-strong); border-top-color: var(--accent-fill);
  animation: rs-spin 0.8s linear infinite;
}
@keyframes rs-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .rs-panel, .rs-gauge__arc, .rs-btn, .rs-review, .rs-iconbtn { transition: none !important; }
  .rs-spinner { animation-duration: 2s; }
}
`;
