// Builds the same "features" object the content script produces, from raw HTML,
// so tests can run the demo pages through the real rules without a browser.
import { readFileSync } from "node:fs";

export function featuresFromHtml(html, domain = "localhost") {
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => strip(m[1])).join("\n");
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
  const text = strip(body.replace(/<!--[\s\S]*?-->/g, ""));
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const links = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map((m) => new URL(m[1]).hostname);

  // Mirror the content script's label-based field classification.
  const sensitive = new Set();
  const labelText = [...html.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)].map((m) => m[1]).join(" ");
  const fieldAttrs = [...html.matchAll(/<input[^>]*>/gi)].map((m) => m[0]).join(" ");
  const all = `${labelText} ${fieldAttrs}`;
  if (/social security|\bssn\b/i.test(all)) sensitive.add("ssn");
  if (/routing/i.test(all)) sensitive.add("routing");
  if (/account[\s_-]*number|checking account/i.test(all)) sensitive.add("bank_account");
  if (/date of birth|\bdob\b/i.test(all)) sensitive.add("dob");
  if (/type="file"/i.test(fieldAttrs) && /driver|license|passport/i.test(all)) sensitive.add("id_upload");

  return { domain, path: "/", title, headings, text, emails, links, sensitiveFields: [...sensitive] };
}

function strip(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function loadDemo(name, domain) {
  const html = readFileSync(new URL(`../demo-pages/${name}`, import.meta.url), "utf8");
  return featuresFromHtml(html, domain);
}
