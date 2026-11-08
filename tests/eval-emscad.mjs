// Measures JobGuard on a labeled job-posting dataset (EMSCAD format: the
// "Real / Fake Job Posting Prediction" and "Recruitment Scam" datasets on Kaggle).
//
//   npm run eval -- path/to/file.csv                     local rules only (50 fake + 50 real)
//   npm run eval -- path/to/file.csv --n 100             100 fake + 100 real
//   npm run eval -- path/to/file.csv --api <backend URL> local rules AND the real AI, side by side
//   npm run eval -- path/to/file.csv --threshold 15      change the "flag it" score
//
// Caveat to state in the pitch: these datasets are text-only, so this tests the
// language rules and AI only — not domains, links or form fields.

import { readFileSync } from "node:fs";
import { analyze, mergeAI, redactPII } from "../rules/rules.js";

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("--") && !(args[i - 1] || "").startsWith("--"));
const n = Number(argValue("--n") || 50);
const threshold = Number(argValue("--threshold") || 30);
const api = argValue("--api");
if (!file) {
  console.error("Usage: npm run eval -- path/to/file.csv [--n 50] [--threshold 30] [--api https://.../analyze]");
  process.exit(1);
}

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

// RFC 4180 CSV parser (handles quoted fields with commas and newlines).
function parseCSV(src) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Seeded shuffle so the team gets the same sample every run.
function shuffle(arr, seed = 42) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const j = seed % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Datasets label scams as 1/0 or t/f depending on the version.
const isFakeLabel = (v) => ["1", "t", "true", "yes"].includes(String(v).trim().toLowerCase());
const isRealLabel = (v) => ["0", "f", "false", "no"].includes(String(v).trim().toLowerCase());

const [rawHeader, ...data] = parseCSV(readFileSync(file, "utf8")).filter((r) => r.length > 1);
const header = rawHeader.map((h) => h.trim().replace(/^﻿/, "").toLowerCase());
const col = (name) => header.indexOf(name);
const textCols = ["title", "company_profile", "description", "requirements", "benefits"].map(col).filter((i) => i >= 0);
const labelCol = col("fraudulent");
if (labelCol < 0 || !textCols.length) {
  console.error(`Couldn't find the expected columns. Found: ${header.join(", ")}`);
  process.exit(1);
}

const fakes = shuffle(data.filter((r) => isFakeLabel(r[labelCol]))).slice(0, n);
const reals = shuffle(data.filter((r) => isRealLabel(r[labelCol]))).slice(0, n);

async function askAI(text) {
  try {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "apply.workable.com", text: redactPII(text).slice(0, 6000) }),
      signal: AbortSignal.timeout(15000)
    });
    return res.ok ? (await res.json()).ai : null;
  } catch {
    return null;
  }
}

const tally = () => ({ tp: 0, fn: 0, fp: 0, tn: 0 });
const scores = { rules: tally(), combined: tally() };
const ruleHits = {};
let aiFailures = 0;
const aiVerdicts = { fake: { low: 0, medium: 0, high: 0 }, real: { low: 0, medium: 0, high: 0 } };
let done = 0;
const total = fakes.length + reals.length;

function count(t, isFake, flagged) {
  if (isFake && flagged) t.tp++;
  else if (isFake) t.fn++;
  else if (flagged) t.fp++;
  else t.tn++;
}

for (const [rows, isFake] of [[fakes, true], [reals, false]]) {
  for (const r of rows) {
    const text = textCols.map((i) => r[i] || "").join("\n");
    const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    const local = analyze({ domain: "apply.workable.com", path: "/", title: r[col("title")] || "", headings: "", text, emails, links: [], sensitiveFields: [] });
    count(scores.rules, isFake, local.score >= threshold);
    for (const reason of local.reasons) {
      ruleHits[reason.id] ??= { fake: 0, real: 0 };
      ruleHits[reason.id][isFake ? "fake" : "real"]++;
    }
    if (api) {
      const ai = await askAI(text);
      if (!ai) aiFailures++;
      else aiVerdicts[isFake ? "fake" : "real"][ai.risk]++;
      count(scores.combined, isFake, mergeAI(local, ai).score >= threshold);
      process.stdout.write(`\r  checked ${++done}/${total} with AI…`);
    }
  }
}
if (api) process.stdout.write("\n");

const pct = (x) => `${(x * 100).toFixed(1)}%`;
function report(label, t) {
  console.log(`\n${label}`);
  console.log(`  Caught scams (recall):     ${t.tp}/${t.tp + t.fn}  ${pct(t.tp / (t.tp + t.fn || 1))}`);
  console.log(`  Precision:                 ${t.tp}/${t.tp + t.fp}  ${pct(t.tp / (t.tp + t.fp || 1))}`);
  console.log(`  False alarms on real jobs: ${t.fp}/${t.fp + t.tn}  ${pct(t.fp / (t.fp + t.tn || 1))}`);
}

console.log(`\nJobGuard on ${file.split(/[\\/]/).pop()} (${fakes.length} fake + ${reals.length} real, flag if score ≥ ${threshold})`);
report("Local rules only:", scores.rules);
if (api) {
  report("Local rules + AI:", scores.combined);
  if (aiFailures) console.log(`  (AI unavailable for ${aiFailures} postings; those used rules only)`);
  console.log(`\nWhat the AI said on its own (low / medium / high):`);
  console.log(`  Fake postings: ${aiVerdicts.fake.low} / ${aiVerdicts.fake.medium} / ${aiVerdicts.fake.high}`);
  console.log(`  Real postings: ${aiVerdicts.real.low} / ${aiVerdicts.real.medium} / ${aiVerdicts.real.high}`);
}
console.log(`\nWhich rules fired (fake / real):`);
for (const [id, c] of Object.entries(ruleHits).sort((a, b) => b[1].fake - a[1].fake)) {
  console.log(`  ${id.padEnd(20)} ${String(c.fake).padStart(4)} / ${c.real}`);
}
console.log(`\nNote: text-only data, so domain, link and form-field rules can't fire here.`);
