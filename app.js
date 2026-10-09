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
  const usedVoice = { achievement: false, why: false };
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
      const dl = document.createElement("datalist");
      dl.id = "people-list";
      for (const p of people) { const o = document.createElement("option"); o.value = p.name; dl.appendChild(o); }
      document.body.appendChild(dl);
      for (const t of ctx.teams) { const o = document.createElement("option"); o.value = t; o.textContent = t; $("team").appendChild(o); }
      try { $("nominator").value = localStorage.getItem("ff-nominator") || ""; } catch (e) { /* storage blocked */ }
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
    const note = $("voice-note");
    if (!SR) { note.textContent = "Voice input isn’t available in this browser. Typing works everywhere."; return; }
    note.textContent = "Voice uses your browser’s speech service (Google in Chrome, Apple in Safari). Nothing is recorded by Feedback Fridays; check the text before sending.";
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

  // ------------------------------------------------------------ simple clarity nudges (browser rules, optional)
  function nudges() {
    const out = [];
    const ach = $("achievement").value.trim();
    if (ach.split(/\s+/).length < 20) out.push("Could you add a little more about what they actually did, or what changed because of it?");
    if (!$("why").value.trim()) out.push("Why did it matter? One line on the impact helps the editor.");
    return out.slice(0, 2);
  }

  $("nomination").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("form-error").textContent = "";
    const leadName = $("lead").value.trim();
    if (!$("nominator").value.trim() || !leadName || !$("achievement").value.trim()) {
      $("form-error").textContent = "Please fill in your name, who led it, and what they did.";
      return;
    }
    const n = nudges();
    if (n.length && !nudged) {
      nudged = true;
      const box = $("nudge");
      box.innerHTML = "";
      n.forEach((t) => { const p = document.createElement("p"); p.textContent = t; box.appendChild(p); });
      const p = document.createElement("p"); p.textContent = "Add a bit more, or press Send nomination again to send as it is."; box.appendChild(p);
      box.hidden = false;
      return;
    }
    if (!lead || lead.name !== leadName) {
      const exact = people.find((p) => p.name.toLowerCase() === leadName.toLowerCase());
      lead = exact ? { id: exact.id, name: exact.name } : { id: null, name: leadName };
    }
    const method = usedVoice.achievement || usedVoice.why ? "voice" : "typed";
    const payload = {
      nominator: $("nominator").value.trim(), lead_name: lead.name, lead_employee_id: lead.id,
      team_label: $("team").value || null, supporters, achievement: $("achievement").value.trim(),
      why: $("why").value.trim() || null, project: $("project").value.trim() || null,
      disease: $("disease").value.trim() || null, input_method: method, website: $("website").value,
    };
    $("submit").disabled = true;
    try {
      const res = await rpc("ff_submit_nomination", { p_token: token, p: payload });
      if (!res.ok) {
        $("form-error").textContent = {
          closed: "Nominations for this issue have just closed.",
          rate_limited: "Lots of nominations from this connection just now. Please wait a few minutes and try again.",
          missing_fields: "Please fill in your name, who led it, and what they did.",
        }[res.reason] || "That didn’t work. Please try again.";
        return;
      }
      try { localStorage.setItem("ff-nominator", payload.nominator); } catch (err) { /* ignore */ }
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
    usedVoice.achievement = usedVoice.why = false;
    show("state-form");
    $("lead").focus();
  });

  init();
})();
