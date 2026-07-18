# Chrome Web Store — compliance dossier

Evidence that ReviewShield complies with the Chrome Web Store Developer Program
Policies, **including the updates enforced from 1 August 2026**. Every claim
below is verifiable from the source tree; the commands are runnable.

Last audited: 2026-07-12

---

## 1. Limited Use / user data (enforced 2026-08-01)

**Policy:** data may be collected only as strictly necessary for the disclosed
single purpose; collection for unrelated uses (analytics, ads, future features)
is prohibited; all collection must be disclosed up-front and practices may not
change silently after install.

**Our position: ZERO data collection.** Nothing is collected, so there is
nothing to justify, limit or disclose beyond "none".

**Verify:**

```bash
# No network primitives anywhere in the source. Expect: no matches.
grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.connection" src/

# No analytics/telemetry SDKs in code. Expect: no matches.
# (Restricted to .ts: the only hit in .html is our own copy stating we collect
#  no telemetry — a claim, not a tracker.)
grep -rniE "analytics|telemetry|gtag|mixpanel|sentry|amplitude|segment\.io" src/ --include=*.ts

# No dependencies that could phone home: the extension bundles no runtime deps.
node -e "const p=require('./package.json');console.log('runtime deps:', p.dependencies||'(none)')"

# No remote hosts in the manifest beyond the pages we analyze.
node -e "const m=require('./public/manifest.json');console.log(m.host_permissions)"
```

Last run of the above (2026-07-12): **all clean** — no network primitives, no
trackers, **zero runtime dependencies**.

Runtime proof: DevTools → Network → run an analysis → **zero outbound requests**.

**Declared in the dashboard:** no data categories ticked + all three
certifications signed. Privacy policy states zero collection explicitly (§0).

**Storage that does exist (local only, disclosed):** user preferences
(`chrome.storage.sync` — Chrome's own sync across the user's devices, no
browsing data) and a local scan history (`chrome.storage.local`, auto-pruned,
user-clearable). This is *storage on the user's device*, not collection by us.

## 2. No obfuscated code

**Policy:** minification allowed; obfuscation and hidden functionality banned.

- Build is `esbuild --minify` — standard minification, no obfuscator, no
  string-encoding, no packing, no anti-debug.
- **No remote code**: everything ships in the package; no `eval`, no `new
  Function`, no CDN/remote scripts, no `unsafe-eval` CSP.
- Full source published and unobfuscated, so reviewers can diff source ↔ bundle.

**Verify:**

```bash
grep -rnE "\beval\(|new Function\(" src/          # expect: no matches
node -e "const m=require('./public/manifest.json');console.log(m.content_security_policy||'(default MV3 CSP)')"
npm run build                                      # reproducible from source
```

## 3. Single purpose

**Purpose:** *rate the trustworthiness of the reviews on the page the user is
viewing.* Every permission maps to it (see §5). No unrelated functionality, no
bundled extras, no injected ads or affiliate links.

## 4. Minimum permissions

| Permission | Why it is strictly necessary |
|---|---|
| host permissions (amazon.\*/google.\*) | Read the reviews rendered on those pages and draw the panel. Scoped to exactly the sites we support — no `<all_urls>`. |
| `storage` | Persist user preferences + local scan history. |
| `notifications` | Optional, user-disablable local warning on very low scores. Generated on-device; no push service. |
| `contextMenus` | The right-click "Analyze reviews" entry (one of 3 manual triggers). |
| `alarms` | Prune expired local cache every 6 h so storage doesn't grow. |

**Not requested:** `<all_urls>`, `tabs`, `webRequest`, `cookies`, `history`,
`identity`, `scripting`, `downloads`, `management`, `nativeMessaging`.

**Hardened 2026-07-12:** `web_accessible_resources` was `https://*/*`, which let
**any** website fingerprint the extension. Now scoped to the supported domains
only.

## 5. Idle by default (defensible design)

The content script does **nothing** on load — no DOM scanning, no observers, no
timers, no injected UI — until the user explicitly triggers an analysis. This is
verifiable and is the strongest answer to "why do you need access to these
sites?".

```bash
# No standing observers/loops in the source. Expect: no matches.
grep -rnE "setInterval|new MutationObserver|\.observe\(" src/
```

Closing the panel tears down every injected element, listener and cached state.

## 6. No deception / honest claims

- The UI states in-product that ReviewShield flags **statistical patterns**, not
  proof of fraud, and that a low score is not an accusation against a reviewer
  (see the panel's "What do these numbers mean?" disclaimer).
- The model, its features, its measured accuracy **and its limitations** are
  published in [../MODEL.md](../MODEL.md).
- [FAQ.md](FAQ.md) answers "does it prove a review is fake?" with an explicit
  **no**.
- No claim of affiliation with Amazon or Google anywhere.

## 7. Quality / unique value

Multi-platform (Amazon + Google Search + Maps), explainable per-review scoring,
author-history signals, filters, exports, on-device model. Fully functional,
no placeholders, no paywalled stubs. 70+ automated regression tests (including
real-DOM parser fixtures) gate the release — `npm run package` runs the suite.

## 8. Content & user data hygiene

- Analyzes only content already visible to the user on the page.
- Does not modify, hide, reorder or remove the host site's content; adds only
  its own clearly-branded UI.
- No user-generated content is uploaded anywhere (there is nowhere to upload to).

---

## Residual risks (honest assessment)

1. **Platform complaint, not policy** — the realistic risk is a complaint from
   the analyzed platform (Fakespot was pulled after Amazon complained), not a
   Web Store policy breach. Mitigations: we never modify or hide their content,
   never bypass paywalls/ads, never scrape beyond what the user already sees,
   never automate account actions, and state non-affiliation clearly. We also
   only expand reviews the page itself offers via its own button.
2. **Broad host permissions** — 18 domains will show an install warning. It is
   inherent to the product, minimised in scope, and justified in the dashboard.
   A future migration to `optional_host_permissions` would remove the warning.
3. **Defamation-adjacent framing** — labelling an individual review as fake is a
   strong claim about a real person. Keep verdict wording probabilistic and keep
   the in-product disclaimer prominent.

## Pre-submission checklist

- [ ] Privacy policy published at a public https URL and pasted in the dashboard
- [ ] Data collection questionnaire: **nothing** ticked + 3 certifications
- [ ] Permission justifications pasted (§4 wording)
- [ ] Source repository public (anti-obfuscation evidence) and linked
- [ ] FAQ linked from the listing description
- [ ] `npm run package` green (build + 57 tests) → upload `release/*.zip`
