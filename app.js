/* Feedback Fridays nomination form.
   - The issue link (?t=TOKEN) is checked on the server; invalid or closed links show a message.
   - Typed input always works. Voice uses the browser's own speech recognition (Chrome, Edge, Safari)
     and writes a live, editable transcript into the field. No audio is recorded or stored by us. */
(function () {
  "use strict";
  const cfg = window.FF_CONFIG;
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get("t") || "";
  let people = [];
  let lead = null;            // {id, name} or {id:null, name}
  let supporters = [];        // [{id, name}]
  const usedVoice = { achievement: false };
  let nudged = false;

  async function rpc(fn, body) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.publishableKey },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function show(id) {
    for (const s of ["state-loading", "state-error", "state-form", "state-done"]) $(s).hidden = s !== id;
    $("main").focus({ preventScroll: id === "state-form" });
  }

  function fail(msg) { $("error-text").textContent = msg; show("state-error"); }

  async function init() {
    if (!token) return fail("This page needs the nomination link for the current issue. Please use the link you were sent.");
    try {
      const ctx = await rpc("ff_form_context", { p_token: token });
      if (!ctx.ok) {
        return fail(ctx.reason === "closed"
          ? "Nominations for this issue have closed. Thank you! Look out for the next link."
          : "This nomination link isn’t valid. Please check you have the latest link.");
      }
      people = ctx.employees || [];
      $("issue-number").textContent = ctx.issue;
      // Never prefill "Your name": the link is shared, so a remembered name would belong to someone else.
      try { localStorage.removeItem("ff-nominator"); } catch (e) { /* storage blocked */ }
      setupCombo("nominator", (p) => { $("nominator").value = p.name; });
      setupCombo("lead", (p) => { lead = p; $("lead").value = p.name; });
      setupCombo("supporter", (p) => { addSupporter(p); $("supporter").value = ""; });
      setupVoice();
      show("state-form");
    } catch (e) {
      fail("We couldn’t reach the nomination service. Please check your connection and try again.");
    }
  }

  // ------------------------------------------------------------ name search (accessible combobox)
  function matches(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q)).slice(0, 8);
  }

  function setupCombo(key, onPick) {
    const input = $(key), list = $(`${key}-list`);
    let items = [], active = -1;
    const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; };
    const render = () => {
      items = matches(input.value);
      list.innerHTML = "";
      items.forEach((p, i) => {
        const li = document.createElement("li");
        li.id = `${key}-opt-${i}`; li.setAttribute("role", "option"); li.setAttribute("aria-selected", String(i === active));
        li.textContent = p.name;
        if (p.team) { const t = document.createElement("span"); t.className = "team"; t.textContent = p.team; li.appendChild(t); }
        li.addEventListener("mousedown", (e) => { e.preventDefault(); onPick({ id: p.id, name: p.name }); close(); });
        list.appendChild(li);
      });
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", String(!list.hidden));
      if (active >= 0) input.setAttribute("aria-activedescendant", `${key}-opt-${active}`);
    };
    input.addEventListener("input", () => { active = -1; if (key === "lead") lead = null; render(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      else if (e.key === "Escape") { close(); }
      else if (e.key === "Enter") {
        if (active >= 0 && items[active]) { e.preventDefault(); onPick({ id: items[active].id, name: items[active].name }); close(); }
        else if (key === "supporter" && input.value.trim()) { e.preventDefault(); onPick({ id: null, name: input.value.trim() }); close(); }
      }
    });
    input.addEventListener("blur", () => setTimeout(close, 120));
  }

  function addSupporter(p) {
    if (supporters.some((s) => s.name.toLowerCase() === p.name.toLowerCase())) return;
    supporters.push(p);
    drawChips();
  }

  function drawChips() {
    const ul = $("supporter-chips");
    ul.innerHTML = "";
    supporters.forEach((s, i) => {
      const li = document.createElement("li");
      li.textContent = s.name;
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("aria-label", `Remove ${s.name}`); b.textContent = "×";
      b.addEventListener("click", () => { supporters.splice(i, 1); drawChips(); $("supporter").focus(); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------ voice: live, editable transcript
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;   // no speech support (e.g. Firefox): Speak buttons stay hidden, typing works
    let rec = null, activeBtn = null;
    document.querySelectorAll(".mic").forEach((btn) => {
      btn.hidden = false;
      btn.addEventListener("click", () => {
        if (activeBtn === btn) { rec.stop(); return; }
        if (rec) rec.stop();
        const field = $(btn.dataset.target), interim = $(`${btn.dataset.target}-interim`);
        rec = new SR();
        rec.lang = "en-GB"; rec.continuous = true; rec.interimResults = true;
        activeBtn = btn; btn.setAttribute("aria-pressed", "true"); btn.textContent = "Stop";
        usedVoice[btn.dataset.target] = true;
        rec.onresult = (ev) => {
          let finalText = "", live = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const t = ev.results[i][0].transcript;
            if (ev.results[i].isFinal) finalText += t; else live += t;
          }
          if (finalText) {
            const sep = field.value && !/\s$/.test(field.value) ? " " : "";
            field.value += sep + finalText.trim().replace(/^./, (c) => (field.value.trim() === "" ? c.toUpperCase() : c));
          }
          interim.textContent = live;
        };
        rec.onerror = (ev) => {
          interim.textContent = ev.error === "not-allowed" ? "Microphone permission was blocked. You can still type." : "Voice stopped. You can keep typing.";
        };
        rec.onend = () => { btn.setAttribute("aria-pressed", "false"); btn.textContent = "Speak"; activeBtn = null; interim.textContent = ""; };
        try { rec.start(); } catch (e) { rec.onend(); }
      });
    });
  }

  // ------------------------------------------------------------ every field is required; one gentle nudge for very short write-ups
  function missingFields() {
    const out = [];
    if (!$("nominator").value.trim()) out.push("your name");
    if (!$("lead").value.trim()) out.push("who led it");
    if (!supporters.length) out.push("who else helped");
    if (!$("achievement").value.trim()) out.push("what they did and why it was noteworthy");
    if (!$("project").value.trim()) out.push("the client");
    if (!$("disease").value.trim()) out.push("the disease area(s)");
    return out;
  }

  $("nomination").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("form-error").textContent = "";
    const pending = $("supporter").value.trim();   // a typed name not yet turned into a chip
    if (pending) { addSupporter({ id: null, name: pending }); $("supporter").value = ""; }
    const missing = missingFields();
    if (missing.length) {
      $("form-error").textContent = `Please add ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`;
      return;
    }
    const leadName = $("lead").value.trim();
    if ($("achievement").value.trim().split(/\s+/).length < 20 && !nudged) {
      nudged = true;
      const box = $("nudge");
      box.innerHTML = "";
      for (const t of ["Could you add a little more about what they did and why it mattered?",
                       "Add a bit more, or press Send nomination again to send as it is."]) {
        const p = document.createElement("p"); p.textContent = t; box.appendChild(p);
      }
      box.hidden = false;
      return;
    }
    if (!lead || lead.name !== leadName) {
      const exact = people.find((p) => p.name.toLowerCase() === leadName.toLowerCase());
      lead = exact ? { id: exact.id, name: exact.name } : { id: null, name: leadName };
    }
    const method = usedVoice.achievement ? "voice" : "typed";
    const payload = {
      nominator: $("nominator").value.trim(), lead_name: lead.name, lead_employee_id: lead.id,
      team_label: null, supporters, achievement: $("achievement").value.trim(), why: null,
      project: $("project").value.trim(), disease: $("disease").value.trim(),
      input_method: method, website: $("website").value,
    };
    $("submit").disabled = true;
    try {
      const res = await rpc("ff_submit_nomination", { p_token: token, p: payload });
      if (!res.ok) {
        $("form-error").textContent = {
          closed: "Nominations for this issue have just closed.",
          rate_limited: "Lots of nominations from this connection just now. Please wait a few minutes and try again.",
          missing_fields: "Please complete every field.",
        }[res.reason] || "That didn’t work. Please try again.";
        return;
      }
      $("done-name").textContent = lead.name;
      show("state-done");
    } catch (err) {
      $("form-error").textContent = "We couldn’t send that. Please check your connection and try again; nothing was lost.";
    } finally {
      $("submit").disabled = false;
    }
  });

  $("again").addEventListener("click", () => {
    const keep = $("nominator").value;
    $("nomination").reset();
    $("nominator").value = keep;
    lead = null; supporters = []; drawChips(); nudged = false; $("nudge").hidden = true;
    usedVoice.achievement = false;
    show("state-form");
    $("lead").focus();
  });

  init();
})();
