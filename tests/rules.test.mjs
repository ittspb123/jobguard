import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, mergeAI, findLookalike, redactPII, detectClaimedBrand } from "../rules/rules.js";
import { validateAI } from "../backend/lambda/index.mjs";
import { loadDemo } from "./helpers.mjs";

const base = { domain: "example.com", path: "/", title: "", headings: "", text: "", emails: [], links: [], sensitiveFields: [] };
const ids = (r) => r.reasons.map((x) => x.id);

// ---------- demo pages: the end-to-end story ----------

test("legit posting is green", () => {
  const r = analyze(loadDemo("legit-posting.html", "kestrelanalytics.com"));
  assert.equal(r.level, "green", JSON.stringify(r.reasons));
});

test("fake posting is red, flags its lookalike link", () => {
  const r = analyze(loadDemo("fake-posting.html", "deloitte-careers-portal.com"));
  assert.equal(r.level, "red");
  for (const id of ["brand_mismatch", "lookalike_domain", "payment_scam", "off_platform_chat", "free_email", "urgency", "unrealistic_pay", "suspicious_links"]) {
    assert.ok(ids(r).includes(id), `missing ${id}`);
  }
  assert.deepEqual(r.badLinks, ["de1oitte-careers.example"]);
  assert.equal(r.officialSite, "deloitte.com");
});

test("fake onboarding form is red and detects sensitive fields", () => {
  const f = loadDemo("fake-onboarding.html", "localhost");
  assert.deepEqual(new Set(f.sensitiveFields), new Set(["ssn", "dob", "routing", "bank_account", "id_upload"]));
  const r = analyze(f);
  assert.equal(r.level, "red");
  assert.ok(ids(r).includes("sensitive_fields"));
});

test("different scam wording is still caught (not scripted)", () => {
  const r = analyze(loadDemo("fake-variant.html", "amazon-logistics-partners.net"));
  assert.equal(r.level, "red");
  assert.ok(ids(r).includes("payment_scam"));
});

test("prompt-injection page is red on local rules alone, even if AI is fooled", () => {
  const local = analyze(loadDemo("injection-test.html", "globalstaff-solutions.com"));
  assert.equal(local.level, "red");
  const fooled = mergeAI(local, { risk: "low", reasons: [], confidence: 0.9 });
  assert.equal(fooled.level, "red", "a lying AI should not be able to clear strong local signals");
});

// ---------- false-positive guards ----------

test("real company on its own domain is not flagged for mismatch", () => {
  const r = analyze({ ...base, domain: "jobs.deloitte.com", title: "Deloitte Careers | Analyst", text: "Deloitte is hiring analysts. Apply on Deloitte careers." });
  assert.ok(!ids(r).includes("brand_mismatch"));
  assert.ok(!ids(r).includes("lookalike_domain"));
});

test("job boards may mention any company", () => {
  const r = analyze({ ...base, domain: "deloitte.wd1.myworkdayjobs.com", title: "Deloitte - Analyst", text: "Deloitte Deloitte job apply" });
  assert.equal(r.level, "green");
});

test("legit onboarding asking for SSN alone stays below red", () => {
  const r = analyze({ ...base, domain: "acme.wd5.myworkdayjobs.com", title: "Onboarding", sensitiveFields: ["ssn", "bank_account"] });
  assert.notEqual(r.level, "red");
});

test("passing mention of a company doesn't count as a claim", () => {
  assert.equal(detectClaimedBrand({ title: "My blog", text: "I once interviewed at Google." }), null);
});

// ---------- individual helpers ----------

test("lookalike detection", () => {
  assert.equal(findLookalike("de1oitte-careers.com")?.key, "deloitte");
  assert.equal(findLookalike("paypa1-hr.net")?.key, "paypal");
  assert.equal(findLookalike("deloite-jobs.com")?.key, "deloitte");
  assert.equal(findLookalike("deloitte.com"), null);
  assert.equal(findLookalike("s3.amazonaws.com"), null);
  assert.equal(findLookalike("kestrelanalytics.com"), null);
});

test("PII redaction keeps email domain, drops the rest", () => {
  const out = redactPII("Email jane.doe@gmail.com or call (704) 555-1234. SSN 123-45-6789, acct 123456789012");
  assert.ok(out.includes("[email]@gmail.com"));
  assert.ok(!out.includes("jane.doe"));
  assert.ok(!out.includes("555-1234"));
  assert.ok(!out.includes("123-45-6789"));
  assert.ok(!out.includes("123456789012"));
});

test("new domain adds points", () => {
  const r = analyze({ ...base, domainAgeDays: 4 });
  assert.ok(ids(r).includes("new_domain"));
});

test("AI output validation rejects junk and clamps values", () => {
  assert.equal(validateAI("not json"), null);
  assert.equal(validateAI('{"risk":"extreme"}'), null);
  const v = validateAI('Sure! {"risk":"high","reasons":["<b>a</b>","b","c","d"],"confidence":7}');
  assert.equal(v.risk, "high");
  assert.equal(v.reasons.length, 3);
  assert.equal(v.reasons[0], "a");
  assert.equal(v.confidence, 1);
});
