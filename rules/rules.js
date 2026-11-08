// JobGuard local detection rules.
// Pure functions with no browser APIs, so they run in the extension's service
// worker AND in Node for tests (`npm test`) and the EMSCAD evaluation.

import { BRANDS, JOB_BOARDS, SAFE_INFRA, FREE_EMAIL } from "./brands.js";

export const DEFAULT_THRESHOLDS = { yellow: 30, red: 60 };

// ---------- domain helpers ----------

export function hostMatches(host, domain) {
  host = (host || "").toLowerCase();
  return host === domain || host.endsWith("." + domain);
}

export function isJobBoard(host) {
  return JOB_BOARDS.some((d) => hostMatches(host, d));
}

function isSafeInfra(host) {
  return SAFE_INFRA.some((d) => hostMatches(host, d));
}

function isOfficialFor(host, brand) {
  return brand.domains.some((d) => hostMatches(host, d));
}

function isOfficialForAnyBrand(host) {
  return BRANDS.some((b) => isOfficialFor(host, b));
}

// Undo common character swaps scammers use: de1oitte → deloitte, paypa1 → paypal.
export function normalizeLeet(s) {
  return s
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/rn/g, "m")
    .replace(/vv/g, "w");
}

export function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

// Returns the brand a domain is imitating, or null.
export function findLookalike(host) {
  host = (host || "").toLowerCase();
  if (!host || isSafeInfra(host) || isJobBoard(host) || isOfficialForAnyBrand(host)) return null;
  // Strip IDN-safe check: punycode hosts (xn--) are suspicious on their own when paired with a brand.
  const labels = host.split(".").slice(0, -1); // drop TLD
  const joined = normalizeLeet(labels.join("").replace(/-/g, ""));
  for (const brand of BRANDS) {
    if (brand.key.length < 4) continue;
    if (joined.includes(brand.key)) return brand;
    for (const label of labels) {
      const parts = normalizeLeet(label).split("-");
      for (const part of parts) {
        if (part.length >= 5 && brand.key.length >= 5 && levenshtein(part, brand.key) === 1) return brand;
      }
    }
  }
  return null;
}

// Which company does the page claim to be? Requires the name in the title /
// main heading, or repeated in the body, to avoid matching passing mentions.
export function detectClaimedBrand({ title = "", headings = "", text = "" }) {
  const top = `${title}\n${headings}`;
  const body = text.slice(0, 8000);
  let best = null;
  let bestScore = 0;
  for (const brand of BRANDS) {
    let score = 0;
    for (const name of brand.names) {
      const re = new RegExp(`(^|[^A-Za-z])${escapeRe(name)}(?![A-Za-z])`, "g");
      if (re.test(top)) score += 5;
      const bodyHits = (body.match(re) || []).length;
      score += Math.min(bodyHits, 5);
    }
    if (score > bestScore) {
      best = brand;
      bestScore = score;
    }
  }
  return bestScore >= 3 ? best : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- text helpers ----------

const JOB_WORDS = /\b(job|jobs|hiring|hire|hired|position|recruit(er|ing)?|career|careers|apply|applicant|salary|internship|intern|offer letter|onboarding|resume|interview|employment|remote work|work from home)\b/gi;

export function looksJobRelated(features) {
  if (isJobBoard(features.domain)) return true;
  const sample = `${features.title || ""} ${(features.text || "").slice(0, 6000)}`;
  return (sample.match(JOB_WORDS) || []).length >= 3;
}

// Remove personal info before anything leaves the browser.
// Email local-parts are dropped but the domain is kept (it's a useful signal).
export function redactPII(text = "") {
  return text
    .replace(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi, "[email]@$1")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[number]")
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\b\d{8,}\b/g, "[number]");
}

// ---------- the rules ----------
// Each rule returns null or { id, points, text } — text is shown to the user,
// so it must be plain language a non-technical student understands.

const RULES = [
  function brandMismatch(f, ctx) {
    if (!ctx.claimed || isJobBoard(f.domain)) return null;
    if (isOfficialFor(f.domain, ctx.claimed)) return null;
    const official = ctx.claimed.domains[0];
    return {
      id: "brand_mismatch",
      points: 30,
      text: `This page says it's ${ctx.claimed.names[0]}, but it isn't on ${ctx.claimed.names[0]}'s real website (${official}).`
    };
  },

  function lookalikeDomain(f) {
    const brand = findLookalike(f.domain);
    if (!brand) return null;
    return {
      id: "lookalike_domain",
      points: 30,
      text: `The web address "${f.domain}" is made to look like ${brand.names[0]}'s, but it isn't theirs.`
    };
  },

  function sensitiveFields(f) {
    const types = new Set(f.sensitiveFields || []);
    const high = ["ssn", "bank_account", "routing", "card"].filter((t) => types.has(t));
    if (!high.length && !types.has("id_upload") && !types.has("dob")) return null;
    const labels = {
      ssn: "Social Security number",
      bank_account: "bank account number",
      routing: "routing number",
      card: "credit/debit card",
      id_upload: "photo of your ID",
      dob: "date of birth"
    };
    const asked = [...types].map((t) => labels[t]).filter(Boolean);
    let points = high.length ? 25 : types.has("id_upload") ? 15 : 10;
    if (types.size >= 2) points += 10;
    return {
      id: "sensitive_fields",
      points,
      text: `It asks for your ${joinList(asked)}. Real employers collect this only after a signed offer, through HR.`
    };
  },

  function paymentScam(f) {
    const t = f.text || "";
    const patterns = [
      [/\b(purchase|buy|order)\b[^.]{0,60}\b(equipment|laptop|computer|software|supplies|starter kit)\b/i, "asks you to buy equipment or supplies"],
      [/\b(equipment|laptop|supplies)\b[^.]{0,60}\breimburs/i, "promises to reimburse you for equipment"],
      [/\b(deposit|cash)\b[^.]{0,40}\b(check|cheque)\b|\bcashier'?s check\b/i, "involves depositing a check they send you"],
      [/\bgift ?cards?\b/i, "mentions paying with gift cards"],
      [/\b(bitcoin|btc|usdt|crypto(currency)?)\b[^.]{0,60}\b(pay|send|deposit|wallet|transfer)\b|\b(pay|send|deposit|transfer)\b[^.]{0,60}\b(bitcoin|btc|usdt|crypto)/i, "involves sending cryptocurrency"],
      [/\b(training|registration|application|onboarding|background check) fee\b/i, "charges you a fee to get the job"],
      [/\b(wire|zelle|cash ?app|venmo)\b[^.]{0,40}\b(money|funds|payment|transfer)\b/i, "asks you to move money for them"]
    ];
    for (const [re, why] of patterns) {
      if (re.test(t)) {
        return { id: "payment_scam", points: 25, text: `It ${why}. Real jobs never ask you to pay or move money.` };
      }
    }
    return null;
  },

  function offPlatformChat(f) {
    const m = (f.text || "").match(/\b(telegram|whatsapp|signal app|signal messenger|google hangouts|wickr|kik)\b/i);
    if (!m) return null;
    return {
      id: "off_platform_chat",
      points: 20,
      text: `It moves the interview or contact to ${capitalize(m[1])}. Real recruiters interview by phone or video call through company accounts.`
    };
  },

  function freeEmailRecruiter(f) {
    const domains = new Set((f.emails || []).map((e) => e.split("@")[1]?.toLowerCase()).filter(Boolean));
    const free = [...domains].find((d) => FREE_EMAIL.includes(d));
    if (!free) return null;
    return {
      id: "free_email",
      points: 15,
      text: `The contact email uses ${free}, not a company address.`
    };
  },

  function urgencyPressure(f) {
    const m = (f.text || "").match(/\b(no interview( needed| required)?|hired (immediately|on the spot|today)|immediate (start|hire)|start (today|immediately)|act (fast|now)|limited (slots|spots|positions)|within 24 hours|respond (asap|immediately)|guaranteed (job|income|position))\b/i);
    if (!m) return null;
    return {
      id: "urgency",
      points: 15,
      text: `It pressures you to move fast ("${m[0]}"). Scammers rush you so you don't stop to check.`
    };
  },

  function unrealisticPay(f) {
    const t = f.text || "";
    const easyRole = /\b(entry[\s-]level|no experience|part[\s-]time|students?|data entry|work from home|flexible hours)\b/i.test(t);
    if (!easyRole) return null;
    const hourly = [...t.matchAll(/\$\s?(\d{2,3})(?:\.\d{2})?\s*(?:\/|per|an?)\s*(?:hr|hour)\b/gi)].map((m) => +m[1]);
    const weekly = [...t.matchAll(/\$\s?(\d{1,2},?\d{3})\s*(?:\/|per|a)\s*week\b/gi)].map((m) => +m[1].replace(",", ""));
    const maxHourly = Math.max(0, ...hourly);
    const maxWeekly = Math.max(0, ...weekly);
    if (maxHourly >= 40 || maxWeekly >= 1500) {
      const shown = maxHourly >= 40 ? `$${maxHourly}/hour` : `$${maxWeekly.toLocaleString()}/week`;
      return {
        id: "unrealistic_pay",
        points: 10,
        text: `It offers ${shown} for an entry-level or part-time role, which is unusually high.`
      };
    }
    return null;
  },

  function suspiciousLinks(f) {
    const bad = (f.links || []).map((h) => ({ host: h, brand: findLookalike(h) })).filter((x) => x.brand);
    if (!bad.length) return null;
    return {
      id: "suspicious_links",
      points: 20,
      text: `It links to "${bad[0].host}", which imitates ${bad[0].brand.names[0]}'s website.`
    };
  },

  function newDomain(f) {
    if (typeof f.domainAgeDays !== "number" || f.domainAgeDays >= 30) return null;
    return {
      id: "new_domain",
      points: 20,
      text: `This website was created only ${f.domainAgeDays} day${f.domainAgeDays === 1 ? "" : "s"} ago. Scam sites are usually brand new.`
    };
  }
];

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function levelFor(score, thresholds = DEFAULT_THRESHOLDS) {
  if (score >= thresholds.red) return "red";
  if (score >= thresholds.yellow) return "yellow";
  return "green";
}

// features: { domain, title, headings, text, emails[], links[] (outbound hosts),
//             sensitiveFields[], domainAgeDays? }
export function analyze(features, thresholds = DEFAULT_THRESHOLDS) {
  const ctx = { claimed: detectClaimedBrand(features) };
  const reasons = [];
  for (const rule of RULES) {
    try {
      const r = rule(features, ctx);
      if (r) reasons.push({ ...r, source: "rule" });
    } catch (e) {
      // A broken rule should never break the whole check.
    }
  }
  reasons.sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  return {
    score,
    level: levelFor(score, thresholds),
    reasons,
    claimedCompany: ctx.claimed ? ctx.claimed.names[0] : null,
    officialSite: ctx.claimed ? ctx.claimed.domains[0] : null,
    badLinks: (features.links || []).filter((h) => findLookalike(h)),
    jobRelated: looksJobRelated(features)
  };
}

// Merge the backend's AI verdict into the local result.
export function mergeAI(local, ai, thresholds = DEFAULT_THRESHOLDS) {
  if (!ai || !["low", "medium", "high"].includes(ai.risk)) return local;
  const delta = { low: -10, medium: 10, high: 35 }[ai.risk];
  const aiReasons = (ai.reasons || []).slice(0, 3).map((text, i) => ({
    id: `ai_${i}`,
    points: i === 0 ? delta : 0,
    text: String(text).slice(0, 200),
    source: "ai"
  }));
  const score = Math.max(0, Math.min(100, local.score + delta));
  return {
    ...local,
    score,
    level: levelFor(score, thresholds),
    reasons: [...local.reasons, ...(ai.risk === "low" ? [] : aiReasons)],
    ai: { risk: ai.risk, confidence: ai.confidence ?? null }
  };
}
