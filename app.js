/* Feedback Fridays nomination form.
   - The issue link (?t=TOKEN) is checked on the server; invalid or closed links show a message.
   - Typed input always works. Voice uses the browser's own speech recognition (Chrome, Edge, Safari)
     and writes a live, editable transcript into the field. No audio is recorded or stored by us.
   - Photos (optional, up to 4) are shrunk in the browser to a JPEG (this also drops GPS and other
     metadata), then uploaded to a private store with a one-off upload ticket for this issue. */
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
  const MAX_PHOTOS = 4, MAX_EDGE = 2400;
  let photos = [];            // [{id, url, state: "busy"|"done"|"failed", path, job}]
  let ticket = null;

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
      setupPhotos();
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

  // ------------------------------------------------------------ photos: shrink in the browser, upload in the background
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

  async function getTicket() {
    if (ticket) return ticket;
    const res = await rpc("ff_upload_ticket", { p_token: token });
    if (!res.ok) throw new Error(res.reason || "ticket");
    ticket = res.ticket;
    return ticket;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }

  async function shrink(file) {
    const { img, url } = await loadImage(file);    // browsers apply the photo's rotation when drawing
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
    if (!blob) throw new Error("encode");
    return { blob, preview: url };
  }

  async function uploadPhoto(p, file) {
    try {
      const { blob, preview } = await shrink(file);
      p.url = preview; drawThumbs();
      if (blob.size > 10 * 1024 * 1024) throw new Error("size");
      const path = `${await getTicket()}/${uuid()}.jpg`;
      const r = await fetch(`${cfg.supabaseUrl}/storage/v1/object/ff-submissions/${path}`, {
        method: "POST",
        headers: { apikey: cfg.publishableKey, "Content-Type": "image/jpeg", "x-upsert": "false" },
        body: blob,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      p.path = path; p.state = "done";
    } catch (e) {
      p.state = "failed";
      p.error = e.message === "decode" ? "This photo type can’t be read here. Please use a JPEG or PNG."
              : e.message === "rate_limited" ? "Lots of uploads just now. Please wait a few minutes."
              : e.message === "closed" ? "Nominations for this issue have closed."
              : "That photo didn’t upload. Remove it and try again.";
    }
    drawThumbs();
  }

  function addFiles(files) {
    const room = MAX_PHOTOS - photos.length;
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (list.length > room) $("photo-status").textContent = `Only ${MAX_PHOTOS} photos per nomination, so the first ${room} were added.`;
    for (const f of list.slice(0, Math.max(0, room))) {
      const p = { id: uuid(), url: "", state: "busy" };
      photos.push(p);
      p.job = uploadPhoto(p, f);
    }
    drawThumbs();
  }

  function drawThumbs() {
    const ul = $("photo-thumbs");
    ul.innerHTML = "";
    photos.forEach((p) => {
      const li = document.createElement("li");
      li.className = p.state;
      if (p.url) { const img = document.createElement("img"); img.src = p.url; img.alt = ""; li.appendChild(img); }
      const st = document.createElement("span"); st.className = "state";
      st.textContent = p.state === "busy" ? "Uploading…" : p.state === "failed" ? "Didn’t upload" : "";
      li.appendChild(st);
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "×"; b.setAttribute("aria-label", "Remove photo");
      b.addEventListener("click", () => { photos = photos.filter((x) => x !== p); drawThumbs(); });
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("photo-drop").hidden = photos.length >= MAX_PHOTOS;
    const failed = photos.find((p) => p.state === "failed");
    if (failed) $("photo-status").textContent = failed.error;
    else if (!photos.some((p) => p.state === "busy")) $("photo-status").textContent = "";
  }

  function setupPhotos() {
    const input = $("photos"), drop = $("photo-drop");
    input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
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
    if (photos.some((p) => p.state === "busy")) {
      $("submit").disabled = true; $("submit").textContent = "Uploading photos…";
      await Promise.all(photos.map((p) => p.job));
      $("submit").textContent = "Send nomination";
    }
    if (photos.some((p) => p.state === "failed")) {
      $("submit").disabled = false;
      $("form-error").textContent = "One photo didn’t upload. Remove it (×) or add it again, then send.";
      return;
    }
    const method = usedVoice.achievement ? "voice" : "typed";
    const payload = {
      nominator: $("nominator").value.trim(), lead_name: lead.name, lead_employee_id: lead.id,
      team_label: null, supporters, achievement: $("achievement").value.trim(), why: null,
      project: $("project").value.trim(), disease: $("disease").value.trim(),
      input_method: method, website: $("website").value,
      photos: photos.filter((p) => p.state === "done").map((p) => p.path),
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
    photos = []; ticket = null; drawThumbs();
    usedVoice.achievement = false;
    show("state-form");
    $("lead").focus();
  });

  init();
})();
