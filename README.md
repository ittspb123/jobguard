# JobGuard

A Chrome extension that spots **fake job and internship scams** and warns students before they hand over their SSN or bank details. Built at CrownHacks 2026 (Guardian Tools track).

It reads a job posting, checks it with 10 local rules plus an AI model, and shows a calm warning that explains, in plain English, what's wrong.

## How it works

```
Job page → reads text, links, and form-field LABELS (never what you type)
         → 10 local rules score it instantly, on-device
         → job-related pages also get an AI check (AWS Lambda + Amazon Bedrock),
           with emails and phone numbers stripped out first
         → green (quiet) · yellow (caution) · red (blocking warning)
```

The red warning only appears at the moment of risk — when a scam page asks for your SSN, bank, or ID. Each reason is tagged **Rule** or **AI**.

## Quick start

1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → select this folder.
2. Backend with a mock AI (no AWS needed): `npm run dev-server`
3. Demo pages: `npm run demo-pages` → open http://localhost:8000
4. On a demo page, click the JobGuard icon → **Check this page**.

Run the tests: `npm test`

## Privacy & permissions

- **Never reads what you type** — only field labels.
- Checks **job sites only** by default; "check every page" is opt-in.
- Posting text is sent to the backend with personal info removed, and is never stored. **Local-only mode** keeps everything on-device.
- No remote code, minimal permissions (Manifest V3).

## Threat model

**Catches:** fake postings, sites impersonating real companies, lookalike domains, fake onboarding forms, and equipment/check/crypto scams.

**Doesn't catch:** scams only over text/phone/email, or a real company's hacked account.

**Resists prompt injection:** a scam page can't talk the AI into clearing it — the AI alone can only raise a caution, and a red block always needs the rules to agree.

## Project layout

```
manifest.json      permissions
background/         scoring, backend call, badge
content/            page reading, field detection, warnings
rules/              10 local rules + brand list
popup/, onboarding/ verdict view, settings, privacy disclosure
backend/            AWS Lambda (RDAP + Bedrock) + local dev server
demo-pages/         fictional pages for the demo
tests/              unit tests + dataset evaluation
```

Full AWS deploy steps are in [`backend/lambda/index.mjs`](backend/lambda/index.mjs).

## License

MIT
