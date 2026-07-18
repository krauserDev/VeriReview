/**
 * Regression tests for the Amazon adapter against the NEW (camelCase
 * data-hook) layout — the bug where every review showed the same boilerplate
 * text because `review-body` no longer exists.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, withDom } from './helpers.mjs';
import { amazonAdapter } from './.build/amazon.js';

const fixture = loadFixture('amazon-review-new.html');
const URL_ES = 'https://www.amazon.es/dp/B0TEST';

test('new layout: body comes from data-hook="reviewText", not a11y teasers', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.ok(review, 'review parses');
    assert.equal(review.text, 'Super bien y genial de precio. Funciona todo perfectamente');
  }, URL_ES);
});

test('new layout: title from reviewTitle with star alt-text stripped', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.equal(review.title, 'Móvil bueno');
  }, URL_ES);
});

test('new layout: rating 5 from "5 de 5 estrellas"', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.equal(review.rating, 5);
  }, URL_ES);
});

test('new layout: verified purchase via avp-badge', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.equal(review.verified, true);
  }, URL_ES);
});

test('new layout: Spanish absolute date parsed ("1 de julio de 2026")', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.ok(review.dateISO?.startsWith('2026-07-01'), `got ${review.dateISO}`);
  }, URL_ES);
});

test('new layout: author and stable id from element id', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.equal(review.author, 'Ainoa');
    assert.equal(review.id, 'R18LA3PARHZ2G6');
  }, URL_ES);
});

test('boilerplate never leaks: no "double tap", "Enviando", "Leer más" in body', () => {
  withDom(fixture, (document) => {
    const review = amazonAdapter.parseReview(document.querySelector('[data-hook="review"]'));
    assert.doesNotMatch(review.text, /double tap|content visible|Enviando|Leer más|Leer menos/i);
  }, URL_ES);
});
