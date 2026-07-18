/**
 * Regression tests for the Google adapter, built from the exact bugs debugged
 * in session: platform names / UI labels mistaken for authors, aggregate
 * ratings detected as reviews, review bodies mistaken for dates, and our own
 * injected chip contaminating parses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, withDom } from './helpers.mjs';
import { googleAdapter } from './.build/google.js';
import { detectReviewCards, extractRating } from './.build/detector.js';

const searchCard = loadFixture('google-search-card.html');
const reviewsPage = loadFixture('google-reviews-page.html');
const dateTextNode = loadFixture('google-date-textnode.html');
const ownerReply = loadFixture('google-owner-reply.html');
const scriptAndAuthor = loadFixture('google-script-and-author.html');
const nonReviews = loadFixture('google-non-reviews.html');
const reviewAspects = loadFixture('google-review-aspects.html');
const shareAuthor = loadFixture('google-share-author.html');
const truncatedAttr = loadFixture('google-truncated-attr.html');

test('search card: author is the person, never "Google" nor "Denunciar reseña"', () => {
  withDom(searchCard, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.ok(review, 'review parses');
    assert.equal(review.author, 'Josefa Lopez');
  });
});

test('name outside the detected card: recovered from the share button aria-label', () => {
  withDom(shareAuthor, (document) => {
    // The detector selects the inner content block, which has no name node.
    const review = googleAdapter.parseReview(document.getElementById('content-card'));
    assert.ok(review, 'review parses');
    assert.equal(review.author, 'Stel Abelenda-DeLa');
  });
});

test('header outside the detected card: id and author profile come from the root', () => {
  withDom(shareAuthor, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('content-card'));
    // Stable id from the [data-review-id] ancestor, not a content hash.
    assert.equal(review.id, 'gg-ChZDSUhNMG9nS0VJQ0FnSUM4N2RybURREAE');
    // "Local Guide · 186 reseñas · 9 fotos" lives in the header sibling.
    assert.equal(review.authorIsLocalGuide, true);
    assert.equal(review.authorReviewCount, 186);
  });
});

test('name outside the detected card: never falls back to "A Google User"', () => {
  withDom(shareAuthor, (document) => {
    const cards = detectReviewCards(document.body);
    const authors = cards.map((c) => googleAdapter.parseReview(c)?.author).filter(Boolean);
    assert.ok(authors.length > 0, 'at least one card detected and parsed');
    assert.ok(
      authors.includes('Stel Abelenda-DeLa'),
      `expected the real name, got ${JSON.stringify(authors)}`,
    );
    assert.ok(!authors.includes('A Google User'), 'must not use the generic fallback');
  });
});

test('truncated attribute value: author is the person, never "C…"', () => {
  withDom(truncatedAttr, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('content-card'));
    assert.ok(review, 'review parses');
    assert.equal(review.author, 'Sandra Pastore');
    assert.doesNotMatch(review.author, /…|\.\.\./, 'author is never a truncated value');
  });
});

test('restaurant attributes: author is the person, never "Tipo de pedido" nor "Comida"', () => {
  withDom(reviewAspects, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.ok(review, 'review parses');
    assert.equal(review.author, 'Antonia Alberola');
  });
});

test('restaurant attributes: body is the review, not an attribute label', () => {
  withDom(reviewAspects, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.match(review.text, /Formidable volveremos/);
  });
});

test('search card: author profile count parsed from "89 opiniones"', () => {
  withDom(searchCard, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.authorReviewCount, 89);
  });
});

test('search card: rating comes from "5/5", not from our chip ("88 · …")', () => {
  withDom(searchCard, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.rating, 5);
  });
});

test('search card: date is "Hace 5 meses", not "Con 40 años" from the body', () => {
  withDom(searchCard, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.ok(review.dateISO, 'date parsed');
    const yearsAgo = (Date.now() - Date.parse(review.dateISO)) / (365 * 86_400_000);
    assert.ok(yearsAgo < 1, `date must be months ago, got ${review.dateISO} (~${yearsAgo.toFixed(1)}y)`);
  });
});

test('search card: body text is the review, not menu/UI labels', () => {
  withDom(searchCard, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.match(review.text, /vértigos/);
    assert.doesNotMatch(review.text, /Denunciar/);
  });
});

test('date as a bare text node ("<span>5/5</span> · Hace 7 meses") is parsed', () => {
  withDom(dateTextNode, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.ok(review.dateISO, 'date must parse even when it is not an element leaf');
    const monthsAgo = (Date.now() - Date.parse(review.dateISO)) / (30 * 86_400_000);
    assert.ok(monthsAgo > 6 && monthsAgo < 8, `expected ~7 months ago, got ${review.dateISO}`);
  });
});

test('date text node: body prose is never mistaken for the date', () => {
  withDom(dateTextNode, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.author, 'Ana Berenguer Andreu');
    assert.match(review.text, /peludo/);
  });
});

/* ---- Rated cards that are not user reviews must be rejected ---- */

test('topic highlight (quoted excerpt, no date) is not a review', () => {
  withDom(nonReviews, (document) => {
    assert.equal(googleAdapter.parseReview(document.getElementById('highlight')), null);
    assert.equal(googleAdapter.parseReview(document.getElementById('highlight2')), null);
  });
});

test('Google\'s own "your reviews won\'t affect rankings" notice is not a review', () => {
  withDom(nonReviews, (document) => {
    assert.equal(googleAdapter.parseReview(document.getElementById('notice')), null);
  });
});

test('a real dated review is still parsed (the filter is not over-eager)', () => {
  withDom(nonReviews, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('real'));
    assert.ok(review, 'real reviews must survive the non-review filter');
    assert.equal(review.author, 'Dhayana González');
    assert.equal(review.authorReviewCount, 287);
    assert.match(review.text, /Héctor/);
    assert.ok(review.dateISO);
  });
});

/* ---- Inline scripts and concatenated authors ---- */

test('inline <script> inside a card is never parsed as the review body', () => {
  withDom(scriptAndAuthor, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.doesNotMatch(review.text, /function|document\.|querySelectorAll|cVrhhd/,
      'script source must never reach the review body');
    assert.match(review.text, /Héctor/, 'the real review text is kept');
  });
});

test('author name is not glued to the profile count', () => {
  withDom(scriptAndAuthor, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.author, 'Victor Villarroya Ramírez');
    assert.doesNotMatch(review.author, /reseñas|Local Guide/);
  });
});

test('script card: count and rating still parse correctly', () => {
  withDom(scriptAndAuthor, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.authorReviewCount, 5);
    assert.equal(review.rating, 5);
  });
});

/* ---- Owner replies must never contaminate the user's review ---- */

test('owner reply: its text is excluded from the review body', () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.match(review.text, /lesión de hombro/, 'keeps the reviewer prose');
    assert.doesNotMatch(review.text, /placer atenderte|propietario/i, 'drops the owner reply');
  });
});

test('owner reply: author stays the reviewer, not the business', () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.author, 'Dhayana González');
  });
});

test("owner reply: date is the review's, not the owner's reply date", () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    const yearsAgo = (Date.now() - Date.parse(review.dateISO)) / (365 * 86_400_000);
    assert.ok(yearsAgo > 1.5 && yearsAgo < 2.5, `expected ~2 years (review), got ${review.dateISO}`);
  });
});

test('reaction prompt is never mistaken for review prose', () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.doesNotMatch(review.text, /cursor|reaccionar/i);
  });
});

test('body is the review, never the whole card glued together', () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.doesNotMatch(review.text, /Dhayana|Local Guide|287 rese|Denunciar|Trusted/);
  });
});

test('owner reply card: Local Guide + review count still parsed', () => {
  withDom(ownerReply, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('card'));
    assert.equal(review.authorReviewCount, 287);
    assert.equal(review.authorIsLocalGuide, true);
  });
});

test('reviews page: detector finds both cards via role="img" aria ratings', () => {
  withDom(reviewsPage, (document) => {
    const cards = detectReviewCards(document);
    const withR1 = cards.some((c) => c.querySelector?.('#r1') || c.id === 'r1' || c.closest?.('#r1'));
    const withR2 = cards.some((c) => c.querySelector?.('#r2') || c.id === 'r2' || c.closest?.('#r2'));
    assert.ok(withR1, 'review r1 detected');
    assert.ok(withR2, 'review r2 detected');
  });
});

test('reviews page: the aggregate header rating ("42 reseñas de usuario") is not a card', () => {
  withDom(reviewsPage, (document) => {
    const cards = detectReviewCards(document);
    for (const card of cards) {
      assert.ok(
        !card.querySelector('#header') && card.id !== 'header' && !card.closest('#header'),
        'no detected card may sit inside the aggregate header',
      );
    }
  });
});

/* ---- Rating extraction must not read a date or body prose as a rating ---- */

test('a May date in the body is NOT read as a 1-star rating', () => {
  // "1/5/2026" (1 May) contains "1/5" — the old whole-textContent fallback read
  // it as rating 1 and fabricated phantom low-star reviews.
  withDom(
    `<div id="card">
       <span role="img" aria-label="5 estrellas"></span>
       <span>Reseñado el 1/5/2026</span>
       <div>Los trabajadores muy majos y la comida buenísima, recomiendo.</div>
     </div>`,
    (document) => {
      assert.equal(extractRating(document.getElementById('card')), 5, 'the widget wins, not the date');
    },
  );
});

test('a body phrase ("1 de 5 sesiones") is not read as a rating', () => {
  withDom(
    `<div id="card">
       <span class="wiI7pd">Fui 1 de 5 sesiones recomendadas y ya noto mejoría, un trato excelente.</span>
     </div>`,
    (document) => {
      // No rating widget at all → must be null, never 1 from the prose.
      assert.equal(extractRating(document.getElementById('card')), null);
    },
  );
});

test('a genuine 1-star widget is still read as 1', () => {
  withDom(
    `<div id="card"><span class="rsqaWe">1/5</span><div>No lo recomiendo para nada.</div></div>`,
    (document) => assert.equal(extractRating(document.getElementById('card')), 1),
  );
});

test('reviews page: per-review author + count parsed ("1 reseña" → 1)', () => {
  withDom(reviewsPage, (document) => {
    const review = googleAdapter.parseReview(document.getElementById('r2'));
    assert.equal(review.author, 'Jose Carlos Soriano Rodriguez');
    assert.equal(review.authorReviewCount, 1);
    assert.equal(review.rating, 5);
  });
});
