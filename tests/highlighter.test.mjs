/**
 * Regression tests for hover-analysis lookup on Google Maps.
 *
 * Maps re-renders a review card the moment the pointer enters it (jsaction
 * "review.in" drives its hover overlay), wiping our data-rs-id / data-rs-level
 * attributes and the injected chip — exactly when the hover tooltip needs them.
 * The lookup must recover the analysis through Google's own data-review-id
 * (which survives the re-render) and re-stamp the fresh node.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from './helpers.mjs';
import { applyHighlights, clearHighlights, getAnalysisFor } from './.build/highlighter.js';

const CARD_HTML = `
<div class="jftiEf" data-review-id="ChdREVIEWID123">
  <div data-review-id="ChdREVIEWID123">
    <div id="content" class="GHT2ce">
      <span class="rsqaWe">Hace 2 años</span>
      <span id="body" class="wiI7pd">Los trabajadores muy majos y la comida buenísima.</span>
    </div>
  </div>
</div>`;

const makeAnalysis = (id) => ({
  review: { id, author: 'Verónica Escobar Rubio', rating: 5, title: '', text: 'x' },
  score: 42,
  level: 'attention',
  signals: [],
  similarTo: [],
});

test('hover lookup works through data-rs-id while it exists', () => {
  withDom(CARD_HTML, (document) => {
    const content = document.getElementById('content');
    applyHighlights([{ el: content, analysis: makeAnalysis('gg-ChdREVIEWID123') }]);
    const got = getAnalysisFor(document.getElementById('body'));
    assert.equal(got?.score, 42);
    clearHighlights();
  });
});

test('Maps hover re-render: analysis recovered via data-review-id and node re-stamped', () => {
  withDom(CARD_HTML, (document) => {
    const content = document.getElementById('content');
    applyHighlights([{ el: content, analysis: makeAnalysis('gg-ChdREVIEWID123') }]);

    // Simulate Google's re-render on pointer entry: attributes + chip wiped.
    delete content.dataset.rsId;
    delete content.dataset.rsLevel;
    content.querySelector('.rs-chip')?.remove();

    const got = getAnalysisFor(document.getElementById('body'));
    assert.ok(got, 'analysis must be recovered from the surviving data-review-id');
    assert.equal(got.score, 42);

    // The fresh card is re-stamped so outline, chip and future hovers work.
    const restamped = document.getElementById('body').closest('[data-rs-id]');
    assert.ok(restamped, 're-stamped host exists');
    assert.equal(restamped.dataset.rsId, 'gg-ChdREVIEWID123');
    assert.equal(restamped.dataset.rsLevel, 'attention');
    assert.ok(restamped.querySelector('.rs-chip'), 'chip re-created');
    clearHighlights();
  });
});

test('unanalyzed cards with a data-review-id resolve to null, not a crash', () => {
  withDom(CARD_HTML, (document) => {
    assert.equal(getAnalysisFor(document.getElementById('body')), null);
  });
});
