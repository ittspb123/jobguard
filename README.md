# JobGuard

A Chrome extension that protects students from fake job postings and scam "onboarding" forms. It checks job pages as you browse and explains in plain language when something isn't right, before you hand over your SSN or bank info.

Built at CrownHacks 2026 (Guardian Tools & Usable Security track).

## How it works

```
Job page ──► content script reads page text, links, and form-field LABELS (never what you type)
         ──► service worker runs local rules (instant, on-device)
         ──► if the page is job-related and local-only mode is off:
               backend gets domain + posting text with emails/phones/numbers removed
               → domain age (RDAP) + AI check (Amazon Bedrock), returns strict JSON
         ──► risk score 0–100 → green / yellow / red, each reason tagged "Rule" or "AI"
```

| Level | Score | What the user sees |
|---|---|---|
| Green | 0–29 | Only "OK" on the toolbar icon. Nothing on the page. |
| Yellow | 30–59 | Small dismissible banner with up to 3 reasons. |
| Red | 60+ | Banner, plus a blocking warning **only** when the user focuses an SSN/bank/card/ID field or clicks a lookalike link. |

If the backend is down or slow (3-second timeout), the local rules still work.

## Quick start (2 minutes)

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select this folder.
2. Start the dev backend (mock AI, no AWS needed): `npm run dev-server`
3. Serve the demo pages: `npm run demo-pages` → open http://localhost:8000
4. On a demo page, click the JobGuard icon → **Check this page**.

Run the tests: `npm test` (Node 20+, no dependencies to install).

To run with no backend at all, set `API_URL = ""` in `config.js`.

## Demo script

| Step | Page | Expected |
|---|---|---|
| 1 | `legit-posting.html` | Green, nothing pops up |
| 2 | `fake-posting.html` | Red banner with reasons; clicking "Start onboarding" shows the lookalike-link warning |
| 3 | `fake-onboarding.html` | Click the SSN field → blocking warning before anything is typed |
| 4 | `fake-variant.html` | Different scam, different words, still caught |
| 5 | `injection-test.html` | Page hides text telling the AI to say "safe"; still red |
| 6 | any warning | "I trust this site" clears it (false-positive recovery) |

## Deploying the backend to AWS

1. **Bedrock:** in the Bedrock console, enable access to a small, fast model and copy its model ID (or inference profile ID).
2. **Lambda:** create a function, runtime Node.js 20.x or newer. Upload `backend/lambda/index.mjs` (handler: `index.handler`). Timeout: 5 seconds.
3. **Environment variable:** `BEDROCK_MODEL_ID=<the ID from step 1>`. (Or `AI_MODE=mock` to demo without Bedrock.)
4. **IAM:** add `bedrock:InvokeModel` on that model to the function's role. Nothing else.
5. **Function URL:** enable it (auth type NONE), then set **Reserved concurrency** to about 5 to cap abuse and cost.
6. In `config.js`, set `API_URL` to `https://<id>.lambda-url.<region>.on.aws/analyze`. If your region isn't `us-east-1`, update the matching entry in `manifest.json`.

## Permissions and why

| Permission | Why |
|---|---|
| Host access to LinkedIn Jobs, Handshake, Indeed, Greenhouse, Lever, Workday | Check job postings automatically where students actually apply. |
| `activeTab` + `scripting` | "Check this page" button: access to one tab, only when the user clicks. |
| `storage` | Settings, trusted sites, mistake reports, all on-device. |
| Lambda Function URL / `localhost:8787` | Talk to our own backend. (Remove the localhost entry before publishing.) |
| `<all_urls>` (**optional**, off by default) | Only if the user turns on "Check every page." Chrome asks them first. Catches scam sites reached from a link. |

## Data handling

| Data | Handling |
|---|---|
| What the user types | Never read. Fields are classified by their labels only. |
| Posting text + domain | Sent to our backend for job-related pages only, after PII redaction (twice: in the extension and on the server). Not stored or logged. |
| Browsing history | Never collected. |
| Trusted sites, settings, reports | `chrome.storage.local`, never leave the device. |
| Local-only mode | Nothing leaves the device at all. |

**Our attack surface:** if the backend were compromised, an attacker would see redacted job posting text, with no personal data. The extension loads no remote code (Manifest V3). The AI's output is schema-validated and can't inject HTML into the page (reasons are rendered as text). A key baked into an extension isn't a secret, so we rely on reserved concurrency and input limits for abuse control instead.

## Threat model

**Stops or reduces:** fake job postings, websites impersonating real employers (brand mismatch, lookalike domains like `de1oitte-careers`), fake onboarding forms harvesting SSN/bank/ID, equipment and fake-check scams, crypto/gift-card payment requests, chat-app "interviews."

**Does NOT cover:** scams that happen only over text, email or phone; a real company's account that was hacked; anything after the user leaves the browser; non-English pages.

**How attackers could evade it, and our answer:**
- Hosting the scam on a legit platform (Google Forms, a job board): domain checks don't fire, but content rules, sensitive-field detection and the AI still do.
- Aged domains: the domain-age signal is lost, but it's only one of ten signals.
- Hidden text telling the AI the page is safe: the prompt treats page text as untrusted, and a "low" AI verdict can only subtract 10 points, so strong local signals still win (see `injection-test.html`).
- Image-only postings: not covered (known gap).

## Accessibility

- Every alert uses an icon **and** a word (✓ Safe, ! Caution, ✕ Stop), never color alone.
- Banners announce through an ARIA live region; the blocking warning is an `alertdialog`.
- Full keyboard support: Tab stays inside the warning, Esc closes it, visible focus outlines.
- Plain-language reasons written for non-technical students. Respects reduced-motion settings.

## Testing

- `npm test`: 13 tests covering every demo page, false-positive guards (real company domains, job boards, legit onboarding), lookalike detection, PII redaction and AI-output validation.
- `npm run eval -- path/to/fake_job_postings.csv`: precision/recall of the text rules on a balanced sample of the labeled EMSCAD dataset (Kaggle, "Real / Fake Job Posting Prediction"). Text-only and from 2012–2014, so it tests language rules only.
- Real-site false-positive check: browse real postings on LinkedIn, Handshake, Indeed, Greenhouse and Lever; record any non-green result.

## Project layout

```
manifest.json            least-privilege permissions
config.js                backend URL, timeout, thresholds
background/              service worker: scoring, backend call, badge, settings
content/content.js       extraction, field detection, Shadow DOM warnings
rules/                   local rules (pure JS, also run in Node tests) + brand list
popup/, onboarding/      verdict view, settings, privacy disclosure
backend/lambda/          AWS Lambda handler (RDAP + Bedrock)
backend/dev-server.mjs   same handler on localhost with mock AI
demo-pages/              fictional pages for the demo
tests/                   unit tests + EMSCAD evaluation
scripts/package.mjs      zips the extension for the Web Store (`npm run package`)
```

## Known limitations

- Brand list is hand-curated (`rules/brands.js`); impersonation of companies not on it is caught only by content rules and the AI.
- Registrable-domain detection is naive (last two labels), so `.co.uk`-style domains get approximate domain ages.
- Single-page job sites are re-checked on URL change; very dynamic pages may need "Check this page."

## License

MIT
