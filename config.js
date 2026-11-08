// JobGuard configuration.
//
// API_URL: the backend that runs the AI check and the domain-age lookup.
//   - ""                          → local-only (rules run in the browser, nothing is sent anywhere)
//   - "http://localhost:8787/analyze"  → the dev server in backend/dev-server.mjs (mock AI)
//   - "https://<id>.lambda-url.us-east-1.on.aws/analyze" → your deployed AWS Lambda
//
// If you deploy to a region other than us-east-1, update the matching
// host_permissions entry in manifest.json too.
export const API_URL = "https://w4ntzidkrni6krzlvaodd5g7ae0gjvuu.lambda-url.us-east-2.on.aws/analyze";

// How long to wait for the backend before falling back to local rules.
export const API_TIMEOUT_MS = 8000;

// Score thresholds (0–100).
export const THRESHOLDS = { yellow: 30, red: 60 };
