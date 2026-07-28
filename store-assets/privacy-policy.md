# VeriReview — Privacy Policy

_Last updated: July 2026_

## Summary

VeriReview does not collect, transmit, sell, or share any data. All analysis happens locally in your browser.

## What the extension does

When you visit a supported review page (Amazon product pages, Google Maps/Search business reviews), VeriReview reads the review content that is already visible in your browser and analyzes it **on your device** to compute trust scores.

## Data storage

The extension stores the following **only in your browser's local extension storage** (`chrome.storage`):

- **Settings** (site toggles, sensitivity, theme, etc.) — synced across your own Chrome profile via `chrome.storage.sync` if you are signed in to Chrome.
- **Scan history** (page URL, title, trust score, review counts, timestamp) — up to 200 entries, stored locally.
- **Scan cache** (full analysis of recently scanned pages) — automatically expires after 24 hours.

You can erase all stored data at any time from the options page ("Clear cache & history").

## Data transmission

**None.** VeriReview makes no network requests. There are no analytics, no telemetry, no crash reporting, no remote configuration, and no third-party services.

## Permissions explained

| Permission | Why it is needed |
|---|---|
| `storage` | Save your settings, scan history and cache locally. |
| `notifications` | Optionally alert you when a page scores below your chosen threshold. Can be disabled. |
| `contextMenus` | Adds a "Scan reviews with VeriReview" right-click entry. |
| `alarms` | Periodically prunes expired cache entries. |
| Host access to Amazon/Google domains | Read the reviews on the page so they can be analyzed locally. |

## Children

VeriReview does not knowingly collect any information from anyone, including children.

## Changes

If this policy ever changes (for example, if optional cloud AI providers are added in a future version), the change will be clearly announced in the release notes and this document will be updated before release. Any such feature would be strictly opt-in.

## Contact

Questions about privacy: open an issue in the project repository.
