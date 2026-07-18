/** Unit tests: multilingual date parsing + generic-author detection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from './helpers.mjs';
import {
  parseReviewDate,
  isGenericAuthor,
  isMoreReviewsLabel,
  isNavigatingControl,
  reviewStar,
} from './.build/utils.js';

const NOW = new Date('2026-07-10T12:00:00Z');

const DATE_CASES = [
  ['Hace 5 meses', '2026-02'],
  ['Hace 2 semanas', '2026-06-26'],
  ['Hace un mes', '2026-06-10'],
  ['Hace 8 meses', '2025-11'],
  ['3 weeks ago', '2026-06-19'],
  ['a month ago', '2026-06-10'],
  ['vor 3 Monaten', '2026-04'],
  ["il y a 2 mois", '2026-05'],
  ['3 mesi fa', '2026-04'],
  ['Reseñado en España el 1 de julio de 2026', '2026-07-01'],
  ['Reviewed in the United States on January 5, 2026', '2026-01-05'],
  ['5 January 2026', '2026-01-05'],
  ['1. Juli 2026', '2026-07-01'],
  ['Recensito in Italia il 3 maggio 2026', '2026-05-03'],
  ['Fecha de edición: Hace un mes', '2026-06-10'],
];

for (const [input, expected] of DATE_CASES) {
  test(`parseReviewDate(${JSON.stringify(input)}) → ${expected}…`, () => {
    const got = parseReviewDate(input, NOW);
    assert.ok(got !== null && got.startsWith(expected), `got ${got}`);
  });
}

test('parseReviewDate returns null for non-dates', () => {
  assert.equal(parseReviewDate('Muy buen producto, lo recomiendo', NOW), null);
});

const GENERIC = [
  'Google', 'Doctoralia', 'A Google User', 'Amazon Customer', 'anonymous', '',
  'Cliente Amazon', 'Cliente de Amazon', 'Client Amazon', 'Amazon-Kunde',
  'Usuario de Google', 'Anónimo',
];
const REAL = ['Josefa Lopez', 'Mari Carmen Couque Ramirez', 'Ainoa', 'SGY', 'María José'];

for (const name of GENERIC) {
  test(`isGenericAuthor(${JSON.stringify(name)}) is true`, () => {
    assert.equal(isGenericAuthor(name), true);
  });
}
for (const name of REAL) {
  test(`isGenericAuthor(${JSON.stringify(name)}) is false`, () => {
    assert.equal(isGenericAuthor(name), false);
  });
}

/* ---- "Load more reviews" control labels (real labels from live pages) ---- */

const LOAD_MORE = [
  'Mostrar 10 opiniones más', // Amazon reviews page — "más" AFTER the noun
  'Ver más opiniones', // Amazon product page — "más" BEFORE the noun
  'Más reseñas de usuarios', // Google
  'Show more reviews',
  'See more reviews',
  'Mehr Rezensionen anzeigen',
  "Afficher plus d'avis",
  'Mostra altre recensioni',
];
for (const label of LOAD_MORE) {
  test(`isMoreReviewsLabel(${JSON.stringify(label)}) is true`, () => {
    assert.equal(isMoreReviewsLabel(label), true);
  });
}

// Traps: controls that sit next to the real one and must never be clicked.
const NOT_LOAD_MORE = [
  'Reseñas más importantes', // Amazon SORT dropdown — has both "más" and "reseñas"
  'Opiniones más recientes',
  'Most recent reviews',
  'Top reviews',
  'Todos los autores de opiniones', // filter dropdown
  'Traducir todas las opiniones al español',
  'Buscar opiniones de clientes',
  'Escribir una opinión',
  'Denunciar reseña',
  'Ver los resultados web',
  '5 estrellas solo',
  '',
  'Cómo funcionan las opiniones y las valoraciones de los clientes en Amazon', // too long
];
for (const label of NOT_LOAD_MORE) {
  test(`isMoreReviewsLabel(${JSON.stringify(label)}) is false`, () => {
    assert.equal(isMoreReviewsLabel(label), false);
  });
}

/* ---- isNavigatingControl: expansion must only click in-place expanders ---- */

test('Google Search "Más reseñas de usuarios" expander is safe to click', () => {
  withDom(`<div id="t" role="button" jsaction="trigger.abc">Más reseñas de usuarios</div>`, (d) => {
    assert.equal(isNavigatingControl(d.getElementById('t')), false);
  });
});

test('Maps reviewer-profile button (data-href to /maps/contrib) is never clicked', () => {
  // The Verónica bug: this control opened the reviewer's profile in a new tab.
  withDom(
    `<button id="t" class="al6Kxe" jsaction="pane.wfvdle130.review.reviewerLink"
       data-href="https://www.google.com/maps/contrib/116614127033253037326/reviews?hl=es">
       <div class="d4r55">Verónica Mas</div><div class="RfnDt">1 reseña</div>
     </button>`,
    (d) => {
      assert.equal(isNavigatingControl(d.getElementById('t')), true);
    },
  );
});

test('a jsaction reviewerLink control without data-href is still screened out', () => {
  withDom(
    `<button id="t" jsaction="pane.x.review.reviewerLink">Más reseñas</button>`,
    (d) => assert.equal(isNavigatingControl(d.getElementById('t')), true),
  );
});

test('real anchors navigate; "#" anchors do not', () => {
  withDom(
    `<a id="real" href="/maps/contrib/1/reviews">Más reseñas</a>
     <a id="hash" href="#">Más reseñas</a>
     <a id="nested-holder" href="/somewhere"><span id="nested">Más reseñas</span></a>`,
    (d) => {
      assert.equal(isNavigatingControl(d.getElementById('real')), true);
      assert.equal(isNavigatingControl(d.getElementById('hash')), false);
      assert.equal(isNavigatingControl(d.getElementById('nested')), true, 'closest() covers nesting');
    },
  );
});


/* ---- reviewStar: the star bucket a rating filters into ---- */

test('reviewStar buckets ratings into 1–5 (rounding half-stars) or null', () => {
  assert.equal(reviewStar(5), 5);
  assert.equal(reviewStar(1), 1);
  assert.equal(reviewStar(4.5), 5, 'half rounds up');
  assert.equal(reviewStar(4.4), 4);
  assert.equal(reviewStar(3), 3);
  assert.equal(reviewStar(null), null, 'no rating → no bucket');
  assert.equal(reviewStar(0), 1, 'clamped into 1–5');
  assert.equal(reviewStar(9), 5, 'clamped into 1–5');
});
