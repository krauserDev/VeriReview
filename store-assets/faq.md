# VeriReview — FAQ

**Does VeriReview send my data anywhere?**
No. All analysis runs locally in your browser. The extension makes zero network requests. See the privacy policy for details.

**What does the Trust Index mean?**
It is a 0–100 estimate of how trustworthy the review set on the current page looks, based on dozens of heuristic signals. 80+ means the reviews look largely genuine; below 40 means multiple strong warning signs were found. It is a probability-style indicator, not a verdict.

**A review I know is real was flagged. Is the extension broken?**
No — heuristics produce occasional false positives. Short reviews with generic praise ("Great product, love it!") share features with fake reviews even when they are genuine. That is exactly why VeriReview always shows *which* signals fired instead of just saying "fake": you can judge whether the reasons apply.

**Can it prove a review is fake?**
No tool can. VeriReview highlights statistical and linguistic patterns that are *more common* in manipulated reviews. Treat low scores as a reason to read carefully, not as proof of fraud, and never as grounds to accuse a specific reviewer.

**Which sites are supported?**
Amazon (com, co.uk, de, fr, es, it, ca) product pages and Google Maps/Search business reviews. The architecture is adapter-based, so more sites can be added in future versions.

**Why does the score change when I load more reviews?**
The extension can only analyze reviews present in the page. Loading more reviews gives it more data, which can raise the confidence level and shift the index. Use "Analysis depth: Deep" in options to process up to 400 reviews.

**Does it slow pages down?**
Analysis runs in small batches after the page settles and typically takes milliseconds. The UI lives in an isolated Shadow DOM, so it never interferes with the page's own styles or scripts.

**Does it work in incognito?**
Yes, if you enable "Allow in Incognito" for the extension in `chrome://extensions`. History is still stored in normal extension storage.

**How do I export a report?**
Open the panel → footer buttons: JSON, CSV, or PDF (opens a printable report; use your browser's "Save as PDF").

**Will there be AI-powered analysis?**
The codebase includes an optional provider abstraction (OpenAI, Claude, Gemini, Mistral, Ollama) that is currently disabled. If it ever ships, it will be strictly opt-in, clearly labeled, and off by default — local analysis will always remain the default.

**How do I delete my data?**
Options page → "Clear cache & history". Removing the extension also removes all its data.
