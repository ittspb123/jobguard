// JobGuard content script.
// Reads the page (never what the user types), asks the service worker for a
// verdict, and shows calm, well-timed warnings:
//   green  → nothing on the page (badge only)
//   yellow → small dismissible banner with reasons
//   red    → banner, PLUS a blocking warning only when the user focuses a
//            sensitive field (SSN, bank, card, ID) or clicks a lookalike link.

(() => {
  if (window.__jobguardLoaded) {
    window.__jobguardRun?.(true);
    return;
  }
  window.__jobguardLoaded = true;

  const SENSITIVE_PATTERNS = {
    ssn: /\b(ssn|social[\s_-]*security|socsec|soc[\s_-]*sec|itin|taxpayer[\s_-]*id)\b/i,
    bank_account: /\b(account[\s_-]*(number|num|no)|acct[\s_-]*(number|num|no)?|bank[\s_-]*account|iban|checking[\s_-]*account|savings[\s_-]*account)\b/i,
    routing: /\b(routing|aba[\s_-]*(number|no)?|sort[\s_-]*code|swift)\b/i,
    card: /\b(card[\s_-]*(number|num|no)|cc[\s_-]*(num|number)|cvv|cvc|security[\s_-]*code)\b/i,
    dob: /\b(date[\s_-]*of[\s_-]*birth|dob|birth[\s_-]*date|birthday)\b/i
  };
  const ID_UPLOAD = /\b(driver'?s?|license|licence|passport|state[\s_-]*id|government[\s_-]*id|photo[\s_-]*id|id[\s_-]*card|identification)\b/i;

  let lastResult = null;
  let lastUrl = location.href;
  let bannerDismissed = false;
  let modalAcknowledged = false;
  let scanTimer = null;
  let ui = null;

    let popupOpen = false;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "jobguard-popup") return;
    popupOpen = true;
    render();
    port.onDisconnect.addListener(() => {
      popupOpen = false;
      render();
    });
  });

  // ---------- feature extraction ----------

  function describeField(el) {
    const parts = [el.name, el.id, el.getAttribute("autocomplete"), el.placeholder, el.getAttribute("aria-label"), el.title];
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) parts.push(label.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) parts.push(wrap.textContent);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) labelledBy.split(/\s+/).forEach((id) => parts.push(document.getElementById(id)?.textContent));
    return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 300);
  }

  // Classifies a field by its LABELS only. Field values are never read.
  function classifyField(el) {
    const desc = describeField(el);
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (el.type === "file") return ID_UPLOAD.test(desc) ? "id_upload" : null;
    if (ac.startsWith("cc-")) return "card";
    if (ac === "bday") return "dob";
    for (const [type, re] of Object.entries(SENSITIVE_PATTERNS)) {
      if (re.test(desc)) return type;
    }
    return null;
  }

  function sensitiveFieldElements() {
    const out = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.type === "hidden" || el.closest("#jobguard-host")) return;
      const type = classifyField(el);
      if (type) out.push({ el, type });
    });
    return out;
  }

  function extractFeatures() {
    const text = (document.body?.innerText || "").replace(/\s+\n/g, "\n").slice(0, 15000);
    const headings = [...document.querySelectorAll("h1, h2")].slice(0, 6).map((h) => h.textContent.trim()).join("\n");
    const emails = new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
    const links = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      try {
        const u = new URL(a.href, location.href);
        if (u.protocol === "mailto:") emails.add(u.pathname);
        else if (/^https?:$/.test(u.protocol) && u.hostname !== location.hostname) links.add(u.hostname.toLowerCase());
      } catch {}
    });
    return {
      domain: location.hostname.toLowerCase(),
      path: location.pathname,
      title: document.title.slice(0, 200),
      headings: headings.slice(0, 1000),
      text,
      emails: [...emails].slice(0, 20),
      links: [...links].slice(0, 50),
      sensitiveFields: [...new Set(sensitiveFieldElements().map((f) => f.type))]
    };
  }

  // ---------- run ----------

  async function run(force = false) {
    const features = extractFeatures();
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "ANALYZE", features });
    } catch {
      return; // extension reloaded or worker unavailable
    }
    if (!result || result.error) return;
    if (force) bannerDismissed = false;
    lastResult = result;
    render();
    attachFieldGuards();
    attachLinkGuards();
  }
  window.__jobguardRun = run;

  // Single-page job sites (LinkedIn, Handshake) change URL without reloading.
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      bannerDismissed = false;
      modalAcknowledged = false;
      scheduleRun(800);
    }
  }, 1000);

  // New form fields can appear after load (multi-step application forms).
  const observer = new MutationObserver((mutations) => {
    const addedFields = mutations.some((m) =>
      [...m.addedNodes].some((n) => n.nodeType === 1 && !n.closest?.("#jobguard-host") && (n.matches?.("input, select, textarea") || n.querySelector?.("input, select, textarea")))
    );
    if (addedFields) scheduleRun(1200);
  });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });

  function scheduleRun(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => run(), delay);
  }

  // ---------- guards ----------

  function attachFieldGuards() {
    for (const { el } of sensitiveFieldElements()) {
      if (el.dataset.jobguardGuarded) continue;
      el.dataset.jobguardGuarded = "1";
      el.addEventListener("focus", onSensitiveFocus, true);
    }
  }

  function onSensitiveFocus(e) {
    if (!lastResult || lastResult.level !== "red" || modalAcknowledged) return;
    e.target.blur();
    showModal({
      heading: "Stop. This may be a job scam.",
      intro: "You're about to enter sensitive information on a page with several scam warning signs.",
      returnFocus: e.target
    });
  }

  function attachLinkGuards() {
    const bad = new Set(lastResult?.badLinks || []);
    if (!bad.size) return;
    document.querySelectorAll("a[href]").forEach((a) => {
      if (a.dataset.jobguardLink) return;
      let host;
      try { host = new URL(a.href, location.href).hostname.toLowerCase(); } catch { return; }
      if (!bad.has(host)) return;
      a.dataset.jobguardLink = "1";
      a.addEventListener("click", (e) => {
        if (a.dataset.jobguardAllowed) return;
        e.preventDefault();
        e.stopPropagation();
        showModal({
          heading: "Check this link before you go.",
          intro: `This link goes to "${host}", which is made to look like a real company's website.`,
          linkEl: a
        });
      }, true);
    });
  }

  // ---------- UI (Shadow DOM so job sites' CSS can't break it) ----------

  function ensureUI() {
    if (ui) return ui;
    const host = document.createElement("div");
    host.id = "jobguard-host";
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 0; height: 0;";
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${STYLES}</style><div class="live" role="status" aria-live="polite"></div><div class="banner-slot"></div><div class="modal-slot"></div>`;
    ui = {
      root,
      live: root.querySelector(".live"),
      bannerSlot: root.querySelector(".banner-slot"),
      modalSlot: root.querySelector(".modal-slot")
    };
    return ui;
  }

  function render() {
    const { bannerSlot, live } = ensureUI();
    bannerSlot.innerHTML = "";
    const r = lastResult;
        if (!r || bannerDismissed || popupOpen || !["yellow", "red"].includes(r.level)) return;

    const isRed = r.level === "red";
    const banner = el("section", { class: `banner ${isRed ? "danger" : "caution"}`, "aria-label": "JobGuard warning" });
    const icon = el("span", { class: "icon", "aria-hidden": "true" }, isRed ? "✕" : "!");
    const title = el("strong", {}, isRed ? "Likely scam. Be careful on this page." : `${r.reasons.length} thing${r.reasons.length === 1 ? "" : "s"} to double-check`);
    const head = el("div", { class: "head" }, icon, el("span", { class: "label" }, isRed ? "Stop:" : "Caution:"), title);
    const list = el("ul");
    r.reasons.slice(0, 3).forEach((reason) => list.appendChild(reasonItem(reason)));

    const actions = el("div", { class: "actions" });
    if (r.officialSite) {
      actions.appendChild(el("a", { class: "btn primary", href: `https://${r.officialSite}`, target: "_blank", rel: "noopener noreferrer" }, `Go to ${r.claimedCompany}'s real site`));
    }
    actions.appendChild(button("I trust this site", "btn", trustSite));
    actions.appendChild(button("Report a mistake", "btn link", reportMistake));
    actions.appendChild(button("Dismiss", "btn link", () => { bannerDismissed = true; render(); }));

    banner.append(head, list, actions);
    bannerSlot.appendChild(banner);
    live.textContent = `JobGuard ${isRed ? "stop" : "caution"}: ${r.reasons.map((x) => x.text).slice(0, 2).join(" ")}`;
  }

  function reasonItem(reason) {
    const tag = el("span", { class: `tag ${reason.source}` }, reason.source === "ai" ? "AI" : "Rule");
    return el("li", {}, tag, document.createTextNode(" " + reason.text));
  }

  function showModal({ heading, intro, returnFocus, linkEl }) {
    const { modalSlot, live } = ensureUI();
    modalSlot.innerHTML = "";
    const r = lastResult;
    const overlay = el("div", { class: "overlay" });
    const dialog = el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "jg-h", "aria-describedby": "jg-d" });
    const h = el("h2", { id: "jg-h" }, el("span", { class: "icon big", "aria-hidden": "true" }, "✕"), document.createTextNode(" " + heading));
    const d = el("p", { id: "jg-d" }, intro);
    const list = el("ul");
    (r?.reasons || []).slice(0, 3).forEach((reason) => list.appendChild(reasonItem(reason)));
    const todo = el("p", { class: "todo" }, el("strong", {}, "What to do: "),
      document.createTextNode(r?.officialSite
        ? `Find this job on ${r.claimedCompany}'s official careers page instead.`
        : "Don't enter personal or bank details. Verify the company on its official website first."));

    const close = () => {
      modalSlot.innerHTML = "";
      document.removeEventListener("keydown", onKey, true);
    };
    const leave = button("Leave this page", "btn primary", () => {
      close();
      if (history.length > 1) history.back();
      else location.href = "about:blank";
    });
    const proceed = button(linkEl ? "Open the link anyway" : "I understand, continue", "btn", () => {
      modalAcknowledged = true;
      close();
      if (linkEl) {
        linkEl.dataset.jobguardAllowed = "1";
        linkEl.click();
      } else returnFocus?.focus();
    });
    const trust = button("I trust this site", "btn link", () => { close(); trustSite(); });
    const actions = el("div", { class: "actions" }, leave, proceed, trust);

    dialog.append(h, d, list, todo, actions);
    overlay.appendChild(dialog);
    modalSlot.appendChild(overlay);
    live.textContent = `${heading} ${intro}`;
    leave.focus();

    const focusables = [leave, proceed, trust];
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        modalAcknowledged = true;
      } else if (e.key === "Tab") {
        // keep keyboard focus inside the dialog
        const i = focusables.indexOf(ui.root.activeElement);
        e.preventDefault();
        const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i + 1) % focusables.length;
        focusables[next].focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
  }

  async function trustSite() {
    await chrome.runtime.sendMessage({ type: "TRUST", domain: location.hostname.toLowerCase() });
    lastResult = { ...lastResult, level: "trusted", reasons: [] };
    modalAcknowledged = true;
    render();
    ensureUI().live.textContent = "JobGuard: this site is now trusted. You can undo this in the JobGuard popup.";
  }

  async function reportMistake() {
    await chrome.runtime.sendMessage({ type: "REPORT", domain: location.hostname.toLowerCase(), level: lastResult?.level });
    ensureUI().live.textContent = "Thanks. Your report was saved on this device.";
    bannerDismissed = true;
    render();
  }

  // ---------- tiny DOM helpers ----------

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }

  function button(label, cls, onClick) {
    const b = el("button", { type: "button", class: cls }, label);
    b.addEventListener("click", onClick);
    return b;
  }

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .banner { position: fixed; top: 12px; right: 12px; width: min(420px, calc(100vw - 24px)); padding: 14px 16px;
      border-radius: 12px; border: 2px solid; box-shadow: 0 8px 28px rgba(0,0,0,.18); font-size: 14px; line-height: 1.45; color: #111827; }
    .caution { background: #fffbeb; border-color: #b45309; }
    .danger  { background: #fef2f2; border-color: #b91c1c; }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .label { font-weight: 700; }
    .icon { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; color: #fff; font-weight: 800; font-size: 13px; flex: none; }
    .caution .icon { background: #b45309; }
    .danger .icon, .dialog .icon { background: #b91c1c; }
    .icon.big { width: 28px; height: 28px; font-size: 16px; vertical-align: middle; }
    ul { margin: 6px 0 10px; padding-left: 18px; }
    li { margin: 4px 0; }
    .tag { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px; border: 1px solid #6b7280; color: #374151; background: #fff; }
    .tag.ai { border-color: #4338ca; color: #3730a3; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .btn { font: inherit; font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 1.5px solid #374151; background: #fff; color: #111827; cursor: pointer; text-decoration: none; }
    .btn.primary { background: #111827; color: #fff; border-color: #111827; }
    .btn.link { border-color: transparent; background: transparent; text-decoration: underline; padding: 7px 4px; }
    .btn:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
    .overlay { position: fixed; inset: 0; background: rgba(17,24,39,.55); display: grid; place-items: center; padding: 16px; }
    .dialog { width: min(520px, 100%); background: #fff; border-radius: 14px; border-top: 6px solid #b91c1c; padding: 22px 22px 18px; color: #111827; font-size: 15px; line-height: 1.5; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
    .dialog h2 { margin: 0 0 8px; font-size: 20px; }
    .todo { background: #f3f4f6; padding: 10px 12px; border-radius: 8px; }
    @media (prefers-reduced-motion: no-preference) { .banner, .dialog { animation: jg-in .18s ease-out; } }
    @keyframes jg-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  `;

  run();
})();
