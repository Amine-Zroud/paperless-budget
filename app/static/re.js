"use strict";
/* Properties (buildings, flats, utility costs, rents) and projects – uses helpers from app.js */

const RE = { props: [], projects: [], pid: null, year: null, sub: "overview", costs: null, prId: null };
const MONTHS = [__("January"), __("February"), __("March"), "April", __("May"), __("June"), __("July"), "August", "September", __("October"), "November", __("December")];
const reProp = () => RE.props.find((p) => p.id === RE.pid);
const num = (v) => (v === "" || v == null ? null : Number(v));
const fmt2 = (n) => (n == null ? "" : Number(n).toFixed(2));

async function loadRE() {
  [RE.props, RE.projects] = await Promise.all([api("/api/properties-full"), api("/api/re/projects")]);
  if (!RE.props.some((p) => p.id === RE.pid)) RE.pid = RE.props[0]?.id ?? null;
}

// ------------------------------------------------------------ generic table with inline editing
function etable(ent, rows, cols, { add = true, del = true, foot = "" } = {}) {
  const cell = (r, c) => {
    const v = r[c.f];
    const a = `data-ent="${ent}" data-id="${r.id}" data-f="${c.f}"`;
    if (c.type === "check") return `<input type="checkbox" ${a} ${v ? "checked" : ""}>`;
    if (c.type === "select") return `<select ${a}>${c.options(r).map(([k, l]) => `<option value="${k ?? ""}" ${String(k ?? "") === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    if (c.type === "static") return c.render(r);
    return `<input ${a} type="${c.type || "text"}" ${c.type === "number" ? 'step="any"' : ""} value="${esc(v ?? "")}" placeholder="${esc(c.ph || "")}">`;
  };
  return `<table class="etable"><thead><tr>${cols.map((c) => `<th style="${c.w ? `width:${c.w}` : ""}" class="${c.type === "number" ? "num" : ""}">${esc(c.label)}</th>`).join("")}${del ? "<th></th>" : ""}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(r, c)}</td>`).join("")}${del ? `<td><button class="linkbtn danger" data-del="${ent}" data-id="${r.id}">${__("delete")}</button></td>` : ""}</tr>`).join("")
      || `<tr><td colspan="${cols.length + 1}" class="muted small">${__("– no entries yet –")}</td></tr>`}</tbody>
    ${foot}</table>${add ? `<button class="linkbtn" data-add="${ent}">${__("+ add")}</button>` : ""}`;
}

async function reSaveField(el) {
  const { ent, id, f } = el.dataset;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "number") v = num(v);
  if (el.tagName === "SELECT" && /(_id|key_id)$/.test(f)) v = v === "" ? null : Number(v);
  try { await api(`/api/re/${ent}/${id}`, { method: "PUT", body: JSON.stringify({ [f]: v }) }); toast(__("Saved")); }
  catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------ Immobilien: Rahmen
function periodLabel(p, y) {
  const sm = p.start_month || 1;
  const s = new Date(y, sm - 1, 1), e = new Date(y + (sm > 1 ? 1 : 1), sm - 1, 0);
  return sm === 1 ? `${y}` : `${y}/${String(y + 1).slice(2)} (${s.toLocaleDateString(LOCALE)} – ${e.toLocaleDateString(LOCALE)})`;
}
function defaultYear(p) {
  const now = new Date(), sm = p.start_month || 1;
  let y = now.getFullYear() - (now.getMonth() + 1 < sm ? 1 : 0);
  return y - 1; // zuletzt abgeschlossene Periode
}

async function renderRE() {
  await loadRE();
  const p = reProp();
  $("#reProp").innerHTML = RE.props.map((x) => `<option value="${x.id}" ${x.id === RE.pid ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  $("#reProp").hidden = !p; $("#reYear").hidden = !p; $("#reTabs").hidden = !p;
  $("#reEmpty").hidden = !!p;
  if (!p) { $("#reBody").innerHTML = ""; return; }
  if (RE.year == null) RE.year = defaultYear(p);
  const ys = []; for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 6; y--) ys.push(y);
  $("#reYear").innerHTML = ys.map((y) => `<option value="${y}" ${y === RE.year ? "selected" : ""}>${esc(periodLabel(p, y))}</option>`).join("");
  document.querySelectorAll("#reTabs button").forEach((b) => b.classList.toggle("active", b.dataset.sub === RE.sub));
  const f = { overview: reOverview, costs: reCosts, rent: reRent, statement: reStatement, setup: reSetup }[RE.sub];
  $("#reBody").innerHTML = `<div class="empty">${__("Loading …")}</div>`;
  await f(p);
}
$("#reProp").onchange = (e) => { RE.pid = Number(e.target.value); RE.year = null; renderRE(); };
$("#reYear").onchange = (e) => { RE.year = Number(e.target.value); renderRE(); };
$("#reTabs").addEventListener("click", (e) => { const s = e.target.dataset.sub; if (s) { RE.sub = s; renderRE(); } });
$("#reAddProp").onclick = async () => {
  const r = await openDialog({ title: __("New building"), label: __("Name / address"), value: "", ok: __("Create") });
  if (!r || !r.value) return;
  const p = await api("/api/re/properties", { method: "POST", body: JSON.stringify({ name: r.value, address: r.value, start_month: 1, room_pct: 70 }) });
  RE.pid = p.id; RE.sub = "setup"; RE.year = null; renderRE();
};

// ------------------------------------------------------------ Overview
async function reOverview(p) {
  if (!p.units.length) { $("#reBody").innerHTML = `<div class="card hint">${__("First, under")} <a href="#" data-resub="setup">${__("Setup")}</a> ${__("add flats.")}</div>`; return; }
  const [sum, rent] = await Promise.all([api(`/api/properties/${p.id}/summary?year=${RE.year}`), api(`/api/properties/${p.id}/rent?year=${RE.year}`)]);
  const paid = rent.tenancies.reduce((a, t) => a + t.paid_total, 0), due = rent.tenancies.reduce((a, t) => a + t.due_total, 0);
  const arrears = rent.tenancies.reduce((a, t) => a + Math.max(0, t.arrears), 0);
  $("#reBody").innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">${__("Allocatable costs")}</div><div class="kpi-value">${fmt(sum.umlegbar)}</div><div class="kpi-sub">${fmtDate(sum.period[0])} – ${fmtDate(sum.period[1])}</div></div>
      <div class="kpi"><div class="kpi-label">${__("Not allocatable")}</div><div class="kpi-value">${fmt(sum.nicht_umlegbar)}</div><div class="kpi-sub">${__("Maintenance, owner costs")}</div></div>
      <div class="kpi"><div class="kpi-label">${__("Rent received")}</div><div class="kpi-value">${fmt(paid)}</div><div class="kpi-sub">${__("due from {due}", {due: fmt(due)})}</div></div>
      <div class="kpi"><div class="kpi-label">${__("Arrears")}</div><div class="kpi-value ${arrears > 0.5 ? "neg" : "pos"}">${fmt(arrears)}</div><div class="kpi-sub">${__("to date")}</div></div>
    </div>
    <div class="card"><h3>${__("Distribution of utility costs")}</h3>
      <table class="etable"><thead><tr><th>${__("Flat")}</th><th>${__("Type")}</th><th>Name</th><th class="num">${__("days")}</th><th class="num">${__("Costs")}</th><th class="num">${__("Advance payment")}</th><th class="num">${__("Balance")}</th><th></th></tr></thead>
      <tbody>${sum.rows.map((r) => `<tr><td>${esc(r.unit)}</td><td>${esc(typeLabel(r.type))}</td><td>${esc(r.name)}</td><td class="num">${r.days}</td>
        <td class="num">${fmt(r.total)}</td><td class="num">${r.type === "Mieter" ? fmt(r.akonto) : ""}</td>
        <td class="num ${r.type === "Mieter" ? (r.saldo > 0 ? "neg" : "pos") : ""}">${r.type === "Mieter" ? fmt(r.saldo) : ""}</td>
        <td>${r.type !== "Leerstand" ? `<button class="linkbtn" data-goto-st="${r.tenancy_id ?? ""}" data-unit="${r.unit_id}">${__("Statement")}</button>` : ""}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="4">${__("Total distributed")}</td><td class="num">${fmt(sum.verteilt)}</td><td colspan="3"></td></tr></tfoot></table>
      <p class="muted small">${__("Positive balance = additional payment by the tenant. Vacancy is borne by the owner.")}</p>
    </div>`;
}
$("#reBody").addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto-st]");
  if (g) { RE.stSel = g.dataset.gotoSt ? `t${g.dataset.gotoSt}` : `u${g.dataset.unit}`; RE.sub = "statement"; renderRE(); return; }
  const s = e.target.closest("[data-resub]"); if (s) { e.preventDefault(); RE.sub = s.dataset.resub; renderRE(); }
});

// ------------------------------------------------------------ Kosten
const unitOpts = (p, empty = __("distributed (key)")) => [["", empty], ...p.units.map((u) => [u.id, __("only {name}", {name: u.name})])];
const catOpts = (p, empty = __("– not allocatable –")) => [["", empty], ...p.categories.map((c) => [c.id, `${c.grp} · ${c.name}`])];

async function reCosts(p) {
  const c = await api(`/api/properties/${p.id}/costs?year=${RE.year}`);
  RE.costs = c;
  const umlegbar = c.lines.filter((l) => l.category_id).reduce((a, l) => a + l.amount, 0);
  const row = (l) => `<tr data-key="${l.key}">
      <td>${fmtDate(l.date)}</td>
      <td><span class="srcb ${l.source}">${srcLabel(l.source)}</span></td>
      <td><div class="it-purpose" title="${esc(l.purpose || "")}">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title)}</div>
          <div class="it-sub">${esc(l.purpose || "")}${l.implicit ? (" " + __("· via tag")) : ""}${l.percent != null && l.percent !== 100 && l.alloc_id ? ` ${__("· {percent} % of {full_amount}", {percent: l.percent, full_amount: fmt(l.full_amount)})}` : ""}${l.fixed_amount != null && l.alloc_id ? ` ${__("· part of {full_amount}", {full_amount: fmt(l.full_amount)})}` : ""}</div></td>
      <td><select class="lc-cat">${catOpts(p).map(([k, t]) => `<option value="${k}" ${String(k) === String(l.category_id ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>${l.category_guessed ? `<div class="guess">automatisch erkannt</div>` : ""}</td>
      <td><select class="lc-unit">${unitOpts(p).map(([k, t]) => `<option value="${k}" ${String(k) === String(l.unit_id ?? "") ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></td>
      <td><input class="lc-qty" type="number" step="any" value="${l.quantity ?? ""}" ${l.source === "Fix" ? "disabled" : ""}>${l.quantity_guessed ? `<div class="guess">${__("from receipt")}</div>` : ""}</td>
      <td class="num"><b>${fmt(l.amount)}</b></td>
      <td>${l.alloc_id ? `<button class="linkbtn danger lc-del" title="${__("Remove assignment")}">${__("remove")}</button>` : l.source === "Manuell" || l.source === "Fix" ? `<button class="linkbtn danger lc-del">${__("delete")}</button>` : ""}</td>
    </tr>`;
  $("#reBody").innerHTML = `<div class="card">
    <div class="cardhead"><h3>${__("Costs {year}", {year: esc(periodLabel(p, RE.year))})}</h3>
      <div class="row"><button id="lcSearch">${__("+ Receipt / bank transaction")}</button><button id="lcManual">${__("+ Manual costs")}</button><button id="lcFixed">${__("+ Fixed costs")}</button></div></div>
    <p class="muted small">${__("Receipts with the building tag{tag_id} appear automatically. Choose a cost type (or “not allocatable”); flat “distributed” = by key, “only …” = charged individually.", {tag_id: p.tag_id ? ` „${esc(tagName(p.tag_id))}“` : ""})}</p>
    <div class="tablewrap"><table class="etable"><thead><tr><th style="width:84px">${__("Date")}</th><th style="width:70px">${__("Source")}</th><th>${__("Receipt / purpose")}</th><th style="width:210px">${__("Cost type")}</th><th style="width:170px">${__("Flat")}</th><th style="width:90px">${__("Quantity")}</th><th class="num" style="width:100px">${__("Amount")}</th><th style="width:70px"></th></tr></thead>
      <tbody>${c.lines.map(row).join("") || `<tr><td colspan="8" class="empty">${__("No costs in this period.")}</td></tr>`}</tbody>
      <tfoot><tr><td colspan="6">${__("Allocatable {span}", {span: c.unassigned ? `<span class="muted small">${__("({unassigned} item(s) not allocatable)", {unassigned: c.unassigned})}</span>` : ""})}</td><td class="num">${fmt(umlegbar)}</td><td></td></tr>
             <tr><td colspan="6" class="muted">${__("Total incl. non-allocatable")}</td><td class="num muted">${fmt(c.total)}</td><td></td></tr></tfoot></table></div>
  </div>`;
  $("#lcSearch").onclick = () => openSearch({ type: "property", id: p.id, name: p.name });
  $("#lcManual").onclick = async () => {
    await api("/api/re/manual-costs", { method: "POST", body: JSON.stringify({ property_id: p.id, category_id: p.categories[0]?.id, date: c.period[1], description: __("Manual costs"), amount: 0 }) });
    RE.sub = "setup"; RE.setupFocus = "manual"; renderRE();
  };
  $("#lcFixed").onclick = async () => {
    await api("/api/re/fixed-costs", { method: "POST", body: JSON.stringify({ property_id: p.id, category_id: p.categories[0]?.id, name: __("Fixed costs"), amount: 0, interval: "jahr" }) });
    RE.sub = "setup"; RE.setupFocus = "fixed"; renderRE();
  };
}

$("#reBody").addEventListener("change", async (e) => {
  const tr = e.target.closest("tr[data-key]");
  if (tr && RE.sub === "costs") {
    const l = RE.costs.lines.find((x) => x.key === tr.dataset.key);
    const field = e.target.classList.contains("lc-cat") ? "category_id" : e.target.classList.contains("lc-unit") ? "unit_id" : e.target.classList.contains("lc-qty") ? "quantity" : null;
    if (!field) return;
    const v = num(e.target.value);
    try {
      if (l.alloc_id) await api(`/api/allocations/${l.alloc_id}`, { method: "PUT", body: JSON.stringify({ [field]: v }) });
      else if (l.source === "Manuell") await api(`/api/re/manual-costs/${l.source_id}`, { method: "PUT", body: JSON.stringify({ [field]: v }) });
      else if (l.source === "Fix") await api(`/api/re/fixed-costs/${l.source_id}`, { method: "PUT", body: JSON.stringify({ [field]: v }) });
      else {  // via tag (implicit) → create an explicit assignment
        const body = { source_type: l.source_type, source_id: l.source_id, target_type: "property", target_id: RE.pid, percent: 100,
          category_id: l.category_id, unit_id: l.unit_id, quantity: l.quantity, [field]: v };
        await api("/api/allocations", { method: "POST", body: JSON.stringify(body) });
      }
      toast(__("Saved")); renderRE();
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (e.target.dataset.ent) { await reSaveField(e.target); if (["units", "keys"].includes(e.target.dataset.ent) || e.target.dataset.f === "type") renderRE();
    if (e.target.dataset.ent === "heating-stock") drawStock(reProp()); return; }
  if (e.target.classList.contains("share")) {
    const k = e.target.dataset.key, inputs = [...document.querySelectorAll(`input.share[data-key="${k}"]`)];
    const shares = Object.fromEntries(inputs.map((i) => [i.dataset.unit, num(i.value)]));
    await api(`/api/re/keys/${k}/shares`, { method: "PUT", body: JSON.stringify({ shares }) });
    const sum = inputs.reduce((a, i) => a + (Number(i.value) || 0), 0);
    const cell = document.querySelector(`[data-sum="${k}"]`); if (cell) { cell.textContent = sum.toFixed(2) + " %"; cell.classList.toggle("warn", Math.abs(sum - 100) > 0.01); }
    toast(__("Saved"));
  }
  if (e.target.id === "pfForm" || e.target.closest("#pfForm")) {
    const el = e.target; let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number" || /_id$|start_month/.test(el.name)) v = num(v);
    try { await api(`/api/re/properties/${RE.pid}`, { method: "PUT", body: JSON.stringify({ [el.name]: v }) }); toast(__("Saved")); if (el.name === "name") renderRE(); }
    catch (err) { toast(err.message, true); }
  }
  if (e.target.id === "stPick") { RE.stSel = e.target.value; renderRE(); }
});
$("#reBody").addEventListener("click", async (e) => {
  const oa = e.target.closest("[data-oiladd]");
  if (oa) {
    e.preventDefault();
    await api("/api/re/heating-stock", { method: "POST", body: JSON.stringify({ property_id: reProp().id, date: oa.dataset.oiladd, liters: 0, kind: "ablesung" }) });
    toast(__("Reading created – enter tank level")); RE.sub = "setup"; await renderRE();
    document.querySelector("#stockTable")?.closest(".card")?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  const del = e.target.closest(".lc-del");
  if (del) {
    const l = RE.costs.lines.find((x) => x.key === del.closest("tr").dataset.key);
    if (!confirm(l.alloc_id ? __("Remove assignment?") : __("Delete item?"))) return;
    if (l.alloc_id) await api(`/api/allocations/${l.alloc_id}`, { method: "DELETE" });
    else if (l.source === "Manuell") await api(`/api/re/manual-costs/${l.source_id}`, { method: "DELETE" });
    else if (l.source === "Fix") await api(`/api/re/fixed-costs/${l.source_id}`, { method: "DELETE" });
    renderRE(); return;
  }
  const add = e.target.dataset.add, d = e.target.dataset.del;
  if (add) {
    const p = reProp(), today = new Date().toISOString().slice(0, 10);
    const defaults = {
      units: { property_id: p.id, name: __("Flat {length}", {length: p.units.length + 1}), area: 0 },
      keys: { property_id: p.id, name: __("New key"), type: "percent" },
      categories: { property_id: p.id, grp: __("Utility costs"), name: __("New cost type"), key_id: p.keys[0]?.id ?? null, heating: false, sort: 50 },
      tenancies: { unit_id: p.units[0]?.id, tenant_name: __("New tenant"), start: today, rent: 0, akonto: 0 },
      "fixed-costs": { property_id: p.id, category_id: p.categories[0]?.id, name: __("Fixed costs"), amount: 0, interval: "jahr" },
      "manual-costs": { property_id: p.id, category_id: p.categories[0]?.id, date: today, description: __("Manual costs"), amount: 0 },
      "heating-stock": { property_id: p.id, date: today, liters: 0, kind: e.target.dataset.kind || "ablesung" },
    }[add];
    if (!defaults) return;
    if ((add === "tenancies" && !p.units.length) || (["fixed-costs", "manual-costs"].includes(add) && !p.categories.length)) {
      toast(add === "tenancies" ? __("Add a flat first") : __("Create cost types first"), true); return;
    }
    await api(`/api/re/${add}`, { method: "POST", body: JSON.stringify(defaults) }); renderRE(); return;
  }
  if (d) {
    if (!confirm(__("Really delete?"))) return;
    await api(`/api/re/${d}/${e.target.dataset.id}`, { method: "DELETE" });
    if (d === "properties") { RE.pid = null; RE.year = null; }
    renderRE(); return;
  }
  if (e.target.id === "pfDefaults") {
    try { await api(`/api/properties/${RE.pid}/defaults`, { method: "POST" }); toast(__("Keys and cost types created")); renderRE(); }
    catch (err) { toast(err.message, true); }
  }
});

// ------------------------------------------------------------ Mieten
async function reRent(p) {
  const r = await api(`/api/properties/${p.id}/rent?year=${RE.year}`);
  const mlabel = (m) => MONTHS[Number(m.slice(5)) - 1].slice(0, 3) + " " + m.slice(2, 4);
  const tenOpts = r.tenancies.map((t) => `<option value="${t.tenancy.id}">${esc(t.tenancy.tenant_name)} (${esc(t.unit_name)})</option>`).join("");
  $("#reBody").innerHTML = `<div class="card"><h3>${__("Rent received {year}", {year: esc(periodLabel(p, RE.year))})}</h3>
    <p class="muted small">${__("Credits from the bank statements are recognised by keyword and amount (Setup → Tenancy). Payments from the 20th count for the following month. The receipt date is shown under the amount.")}</p>
    ${r.tenancies.length ? `<div class="matrix"><table><thead><tr><th style="text-align:left">${__("Tenant")}</th>${r.months.map((m) => `<th>${mlabel(m)}</th>`).join("")}<th>Total</th><th>${__("Arrear")}</th></tr></thead>
    <tbody>${r.tenancies.map((t) => `<tr><td style="text-align:left"><b>${esc(t.tenancy.tenant_name)}</b><br><span class="muted">${__("{unit_name} · {akonto}/mo.", {unit_name: esc(t.unit_name), akonto: fmt(t.tenancy.rent + t.tenancy.akonto)})}</span></td>
      ${t.months.map((m) => { const c = !m.due && !m.paid ? "na" : m.paid >= m.due - 0.01 ? "ok" : m.paid > 0 ? "part" : m.month > new Date().toISOString().slice(0, 7) ? "na" : "miss";
        return `<td class="${c}" title="${m.payments.map((x) => `${fmtDate(x.date)}: ${fmt(x.amount)}`).join("\n")}">${m.paid ? fmt2(m.paid) : m.due ? "–" : ""}${m.payments.length ? `<br><span class="muted small">${m.payments.map((x) => fmtDate(x.date).replace(/\d{4}$/, "")).join(" ")}</span>` : ""}</td>`; }).join("")}
      <td><b>${fmt(t.paid_total)}</b><br><span class="muted">${__("of {due_total}", {due_total: fmt(t.due_total)})}</span></td><td class="${t.arrears > 0.5 ? "miss" : "ok"}">${fmt(t.arrears)}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">${__("No tenancies in this period – add them under Setup.")}</div>`}
  </div>
  ${r.tenancies.map((t) => `<div class="card"><h3>${__("Recognised rent payments · {tenant_name}", {tenant_name: esc(t.tenancy.tenant_name)})}</h3>
    <p class="muted small">${__("Automatic only if the keyword ({match_text}) is in the booking text", {match_text: t.tenancy.match_text ? `„${esc(t.tenancy.match_text)}“` : __("<b>none recorded</b> – under Setup → Tenancy")})}
      <b>${__("and")}</b> ${__("the amount matches the monthly rent of {akonto} (or a multiple). {trim}", {akonto: fmt(t.tenancy.rent + t.tenancy.akonto), trim: (t.tenancy.match_text || "").split(",").length > 2 ? `<br><b>${__("Note:")}</b> ${__("A comma means “or” – each word between the commas is enough on its own. Best to enter just the surname (e.g. “{trim}”).", {trim: esc(t.tenancy.match_text.split(",")[0].trim())})}` : ""})}</p>
    ${t.bookings.length ? `<table class="tbl small"><thead><tr><th>${__("Received")}</th><th>${__("for month (from)")}</th><th class="num">${__("Amount")}</th><th>${__("Booking text")}</th><th></th><th></th></tr></thead><tbody>
      ${t.bookings.map((b) => `<tr data-tx="${b.tx_id}" data-ten="${t.tenancy.id}"><td>${fmtDate(b.date)}</td>
        <td><select class="rp-month">${r.months.map((m) => `<option value="${m}" ${m === b.month ? "selected" : ""}>${mlabel(m)}</option>`).join("")}</select></td>
        <td class="num">${fmt(b.amount)}${b.n_months > 1 ? `<br><span class="muted small">${__("{n_months} monthly rents", {n_months: b.n_months})}</span>` : ""}</td><td class="muted">${esc(b.text)}</td><td><span class="pill ${b.auto ? "" : "grey"}">${b.auto ? "automatisch" : __("manual")}</span></td>
        <td><button class="linkbtn danger rp-del" title="${__("Not a rent payment – no longer matched automatically")}">${__("remove")}</button></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">${__("No payments recognised yet.")}</div>`}</div>`).join("")}
  <div class="card"><h3>${__("Unmatched credits")}</h3>
    ${r.unassigned_credits.length ? r.unassigned_credits.map((c) => { const sg = r.tenancies.find((t) => t.tenancy.id === c.suggest);
      return `<div class="invitem ${sg ? "rp-sug" : ""}" data-tx="${c.id}">
      <span>${fmtDate(c.date)} · <b>${esc(c.merchant || c.text.slice(0, 50))}</b> <span class="muted small">${esc(c.text.slice(0, 80))}</span>
        ${c.hint ? `<div class="small" style="color:var(--warn,#b26a00)">${esc(c.hint)}</div>` : ""}</span>
      <span class="row"><b class="num">${fmt(c.amount)}</b>${sg ? `<button class="rp-take" data-ten="${sg.tenancy.id}">${__("Rent {tenant_name}?", {tenant_name: esc(sg.tenancy.tenant_name)})}</button>` : ""}
        ${tenOpts ? `<select class="rp-ten"><option value="">${__("as rent from …")}</option>${tenOpts}</select>` : ""}</span></div>`; }).join("")
    : `<div class="empty">${__("No open credits.")}</div>`}
  </div>`;
  const post = async (tx, ten, month) => { await api("/api/rent-payments", { method: "POST", body: JSON.stringify({ tx_id: Number(tx), tenancy_id: Number(ten), month }) }); };
  document.querySelectorAll(".rp-take").forEach((b) => b.onclick = async () => {
    await post(b.closest("[data-tx]").dataset.tx, b.dataset.ten); toast(__("Recorded as rent payment")); renderRE();
  });
  document.querySelectorAll(".rp-month").forEach((s) => s.onchange = async () => {
    const tr = s.closest("tr"); await post(tr.dataset.tx, tr.dataset.ten, s.value); toast(__("Month changed")); renderRE();
  });
  document.querySelectorAll(".rp-del").forEach((b) => b.onclick = async () => {
    await api(`/api/rent-payments/${b.closest("tr").dataset.tx}`, { method: "DELETE" }); toast(__("Assignment removed")); renderRE();
  });
  document.querySelectorAll(".rp-ten").forEach((s) => s.onchange = async () => {
    if (!s.value) return;
    await api("/api/rent-payments", { method: "POST", body: JSON.stringify({ tx_id: Number(s.closest("[data-tx]").dataset.tx), tenancy_id: Number(s.value) }) });
    toast(__("Recorded as rent payment")); renderRE();
  });
}

// ------------------------------------------------------------ Abrechnung
async function reStatement(p) {
  const opts = [
    ...p.tenancies.map((t) => [`t${t.id}`, __("{tenant_name} – {name} (from {start}{end})", {tenant_name: t.tenant_name, name: p.units.find((u) => u.id === t.unit_id)?.name || "", start: fmtDate(t.start), end: t.end ? ` ${__("until {end}", {end: fmtDate(t.end)})}` : ""})]),
    ...p.units.filter((u) => u.owner_occupied).map((u) => [`u${u.id}`, __("Own share – {name}", {name: u.name})]),
  ];
  if (!opts.length) { $("#reBody").innerHTML = `<div class="card hint">${__("First add flats and tenancies under Setup.")}</div>`; return; }
  if (!opts.some(([k]) => k === RE.stSel)) RE.stSel = opts[0][0];
  const q = RE.stSel[0] === "t" ? `tenancy_id=${RE.stSel.slice(1)}` : `unit_id=${RE.stSel.slice(1)}`;
  const ak = RE.akontoOverride != null ? `&akonto=${RE.akontoOverride}` : "";
  const sm = p.start_month || 1, pStart = `${RE.year}-${String(sm).padStart(2, "0")}-01`;
  const pEnd = new Date(Date.UTC(RE.year + 1, sm - 1, 0)).toISOString().slice(0, 10);
  if (RE.stMode === "interim") {
    const ten = RE.stSel[0] === "t" ? p.tenancies.find((t) => t.id === Number(RE.stSel.slice(1))) : null;
    const today = new Date().toISOString().slice(0, 10);
    if (!RE.stFrom || RE.stFrom < pStart || RE.stFrom > pEnd) RE.stFrom = pStart;
    if (!RE.stTo || RE.stTo < RE.stFrom || RE.stTo > pEnd) RE.stTo = ten?.end && ten.end >= pStart && ten.end <= pEnd ? ten.end : (today < pEnd ? today : pEnd);
  }
  const per = RE.stMode === "interim" ? `&period_from=${RE.stFrom}&period_to=${RE.stTo}` : "";
  const [st, hist] = await Promise.all([api(`/api/properties/${p.id}/statement?year=${RE.year}&${q}${ak}${per}`), api(`/api/nk-statements?property_id=${p.id}`)]);
  const h = st.heating, tenant = RE.stSel[0] === "t";
  const tr = (a, b, cls = "") => `<tr class="${cls}"><td>${a}</td><td class="num">${b}</td></tr>`;
  $("#reBody").innerHTML = `<div class="grid2">
    <div class="card pv">
      <div class="cardhead"><h3>${__("Preview")}</h3><select id="stPick">${opts.map(([k, t]) => `<option value="${k}" ${k === RE.stSel ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="muted">${__("{interim}{name} · {stay} – {stay2} · {days} of {days_total} days", {interim: st.interim ? (__("<b>Interim statement</b> ·") + " ") : "", name: esc(st.unit.name), stay: fmtDate(st.stay[0]), stay2: fmtDate(st.stay[1]), days: st.days, days_total: st.days_total})}</div>
      ${st.oil ? `<div class="muted small" style="margin-top:4px">${__("🛢 Heating oil {span}", {span: st.oil.complete ? __("by consumption: {liters} litres = {amount} (stock {date} → {date2}, purchases from {source}, avg {price} / 100 l)", {liters: fmtN(st.oil.liters), amount: fmt(st.oil.amount), date: fmtDate(st.oil.start.date), date2: fmtDate(st.oil.end.date), source: st.oil.source === "Lieferungen" ? "erfassten Lieferungen" : __("receipts"), price: st.oil.price ?? "–"})
        : `<span class="neg">${__("by purchase – {join}", {join: st.oil.missing_price ? __("Price for the tank level reading is missing (enter a price, or deliveries with amount)") : __("Tank level reading {Tage} of the period missing{join}", {Tage: !st.oil.start ? __("at the start (around {need_start}, ±20 days)", {need_start: fmtDate(st.oil.need_start)}) : __("at the end (around {need_end}, ±20 days)", {need_end: fmtDate(st.oil.need_end)}), join: st.oil.readings?.length ? ` ${__("– recorded: {join}", {join: st.oil.readings.slice(-4).map(fmtDate).join(", ")})}` : (" " + __("– no reading recorded yet"))})})}
          <a href="#" data-oiladd="${!st.oil.start ? st.oil.need_start : st.oil.need_end}">${__("Record a reading for this date")}</a></span>`})}</div>` : ""}
      ${(st.meters || []).map((m) => `<div class="muted small" style="margin-top:4px">${__("⚡ Meter {name} (general): {missing}", {name: esc(m.name), missing: m.quantity != null
        ? __("{quantity} {unit} in the period{b} (reading {slice} → {slice2}{estimated}){category}, billed according to invoices", {quantity: fmtN(m.quantity), unit: esc(m.unit), b: m.amount != null ? `, erwartet ca. <b>${fmt(m.amount)}</b>` : "", slice: fmtDate(m.start[0].slice(0, 10)), slice2: fmtDate(m.end[0].slice(0, 10)), estimated: m.estimated ? ", Ende hochgerechnet" : "", category: m.category ? ` ${__("– shown in brackets at “{category}”", {category: esc(m.category)})}` : (" " + __("– no utility category assigned (Meters → Settings)"))})
        : esc(m.missing)})}</div>`).join("")}
      ${st.interim ? `<div class="muted small" style="margin-top:4px">${__("Only costs booked in the period count (annual bills, e.g. water, may still be missing).")}</div>` : ""}
      <table>
        ${h.total ? tr(__("Space heating"), `${fmt(h.room_unit)} <span class="muted small">${__("({room_share_pct} % of {room_total})", {room_share_pct: h.room_share_pct, room_total: fmt(h.room_total)})}</span>`) + tr(__("Hot water"), `${fmt(h.water_unit)} <span class="muted small">${__("({water_share_pct} % of {water_total})", {water_share_pct: h.water_share_pct, water_total: fmt(h.water_total)})}</span>`) : ""}
        ${st.groups.map((g) => tr(esc(g.name), fmt(g.unit_total))).join("")}
        ${st.rounding ? tr(__("Rounding difference"), fmt(st.rounding)) : ""}
        ${tr(__("Total costs"), fmt(st.total), "tot")}
        ${tenant ? tr(__("Advance payment"), "− " + fmtPos(st.akonto)) + tr(st.saldo >= 0 ? __("Additional payment tenant") : __("Credit tenant"), fmt(Math.abs(st.saldo)), "tot") : ""}
      </table>
      ${st.groups.map((g) => `<h4>${esc(g.name)}</h4><table>${g.rows.map((r) => `<tr><td>${esc(r.name)} <span class="muted small">· ${esc(r.key)} ${r.share_pct} %</span></td><td class="num muted">${fmt(r.total)}</td><td class="num">${fmt(r.unit_amount)}</td></tr>`).join("")}</table>`).join("")}
      ${h.total ? `<h4>${__("Heating pool")}</h4><table>${h.rows.map((r) => `<tr><td>${esc(r.name)} <span class="muted small">${r.quantity ? `· ${fmtN(r.quantity, 0)} ${esc(r.unit_label)}` : ""}</span></td><td class="num">${fmt(r.amount)}</td></tr>`).join("")}<tr class="tot"><td>${__("Total ({room_pct} % space heating / {room_pct2} % hot water)", {room_pct: h.room_pct, room_pct2: 100 - h.room_pct})}</td><td class="num">${fmt(h.total)}</td></tr></table>` : ""}
      ${st.unassigned.length ? `<p class="muted small">${__("Not allocated: {join}", {join: st.unassigned.map((l) => `${esc(l.title)} (${fmt(l.amount)})`).join(", ")})}</p>` : ""}
    </div>
    <div class="card">
      <h3>${__("Generate")}</h3>
      <div class="formgrid">
        <label>${__("Type")}<select id="stMode"><option value="year" ${RE.stMode !== "interim" ? "selected" : ""}>${__("Annual statement")}</option><option value="interim" ${RE.stMode === "interim" ? "selected" : ""}>${__("Interim statement")}</option></select>
          <span class="muted small">${__("Interim statement, e.g. when moving out during the period")}</span></label>
        ${RE.stMode === "interim" ? `<label>${__("from")}<input id="stFrom" type="date" min="${pStart}" max="${pEnd}" value="${RE.stFrom}"></label>
          <label>${__("until (cut-off date)")}<input id="stTo" type="date" min="${pStart}" max="${pEnd}" value="${RE.stTo}"></label>` : ""}
        ${tenant ? `<label>${__("Advance payment")}<input id="stAkonto" type="number" step="0.05" value="${st.akonto}"><span class="muted small">${__("received {akonto_received} · per contract {akonto_expected}", {akonto_received: fmt(st.akonto_received), akonto_expected: fmt(st.akonto_expected)})}</span></label>` : ""}
        <label>${__("Invoice date")}<input id="stDate" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label class="check"><input id="stUpload" type="checkbox" checked> PDF in Paperless ablegen</label>
      </div>
      <div class="row" style="margin-top:12px"><button id="stGen" class="primary">${__("Generate Word & PDF")}</button></div>
      <div id="stResult" style="margin-top:10px"></div>
      <h4 style="margin-top:18px">${__("Previous statements")}</h4>
      ${hist.length ? hist.map((x) => `<div class="invitem"><span>${fmtDate(x.created_at.slice(0, 10))} · ${x.interim ? (__("Interim st.") + " ") : ""}${fmtDate(x.period_start)}–${fmtDate(x.period_end)}
        ${x.docx ? `<a href="/api/files/${encodeURIComponent(x.docx)}">Word</a>` : ""} ${x.pdf ? `· <a href="/api/files/${encodeURIComponent(x.pdf)}" target="_blank">PDF</a>` : ""}</span>
        <span class="row"><b class="num">${fmt(x.saldo)}</b>${x.deletable ? `<button class="linkbtn danger" data-nkdel="${x.id}" data-pl="${x.paperless_task ? 1 : 0}" title="${__("Only the latest statement can be deleted")}">${__("delete")}</button>` : ""}</span></div>`).join("") : `<div class="muted small">${__("None yet.")}</div>`}
    </div></div>`;
  const ai = $("#stAkonto");
  if (ai) ai.onchange = () => { RE.akontoOverride = num(ai.value); renderRE(); };
  $("#stMode").onchange = (e) => { RE.stMode = e.target.value; RE.akontoOverride = null; renderRE(); };
  if ($("#stFrom")) { $("#stFrom").onchange = (e) => { RE.stFrom = e.target.value; RE.akontoOverride = null; renderRE(); };
    $("#stTo").onchange = (e) => { RE.stTo = e.target.value; RE.akontoOverride = null; renderRE(); }; }
  $("#reBody").querySelectorAll("[data-nkdel]").forEach((b) => (b.onclick = async () => {
    if (!confirm(__("Delete the latest statement? The Word and PDF files are removed. Afterwards the previous one can be deleted."))) return;
    const pl = b.dataset.pl === "1" && confirm(__("Also delete the PDF filed in Paperless?\n\nOK = yes, delete in Paperless too\nCancel = delete in the app only"));
    try {
      const r = await api(`/api/nk-statements/${b.dataset.nkdel}?paperless=${pl}`, { method: "DELETE" });
      toast(__("Statement deleted") + (r.paperless ? ` · Paperless: ${r.paperless}` : ""), r.paperless && r.paperless !== __("deleted"));
      renderRE();
    } catch (err) { toast(err.message, true); }
  }));
  $("#stGen").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = __("Generating …");
    try {
      const body = { year: RE.year, invoice_date: $("#stDate").value, upload: $("#stUpload").checked, akonto: ai ? num(ai.value) : null };
      if (RE.stMode === "interim") { body.period_from = RE.stFrom; body.period_to = RE.stTo; }
      if (tenant) body.tenancy_id = Number(RE.stSel.slice(1)); else body.unit_id = Number(RE.stSel.slice(1));
      const r = await api(`/api/properties/${p.id}/statement/generate`, { method: "POST", body: JSON.stringify(body) });
      $("#stResult").innerHTML = `<div class="card hint" style="margin:0">${__("✓ Generated:")} <a href="${r.docx}">${__("Download Word")}</a>${r.pdf ? ` · <a href="${r.pdf}" target="_blank">${__("Open PDF")}</a>` : ""}
        ${r.paperless_task ? __("<br>Filed in Paperless (being processed).") : ""}${r.warnings.length ? `<br><span class="neg">${r.warnings.map(esc).join("<br>")}</span>` : ""}</div>`;
      toast(__("Statement generated"));
    } catch (err) { toast(err.message, true); }
    e.target.disabled = false; e.target.textContent = __("Generate Word & PDF");
  };
}

// ------------------------------------------------------------ Einrichtung
function reSetup(p) {
  const tagSel = (v) => `<option value="">${__("– no tag –")}</option>` + S.meta.tags.map((t) => `<option value="${t.id}" ${t.id === v ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  const keyOpts = (empty) => [["", empty], ...p.keys.map((k) => [k.id, k.name])];
  const pctKeys = p.keys;
  const keyTable = `<table class="etable"><thead><tr><th>${__("Key")}</th><th style="width:150px">${__("Type")}</th>${p.units.map((u) => `<th class="num">${esc(u.name)}</th>`).join("")}<th class="num">${__("Sum")}</th><th></th></tr></thead><tbody>
    ${pctKeys.map((k) => { const sum = p.units.reduce((a, u) => a + (Number(k.shares[u.id]) || 0), 0);
      return `<tr><td><input data-ent="keys" data-id="${k.id}" data-f="name" value="${esc(k.name)}"></td>
        <td><select data-ent="keys" data-id="${k.id}" data-f="type">${[["percent", "feste Prozente"], ["area", __("by area")], ["equal", __("evenly")]].map(([v, l]) => `<option value="${v}" ${v === k.type ? "selected" : ""}>${l}</option>`).join("")}</select></td>
        ${p.units.map((u) => `<td>${k.type === "percent" ? `<input class="share" type="number" step="0.01" data-key="${k.id}" data-unit="${u.id}" value="${k.shares[u.id] ?? ""}">`
          : `<span class="muted">${k.type === "area" ? (u.area ? ((u.area / p.units.reduce((a, x) => a + (x.area || 0), 0)) * 100).toFixed(2) : "0.00") : (100 / p.units.length).toFixed(2)} %</span>`}</td>`).join("")}
        <td class="num ${k.type === "percent" && Math.abs(sum - 100) > 0.01 ? "warn" : ""}" data-sum="${k.id}">${k.type === "percent" ? sum.toFixed(2) + " %" : "100.00 %"}</td>
        <td><button class="linkbtn danger" data-del="keys" data-id="${k.id}">${__("delete")}</button></td></tr>`; }).join("") || `<tr><td colspan="${p.units.length + 4}" class="muted small">${__("– none yet –")}</td></tr>`}
    </tbody></table><button class="linkbtn" data-add="keys">${__("+ Key")}</button>`;
  const months = MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === p.start_month ? "selected" : ""}>${m}</option>`).join("");
  $("#reBody").innerHTML = `
  <div class="card"><div class="cardhead"><h3>${__("Building")}</h3><button class="linkbtn danger" data-del="properties" data-id="${p.id}">${__("Delete building")}</button></div>
    <form id="pfForm" class="formgrid" onsubmit="return false">
      <label>Name<input name="name" value="${esc(p.name)}"></label>
      <label>${__("Address (for the statement)")}<textarea name="address">${esc(p.address || "")}</textarea></label>
      <label>${__("Landlord / sender")}<input name="owner_name" value="${esc(p.owner_name || "")}"></label>
      <label>${__("Landlord address")}<textarea name="owner_address">${esc(p.owner_address || "")}</textarea></label>
      <label>${__("Rent account (IBAN)")}<input name="owner_iban" value="${esc(p.owner_iban || "")}"></label>
      <label>${__("Billing period starts in")}<select name="start_month">${months}</select></label>
      <label>${__("Heating pool: space heating share %")}<input name="room_pct" type="number" step="0.1" value="${p.room_pct}"><span class="muted small">${__("Rest = hot water")}</span></label>
      <label>${__("Key space heating")}<select name="room_key_id">${keyOpts(__("– choose –")).map(([k, l]) => `<option value="${k}" ${String(k) === String(p.room_key_id ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>${__("Key hot water")}<select name="water_key_id">${keyOpts(__("– choose –")).map(([k, l]) => `<option value="${k}" ${String(k) === String(p.water_key_id ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>${__("Paperless tag for the building's receipts")}<select name="tag_id">${tagSel(p.tag_id)}</select></label>
      <label>${__("Payable within days")}<input name="due_days" type="number" value="${p.due_days ?? 30}"></label>
      <label class="check"><input name="exclude_from_budget" type="checkbox" ${p.exclude_from_budget ? "checked" : ""}> ${__("Costs not in household budget")}</label>
      <label>${__("Introduction text")}<textarea name="intro" placeholder="Mit diesem Brief erhalten Sie die Nebenkostenabrechnung …">${esc(p.intro || "")}</textarea></label>
      <label>${__("Closing text")}<textarea name="closing" placeholder="Die Belege … können Sie … einsehen.">${esc(p.closing || "")}</textarea></label>
    </form></div>

  <div class="card"><h3>${__("Flats")}</h3>
    ${etable("units", p.units, [{ f: "name", label: __("Label") }, { f: "area", label: __("Area m²"), type: "number", w: "120px" }, { f: "owner_occupied", label: "selbst bewohnt", type: "check", w: "110px" }])}</div>

  <div class="card"><div class="cardhead"><h3>${__("Distribution keys")}</h3>${!p.categories.length ? `<button id="pfDefaults" class="primary">${__("Create default keys & cost types")}</button>` : ""}</div>
    <p class="muted small">${__("Fixed percentages per flat (sum 100 %), by area or evenly. Assign space heating/hot water above at the building.")}</p>
    ${p.units.length ? keyTable : `<div class="muted small">${__("Add flats first.")}</div>`}</div>

  <div class="card"><h3>${__("Cost types")}</h3>
    <p class="muted small">${__("“Heating pool” = split first into space heating/hot water. Keywords assign receipts automatically (correspondent, title, purpose; comma-separated).")}</p>
    ${etable("categories", p.categories, [
      { f: "grp", label: __("Group"), w: "170px" }, { f: "name", label: __("Cost type") },
      { f: "key_id", label: __("Key"), type: "select", options: () => keyOpts("–"), w: "150px" },
      { f: "heating", label: __("Heating pool"), type: "check", w: "70px" }, { f: "unit_label", label: __("Unit"), w: "80px" },
      { f: "keywords", label: __("Keywords"), ph: "heizöl, brennstoff" }])}</div>

  <div class="card"><h3>${__("Heating oil stock")}</h3>
    <p class="muted small">${__("Optional: bill heating oil by")} <b>${__("Consumption")}</b> ${__("instead of by purchase – opening stock + deliveries − closing stock. To do so, record the tank level at the start and end of the period (or on the cut-off date of an interim statement).")} <b>${__("Deliveries")}</b> ${__("with litres and amount – the app uses them to calculate the average price per 100 l of the tank content and values the readings with it. A price on the reading is only needed for the opening stock. If deliveries are recorded, they replace the heating oil receipts in the statement.")}</p>
    <div class="field"><div class="lbl"><b>${__("Cost type heating oil")}</b><span>${__("empty = bill by purchase")}</span></div>
      <div><select data-ent="properties" data-id="${p.id}" data-f="oil_category_id">${[["", __("– by purchase –")], ...p.categories.filter((c) => c.heating).map((c) => [c.id, `${c.grp} · ${c.name}`])]
        .map(([k, l]) => `<option value="${k}" ${String(k) === String(p.oil_category_id ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div></div>
    <div id="stockTable">…</div></div>

  <div class="card"><h3>${__("Tenancies")}</h3>
    <p class="muted small">${__("Keywords = text in the rent payment (e.g. name), several separated by commas; “+” joins terms. No end = ongoing.")}</p>
    <div class="tablewrap wide">${etable("tenancies", p.tenancies, [
      { f: "unit_id", label: __("Flat"), type: "select", options: () => p.units.map((u) => [u.id, u.name]), w: "150px" },
      { f: "tenant_name", label: __("Tenant") }, { f: "tenant_address", label: __("Address"), ph: __("Street, postcode city") },
      { f: "salutation", label: __("Salutation"), ph: "Sehr geehrte Frau …" },
      { f: "start", label: __("Start"), type: "date", w: "130px" }, { f: "end", label: __("End"), type: "date", w: "130px" },
      { f: "rent", label: __("Rent/mo."), type: "number", w: "90px" }, { f: "akonto", label: __("Advance/mo."), type: "number", w: "90px" },
      { f: "match_text", label: __("Payment keywords"), ph: __("Surname (comma = or, + = and)") }])}</div></div>

  <div class="card" id="fixedCard"><h3>${__("Fixed costs")}</h3>
    <p class="muted small">${__("Recurring costs without receipt, e.g. caretaker flat rate. “only …” = charged individually to one flat.")}</p>
    ${etable("fixed-costs", p.fixed_costs, [
      { f: "name", label: __("Label") }, { f: "category_id", label: __("Cost type"), type: "select", options: () => catOpts(p, "–"), w: "200px" },
      { f: "unit_id", label: __("Flat"), type: "select", options: () => unitOpts(p), w: "170px" },
      { f: "amount", label: __("Amount"), type: "number", w: "100px" },
      { f: "interval", label: __("per"), type: "select", options: () => [["jahr", __("Year")], ["monat", __("Month")]], w: "90px" },
      { f: "valid_from", label: __("valid from"), type: "date", w: "130px" }, { f: "valid_to", label: __("until"), type: "date", w: "130px" }])}</div>

  <div class="card" id="manualCard"><h3>${__("Manual costs")}</h3>
    <p class="muted small">${__("Individual costs without a Paperless receipt (e.g. own work, read-off amount). The date determines the period.")}</p>
    <div id="manualTable">…</div></div>`;
  drawStock(p);
  api(`/api/re/manual-costs?property_id=${p.id}`).then((rows) => {
    $("#manualTable").innerHTML = etable("manual-costs", rows.sort((a, b) => b.date.localeCompare(a.date)), [
      { f: "date", label: __("Date"), type: "date", w: "130px" }, { f: "description", label: __("Label") },
      { f: "category_id", label: __("Cost type"), type: "select", options: () => catOpts(p, "–"), w: "200px" },
      { f: "unit_id", label: __("Flat"), type: "select", options: () => unitOpts(p), w: "170px" },
      { f: "quantity", label: __("Quantity"), type: "number", w: "90px" }, { f: "amount", label: __("Amount"), type: "number", w: "100px" }]);
    if (RE.setupFocus) { $(RE.setupFocus === "manual" ? "#manualCard" : "#fixedCard").scrollIntoView({ behavior: "smooth" }); RE.setupFocus = null; }
  });
}

async function drawStock(p) {
  const rows = await api(`/api/properties/${p.id}/oil-ledger`);
  const box = $("#stockTable"); if (!box) return;
  const n2 = (v) => (v == null ? "–" : Number(v).toFixed(2));
  box.innerHTML = etable("heating-stock", rows, [
    { f: "kind", label: __("Type"), type: "select", options: () => [["ablesung", __("Reading")], ["lieferung", __("Delivery")]], w: "120px" },
    { f: "date", label: __("Date"), type: "date", w: "140px" },
    { f: "liters", label: __("Litres"), type: "static", w: "120px", render: (r) => `<input data-ent="heating-stock" data-id="${r.id}" data-f="liters" type="number" step="any"
        value="${r.liters ?? ""}" title="${r.kind === "lieferung" ? "gelieferte Liter" : "Tankstand"}" placeholder="${r.kind === "lieferung" ? "geliefert" : "Tankstand"}">` },
    { f: "price", label: "CHF / 100 l", type: "static", w: "130px", render: (r) => r.kind === "lieferung"
        ? `<span class="muted small">${r.unit_price != null ? n2(r.unit_price) : "–"}</span>`
        : r.price_source === "Durchschnitt"
          ? `<b class="small">${n2(r.price_used)}</b> <span class="muted small">Ø${r.price != null && Math.abs(r.price - r.price_used) > 0.005 ? ` ${__("(recorded {price} not used)", {price: n2(r.price)})}` : ""}</span>`
          : `<input data-ent="heating-stock" data-id="${r.id}" data-f="price" type="number" step="any" value="${r.price ?? ""}" placeholder="${__("Price opening stock")}" title="${__("Only needed as long as no average can be calculated from deliveries")}">` },
    { f: "amount", label: __("Amount"), type: "static", w: "120px", render: (r) => r.kind === "lieferung"
        ? `<input data-ent="heating-stock" data-id="${r.id}" data-f="amount" type="number" step="any" value="${r.amount ?? ""}" placeholder="${__("Invoice")}">`
        : `<span class="muted small">${r.price_used != null ? fmt(r.liters * r.price_used / 100) : ""}</span>` },
    { f: "avg", label: "Ø Tankinhalt", type: "static", w: "150px", render: (r) => `<span class="small">${r.avg_price != null ? n2(r.avg_price) + " / 100 l" : "–"}</span>
        ${r.kind === "ablesung" && r.consumed > 0 ? `<br><span class="muted small">${__("Consumption since last reading {consumed} l", {consumed: fmtN(r.consumed)})}</span>` : ""}` },
    { f: "note", label: __("Note"), ph: __("e.g. reading at end of period") }], { add: false });
  const last = rows.find((r) => r.avg_price != null);
  box.insertAdjacentHTML("afterbegin", last ? `<p class="small" style="margin:4px 0 8px">${__("Current average price of tank content:")} <b>${__("{avg_price} / 100 l", {avg_price: n2(last.avg_price)})}</b> <span class="muted">${__("(as of {date})", {date: fmtDate(last.date)})}</span></p>`
    : `<p class="small neg" style="margin:4px 0 8px">${__("No average yet: first reading with price (opening stock) or a delivery with litres")} <b>${__("and")}</b> ${__("amount.")}</p>`);
  box.insertAdjacentHTML("beforeend", `<div class="row"><button class="linkbtn" data-add="heating-stock" data-kind="ablesung">+ Ablesung</button>
    <button class="linkbtn" data-add="heating-stock" data-kind="lieferung">+ Lieferung</button></div>`);
}

// ------------------------------------------------------------ Projekte
async function renderProjects() {
  RE.projects = await api("/api/projects-overview");
  if (!RE.props.length) await loadRE().catch(() => {});
  const tagSel = (v) => [["", __("– no tag –")], ...S.meta.tags.map((t) => [t.id, t.name])];
  $("#prList").innerHTML = RE.projects.length ? RE.projects.map((pr) => {
    const pct = pr.budget ? Math.min(100, (pr.total / pr.budget) * 100) : 0;
    return `<div class="pr ${pr.id === RE.prId ? "active" : ""}" data-pr="${pr.id}">
      <div class="cat-top"><b>${esc(pr.name)}</b><span class="cat-amt"><b>${fmt(pr.total)}</b>${pr.budget ? " / " + fmt(pr.budget) : ""}</span></div>
      ${pr.budget ? `<div class="bar ${pr.total > pr.budget ? "over" : pct > 80 ? "warn" : ""}"><div style="width:${pct}%"></div></div>` : ""}
      <div class="muted small">${__("{count} item(s) · {status}{tag_id}{exclude_from_budget}", {count: pr.count, status: esc(pr.status), tag_id: pr.tag_id ? ` ${__("· tag “{tag_id}”", {tag_id: esc(tagName(pr.tag_id))})}` : "", exclude_from_budget: pr.exclude_from_budget ? (" " + __("· not in household budget")) : ""})}</div></div>`;
  }).join("") : `<div class="empty">${__("No projects yet.")}</div>`;
  if (RE.prId) await drawProject(); else { $("#prTitle").textContent = __("Select a project"); $("#prSearch").hidden = true; }
}
async function drawProject() {
  const r = await api(`/api/projects/${RE.prId}/items`), pr = r.project;
  $("#prTitle").textContent = pr.name; $("#prSearch").hidden = false;
  const tagOpts = [["", __("– no tag –")], ...S.meta.tags.map((t) => [t.id, t.name])];
  $("#prDetail").innerHTML = `
    <div class="formgrid" id="prForm">
      <label>Name<input name="name" value="${esc(pr.name)}"></label>
      <label>${__("Budget")}<input name="budget" type="number" step="any" value="${pr.budget ?? ""}"></label>
      <label>${__("Paperless tag")}<select name="tag_id">${tagOpts.map(([k, l]) => `<option value="${k}" ${String(k) === String(pr.tag_id ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
      <label>Status<select name="status">${[["aktiv", __("active")], ["geplant", __("planned")], ["abgeschlossen", __("completed")]].map(([v, l]) => `<option value="${v}" ${v === pr.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="check"><input name="exclude_from_budget" type="checkbox" ${pr.exclude_from_budget ? "checked" : ""}> ${__("not in household budget")}</label>
    </div>
    <table class="etable" style="margin-top:12px"><thead><tr><th style="width:84px">${__("Date")}</th><th>${__("Receipt / purpose")}</th><th class="num" style="width:110px">${__("Share")}</th><th class="num" style="width:100px">${__("Amount")}</th><th style="width:70px"></th></tr></thead>
    <tbody>${r.lines.map((l) => `<tr data-alloc="${l.alloc_id ?? ""}"><td>${fmtDate(l.date)}</td>
      <td><div class="it-purpose">${l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : esc(l.title)}</div><div class="it-sub">${esc(l.purpose || "")}${l.implicit ? (" " + __("· via tag")) : ""}</div></td>
      <td class="num">${l.implicit ? "100 %" : l.fixed_amount != null ? `<input class="pr-amt" type="number" step="0.05" value="${l.fixed_amount}" title="${__("Amount")}" style="width:90px">` : `<input class="pr-pct" type="number" step="1" value="${l.percent ?? 100}" title="${__("Percent")}" style="width:70px"> %`}</td>
      <td class="num"><b>${fmt(l.amount)}</b>${l.amount !== l.full_amount ? `<div class="muted small">${__("of {full_amount}", {full_amount: fmt(l.full_amount)})}</div>` : ""}</td>
      <td>${l.alloc_id ? `<button class="linkbtn danger pr-del">${__("remove")}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">${__("Nothing assigned yet.")}</td></tr>`}</tbody>
    <tfoot><tr><td colspan="3">Total</td><td class="num">${fmt(r.total)}</td><td></td></tr></tfoot></table>
    <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="linkbtn danger" id="prDel">${__("Delete project")}</button></div>`;
}
$("#prList").addEventListener("click", (e) => { const c = e.target.closest("[data-pr]"); if (c) { RE.prId = Number(c.dataset.pr); renderProjects(); } });
$("#prAdd").onclick = async () => {
  const r = await openDialog({ title: __("New project"), label: "Name", ok: __("Create") });
  if (!r || !r.value) return;
  const pr = await api("/api/re/projects", { method: "POST", body: JSON.stringify({ name: r.value, status: "aktiv" }) });
  RE.prId = pr.id; renderProjects();
};
$("#prSearch").onclick = () => { const pr = RE.projects.find((x) => x.id === RE.prId); openSearch({ type: "project", id: RE.prId, name: pr?.name }); };
$("#prDetail").addEventListener("change", async (e) => {
  const el = e.target;
  if (el.closest("#prForm")) {
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number" || el.name === "tag_id") v = num(v);
    await api(`/api/re/projects/${RE.prId}`, { method: "PUT", body: JSON.stringify({ [el.name]: v }) }); toast(__("Saved")); renderProjects(); return;
  }
  const aid = el.closest("tr")?.dataset.alloc; if (!aid) return;
  const body = el.classList.contains("pr-pct") ? { percent: num(el.value) } : { amount: num(el.value) };
  await api(`/api/allocations/${aid}`, { method: "PUT", body: JSON.stringify(body) }); toast(__("Saved")); renderProjects();
});
$("#prDetail").addEventListener("click", async (e) => {
  if (e.target.classList.contains("pr-del")) { await api(`/api/allocations/${e.target.closest("tr").dataset.alloc}`, { method: "DELETE" }); renderProjects(); }
  if (e.target.id === "prDel" && confirm(__("Delete project? Assignments are removed, receipts stay."))) {
    await api(`/api/re/projects/${RE.prId}`, { method: "DELETE" }); RE.prId = null; renderProjects();
  }
});

// ------------------------------------------------------------ Suche: Belege einem Ziel zuordnen
let seTarget = null, seTimer = null;
function openSearch(target) {
  seTarget = target;
  $("#seTitle").textContent = __("Assign receipts: {name}", {name: target.name || ""});
  $("#seInput").value = ""; $("#seResults").innerHTML = `<div class="muted small">${__("Enter a search term (e.g. merchant, invoice title, content).")}</div>`;
  $("#searchDlg").showModal(); $("#seInput").focus();
}
$("#seClose").onclick = () => { $("#searchDlg").close(); if (S.view === "realestate") renderRE(); if (S.view === "projects") renderProjects(); };
$("#seInput").oninput = () => {
  clearTimeout(seTimer);
  seTimer = setTimeout(async () => {
    const q = $("#seInput").value.trim(); if (q.length < 2) return;
    const res = await api(`/api/doc-search?q=${encodeURIComponent(q)}`).catch((e) => { toast(e.message, true); return []; });
    $("#seResults").innerHTML = res.length ? res.map((d, i) => {
      const already = (d.allocations || []).some((a) => a.target_type === seTarget.type && a.target_id === seTarget.id);
      return `<div class="invitem" data-i="${i}"><span><span class="srcb ${d.kind === "doc" ? "Beleg" : "Bank"}">${d.kind === "doc" ? __("Receipt") : "Bank"}</span>
        ${fmtDate(d.date)} · <b>${esc(d.purpose && d.kind === "doc" ? d.purpose : d.title)}</b> <span class="muted small">${esc(d.kind === "doc" ? d.title : "")}</span></span>
        <span class="row"><b class="num">${fmt(d.amount || 0)}</b>${already ? `<span class="muted small">${__("✓ assigned")}</span>` : `<button class="se-add">ganz</button><button class="se-part">${__("Part …")}</button>`}</span></div>`;
    }).join("") : `<div class="empty">${__("Nothing found.")}</div>`;
    $("#seResults").onclick = async (e) => {
      const row = e.target.closest("[data-i]"); if (!row) return;
      const d = res[Number(row.dataset.i)];
      if (e.target.classList.contains("se-add")) {
        await api("/api/allocations", { method: "POST", body: JSON.stringify({ source_type: d.kind, source_id: d.id, target_type: seTarget.type, target_id: seTarget.id, percent: 100 }) });
        e.target.parentElement.innerHTML = `<b class="num">${fmt(d.amount || 0)}</b><span class="muted small">${__("✓ assigned")}</span>`; toast(__("Assigned"));
      } else if (e.target.classList.contains("se-part")) {
        openAlloc({ kind: d.kind, id: d.id, title: d.purpose || d.title, amount: d.amount, allocations: d.allocations || [] }, `${seTarget.type}:${seTarget.id}`);
      }
    };
  }, 300);
};

// ------------------------------------------------------------ Assign dialog (from expenses, overview, reconciliation)
let alItem = null;
async function openAlloc(item, preselect = null) {
  if (!RE.props.length && !RE.projects.length) await loadRE().catch(() => {});
  alItem = item;
  $("#alSub").textContent = `${item.title || ""} · ${fmt(item.amount || 0)}`;
  const ex = (item.allocations || []);
  $("#alExisting").innerHTML = ex.length ? `<h4>${__("Existing")}</h4>` + ex.map((a) => `<div class="invitem"><span>${a.target_type === "property" ? "🏠" : "📁"} ${esc(a.target_name)}
      <span class="muted small">${a.implicit ? __("via Paperless tag") : a.amount != null ? __("Amount") : `${a.percent} %`}${a.excludes_budget ? (" " + __("· not in household budget")) : ""}</span></span>
      <span class="row"><b class="num">${fmt(a.value)}</b>${a.id ? `<button class="linkbtn danger" data-aldel="${a.id}">${__("remove")}</button>` : ""}</span></div>`).join("") : "";
  const opts = [...RE.props.map((p) => [`property:${p.id}`, `🏠 ${p.name}`]), ...RE.projects.map((p) => [`project:${p.id}`, `📁 ${p.name}`])];
  $("#alTarget").innerHTML = opts.length ? opts.map(([k, l]) => `<option value="${k}" ${k === preselect ? "selected" : ""}>${esc(l)}</option>`).join("") : `<option value="">${__("– create a building or project first –")}</option>`;
  const rest = Math.max(0, 100 - ex.filter((a) => !a.implicit && a.percent != null && a.amount == null).reduce((s, a) => s + a.percent, 0));
  $("#alMode").value = "percent"; $("#alValue").value = rest || 100; $("#alQty").value = ""; $("#alNote").value = "";
  alTargetChanged();
  $("#allocDlg").showModal();
}
function alTargetChanged() {
  const [tt, tid] = ($("#alTarget").value || ":").split(":");
  const p = tt === "property" ? RE.props.find((x) => x.id === Number(tid)) : null;
  $("#alPropFields").hidden = !p; $("#alQtyWrap").hidden = !p;
  if (p) {
    $("#alCat").innerHTML = catOpts(p, __("– automatic / not allocatable –")).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
    $("#alUnit").innerHTML = unitOpts(p).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  }
}
$("#alTarget").onchange = alTargetChanged;
$("#alClose").onclick = () => { $("#allocDlg").close(); render(); };
$("#alExisting").addEventListener("click", async (e) => {
  const id = e.target.dataset.aldel; if (!id) return;
  await api(`/api/allocations/${id}`, { method: "DELETE" });
  alItem.allocations = alItem.allocations.filter((a) => String(a.id) !== id); openAlloc(alItem);
});
$("#alSave").onclick = async () => {
  const [tt, tid] = ($("#alTarget").value || ":").split(":"); if (!tid) return;
  const body = { source_type: alItem.kind === "bank" || alItem.kind === "tx" ? "tx" : "doc", source_id: alItem.id, target_type: tt, target_id: Number(tid),
    note: $("#alNote").value || null, [$("#alMode").value]: num($("#alValue").value) };
  if (tt === "property") { body.category_id = num($("#alCat").value); body.unit_id = num($("#alUnit").value); body.quantity = num($("#alQty").value); }
  try {
    await api("/api/allocations", { method: "POST", body: JSON.stringify(body) });
    toast(__("Assigned")); $("#allocDlg").close(); render();
  } catch (err) { toast(err.message, true); }
};
const allocBadges = (d) => (d.allocations || []).length
  ? `<span class="allocs">${d.allocations.map((a) => `<span class="allocb" title="${a.implicit ? __("via Paperless tag") : ""}">${a.target_type === "property" ? "🏠" : "📁"} ${esc(a.target_name)}${a.value !== (d.amount_full ?? d.amount) ? " " + fmtPos(a.value) : ""}</span>`).join("")}</span>` : "";
