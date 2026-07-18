# ReviewShield — FAQ

Honest answers about what ReviewShield does, what it cannot do, and how it
handles your data. Publish this alongside the Store listing (and link it from
the listing's description) — it doubles as evidence of good faith for the
Chrome Web Store review.

---

## What exactly does ReviewShield do?

It reads the reviews already visible on the page you're on (Amazon product
pages, Google Search business panels, Google Maps places) and rates how likely
they are to be authentic, using a model that runs entirely on your device.

## Does it *prove* a review is fake?

**No — and we will never claim it does.** ReviewShield detects **statistical
patterns** that are commonly associated with paid or fake reviews: accounts with
a single review in their whole history, near-identical text across reviews,
bursts of reviews in a short window, walls of 5-star ratings with no middle
ground, marketing-style or AI-style writing.

Those are **signals, not proof**. A genuine, enthusiastic first-time reviewer
can trip several of them. A skilfully written paid review can trip none. A low
score means *"read this more carefully"*, never *"this person is a liar"*.

We deliberately show the reasons behind every score so you can judge for
yourself instead of trusting a black box.

## Is it accurate?

Text-only fake-review detection has a low ceiling — a paid review written by a
real human reads like a real review. ReviewShield's strongest signals are
behavioural (reviewer history, duplication, timing), not linguistic. We publish
our model, its features and its measured accuracy openly in
[docs/MODEL.md](../MODEL.md), including its limitations.

Treat ReviewShield as a smoke detector, not a court verdict.

## What data do you collect?

**None.** Zero. No personal data, no browsing history, no analytics, no
telemetry, no account, no tracking. ReviewShield makes **no network requests at
all** — the entire analysis happens in your browser.

You can verify this in 30 seconds: open DevTools → Network, run an analysis, and
watch nothing leave your machine. Our [privacy policy](privacy-policy.html)
states this explicitly, and the source code is public and unobfuscated.

## Then what is stored on my computer?

Only two things, both local and both erasable at any time from Settings:

- **Your preferences** (sensitivity, theme, which sites are enabled). These use
  `chrome.storage.sync`, so *your own browser* may sync them across *your own*
  devices via your Google account — that's Chrome's sync, not us. They contain
  no browsing data.
- **A local history of your scans** (page title, URL, score, date) so the popup
  can show recent analyses. `chrome.storage.local`, pruned automatically.

## Why does it need access to Amazon and Google pages?

To read the reviews on those pages and draw the panel — that's the whole
product. The content script is **idle by default**: it does nothing at all until
you click *Analyze*, use the right-click menu, or press Alt+Shift+A. Closing the
panel removes every injected element and restores the page.

## Does it slow down my browsing?

No. Since it stays idle until you ask, there is no background CPU use, no
observers and no timers running while you browse.

## Does it change or hide anything on Amazon/Google?

It adds a score badge next to each review and a floating panel while an analysis
is active. It never hides, alters, reorders or removes the site's own content,
never injects ads or affiliate links, and never interferes with the site's
functionality. Close the panel and the page is exactly as it was.

## Is this affiliated with Amazon or Google?

No. ReviewShield is an independent tool and is not affiliated with, endorsed by
or sponsored by Amazon or Google. All trademarks belong to their owners.

## Is it free? What's the catch?

It's free and there is no catch: no ads, no data sales, no upsell — because
there's no data to monetise and no server to pay for.

## Can I read the code?

Yes. The source is public and not obfuscated (we minify for size, which Chrome
allows, but never obfuscate). Every claim in this FAQ is verifiable in the code.
