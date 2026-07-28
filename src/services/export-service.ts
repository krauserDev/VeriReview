/** Export analyses as JSON, CSV, or a printable report (Save as PDF). */
import type { PageAnalysis } from '../types/index.js';

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export function exportJson(analysis: PageAnalysis): void {
  download(`verireview-${stamp()}.json`, 'application/json', JSON.stringify(analysis, null, 2));
}

function csvCell(value: string | number | boolean | null): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(analysis: PageAnalysis): void {
  const header = [
    'author', 'author_review_count', 'rating', 'date', 'verified',
    'score', 'level', 'signals', 'text',
  ];
  const rows = analysis.reviews.map((r) =>
    [
      r.review.author,
      r.review.authorReviewCount ?? '',
      r.review.rating ?? '',
      r.review.dateISO ?? '',
      r.review.verified,
      r.score,
      r.level,
      r.signals.map((s) => s.label).join('; '),
      r.review.text.slice(0, 500),
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM prefix: without it, Excel on Windows opens UTF-8 as ANSI and mangles
  // every accented character ("Héctor" → "HÃ©ctor") — most of our users read
  // Spanish reviews.
  const content = '﻿' + [header.join(','), ...rows].join('\n');
  download(`verireview-${stamp()}.csv`, 'text/csv;charset=utf-8', content);
}

/** Opens the report page (extension page); user prints → Save as PDF. */
export function exportPdf(analysis: PageAnalysis): void {
  void chrome.runtime.sendMessage({ type: 'OPEN_REPORT', analysis });
}
