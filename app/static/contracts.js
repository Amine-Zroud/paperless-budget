"use strict";
/* Contracts & loans – uses helpers from app.js ($, api, esc, fmt, fmtDate, toast, openDialog, S) */

const CT = { data: null, id: null, detail: null, showEnded: false };
const IV_LABEL = { monat: __("monthly"), quartal: __("quarterly"), halbjahr: __("half-yearly"), jahr: __("yearly"), einmalig: __("one-off") };
const ctNum = (v) => (v === "" || v == null ? null : Number(v));
const sel = (opts, v) => opts.map(([k, l]) => `<option value="${esc(k ?? "")}" ${String(k ?? "") === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");

function noticeBadge(c) {
  const lim = CT.data?.notice_days ?? 120, urg = CT.data?.badge_days ?? 30;
  if (c.notice_days == null || c.notice_days < 0 || c.notice_days > lim) return "";
  return `<span class="ct-notice ${c.notice_days <= urg ? "urgent" : ""}" title="${__("Cancel by {notice_by} (end of term {term_end})", {notice_by: fmtDate(c.notice_by), term_end: fmtDate(c.term_end)})}">${__("cancellable until {notice_by2}", {notice_by2: fmtDate(c.notice_by)})}</span>`;
}

async function renderContracts() {
  CT.data = await api("/api/contracts-overview");
  const d = CT.data, t = d.totals;
  $("#ctKpis").innerHTML = `
    <div class="kpi"><div class="kpi-label">${__("Contracts per month")}</div><div class="kpi-value">${fmt(t.contracts_monthly)}</div><div class="kpi-sub">${__("{contracts_yearly} per year", {contracts_yearly: fmt(t.contracts_yearly)})}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Loans per month")}</div><div class="kpi-value">${fmt(t.loans_monthly)}</div><div class="kpi-sub">${__("{loans_yearly} per year", {loans_yearly: fmt(t.loans_yearly)})}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Outstanding loans")}</div><div class="kpi-value">${fmt(t.loans_balance)}</div><div class="kpi-sub">${__("Interest approx. {loans_interest_year} / year", {loans_interest_year: fmt(t.loans_interest_year)})}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Paid {getFullYear}", {getFullYear: new Date().getFullYear()})}</div><div class="kpi-value">${fmt(t.paid_ytd)}</div><div class="kpi-sub">${__("from matched bank transactions")}</div></div>`;
  $("#ctNotices").innerHTML = d.notices.length ? `<div class="card hint ct-noticebar"><b>${__("Cancellation deadlines in the next {notice_days} days:", {notice_days: d.notice_days ?? 120})}</b> ${d.notices.map((n) =>
    `<a href="#" data-ct="${n.id}">${esc(n.name)}</a> ${__("until {notice_by}", {notice_by: fmtDate(n.notice_by)})} <span class="muted small">${__("({notice_days} days)", {notice_days: n.notice_days})}</span>`).join(" · ")}</div>` : "";
  const vis = d.items.filter((c) => CT.showEnded || (c.active && !c.ended));
  const item = (c) => `<div class="ct ${c.id === CT.id ? "active" : ""} ${c.active && !c.ended ? "" : "off"}" data-ct="${c.id}">
      <div class="cat-top"><b>${esc(c.name)}</b><span class="cat-amt">${c.monthly != null ? `<b>${fmt(c.monthly)}</b><span class="muted small"> ${__("/mo.")}</span>` : `<span class="muted small">${__("no amount set")}</span>`}</span></div>
      <div class="ct-sub muted small">${c.category ? `<span class="ct-cat">${esc(__(c.category))}</span>` : ""}${esc(c.provider || "")}
        ${c.per_interval != null && c.interval !== "monat" ? ` · ${fmt(c.per_interval)} ${IV_LABEL[c.interval] || ""}` : ""}
        ${c.kind === "kredit" && c.balance != null ? ` ${__("· remaining {balance}", {balance: fmt(c.balance)})}` : ""}
        ${c.ended ? __(" · ended") : !c.active ? (" " + __("· inactive")) : ""} ${noticeBadge(c)}</div></div>`;
  const cs = vis.filter((c) => c.kind === "vertrag"), ls = vis.filter((c) => c.kind === "kredit");
  $("#ctList").innerHTML = cs.length ? cs.map(item).join("") : `<div class="empty">${__("No contracts yet.")}</div>`;
  $("#ctLoans").innerHTML = ls.length ? ls.map(item).join("") : `<div class="empty">${__("No loans yet.")}</div>`;
  const badge = d.notices.filter((n) => n.notice_days <= (d.badge_days ?? 30)).length;
  $("#ctBadge").textContent = badge; $("#ctBadge").hidden = !badge;
  if (CT.id && d.items.some((c) => c.id === CT.id)) await drawContract();
  else { CT.id = null; $("#ctTitle").textContent = __("Select a contract"); }
}

async function drawContract() {
  const r = await api(`/api/contracts/${CT.id}`);
  CT.detail = r;
  const c = r.contract, loan = c.kind === "kredit", d = CT.data;
  $("#ctTitle").textContent = (loan ? "🏦 " : c.kind === "abo" ? "🔁 " : "📄 ") + c.name;
  const corr = [["", __("– none selected –")], ...S.meta.correspondents.map((x) => [x.id, x.name])];
  const tags = [["", __("– no tag –")], ...S.meta.tags.map((x) => [x.id, x.name])];
  const cats = [["", "–"], ...(loan ? d.loan_categories : c.kind === "abo" ? (d.abo_categories || []) : d.categories).map((x) => [x, __(x)])];
  const ivs = d.intervals.map((k) => [k, IV_LABEL[k]]);
  const fact = (l, v) => `<div><div class="l">${l}</div><div class="v">${v}</div></div>`;
  const facts = [
    fact(__("Current"), c.per_interval != null ? `${fmt(c.per_interval)} <span class="muted small">${IV_LABEL[c.interval] || ""}</span>` : "–"),
    fact(__("per month"), c.monthly != null ? fmt(c.monthly) : "–"),
    fact(__("per year"), c.yearly != null ? fmt(c.yearly) : "–"),
    ...(loan ? [fact(__("Outstanding balance"), c.balance != null ? fmt(c.balance) : "–"), fact(__("Interest / year"), `${fmt(c.interest_year)} <span class="muted small">${c.interest_rate || 0} %</span>`),
      fact(__("Repayment / year"), fmt(c.amortization_year))] : []),
    fact(__("Next payment"), c.next_due ? fmtDate(c.next_due) : "–"),
    fact(__("Term until"), c.term_end ? fmtDate(c.term_end) : __("open-ended")),
    fact(__("Cancel by"), c.notice_by ? `${fmtDate(c.notice_by)}${c.notice_days != null && c.notice_days >= 0 ? ` <span class="muted small">(${c.notice_days} T.)</span>` : ""}` : "–"),
    fact(__("Paid {getFullYear}", {getFullYear: new Date().getFullYear()}), `${fmt(c.paid_ytd)} <span class="muted small">${__("/ exp. {expected_ytd}", {expected_ytd: fmt(c.expected_ytd)})}</span>`),
  ].join("");
  const vcols = loan ? `<th class="num" style="width:80px">${__("Interest %")}</th><th class="num" style="width:100px">${__("Repayment/interval")}</th>` : "";
  const vrows = r.versions.map((v) => `<tr data-v="${v.id}">
      <td><input type="date" data-vf="valid_from" value="${esc(v.valid_from || "")}"></td>
      <td><input type="number" step="0.05" data-vf="amount" value="${v.amount ?? ""}" placeholder="${loan && v.per_interval != null ? fmt2(v.per_interval) : ""}"></td>
      <td><select data-vf="interval">${sel(ivs, v.interval)}</select></td>
      ${loan ? `<td><input type="number" step="0.01" data-vf="interest_rate" value="${v.interest_rate ?? ""}"></td><td><input type="number" step="any" data-vf="amortization" value="${v.amortization ?? ""}"></td>` : ""}
      <td class="num muted small">${v.monthly != null ? fmt(v.monthly) : ""}</td>
      <td>${v.doc_url ? `<a href="${esc(v.doc_url)}" target="_blank" rel="noopener">${__("Receipt ↗")}</a>` : `<span class="muted small">–</span>`}</td>
      <td><input data-vf="note" value="${esc(v.note || "")}" placeholder="${__("e.g. premium increase")}"></td>
      <td><button class="linkbtn danger" data-vdel="${v.id}">${__("delete")}</button></td></tr>`).join("")
    || `<tr><td colspan="${loan ? 9 : 7}" class="muted small">${__("No version yet – use “+ Version” to record the amount.")}</td></tr>`;
  const prow = (p) => `<tr><td>${fmtDate(p.date)}</td><td><div class="it-purpose">${esc(p.merchant || p.text.slice(0, 50))}</div><div class="it-sub" title="${esc(p.text)}">${esc(p.text.slice(0, 90))}</div></td>
      <td class="num"><b>${fmt(-p.amount)}</b></td><td class="muted small">${p.auto ? __("automatic") : __("assigned manually")}${p.doc_url ? ` · <a href="${esc(p.doc_url)}" target="_blank" rel="noopener">${__("Receipt")}</a>` : ""}</td>
      <td><button class="linkbtn danger" data-pdel="${p.tx_id}">${__("remove")}</button></td></tr>`;
  $("#ctDetail").classList.remove("muted", "small");
  $("#ctDetail").innerHTML = `
    <div class="ct-facts">${facts}</div>
    <div class="formgrid" id="ctForm">
      <label>Name<input name="name" value="${esc(c.name)}"></label>
      <label>${__("Category")}<select name="category">${sel(cats, c.category)}</select></label>
      <label>${loan ? __("Bank / lender") : __("Provider")}<input name="provider" value="${esc(c.provider || "")}"></label>
      <label>${loan ? __("Loan/contract no.") : __("Contract/policy no.")}<input name="contract_no" value="${esc(c.contract_no || "")}"></label>
      ${loan ? `<label>${__("Loan amount (initial)")}<input name="principal" type="number" step="any" value="${c.principal ?? ""}"></label>` : ""}
      <label>${__("Start")}<input name="start" type="date" value="${esc(c.start || "")}"></label>
      <label>${__("End (fixed)")}<input name="end" type="date" value="${esc(c.end || "")}"></label>
      <label>${__("Notice period (months)")}<input name="notice_months" type="number" step="1" value="${c.notice_months ?? ""}"></label>
      <label>${__("Renews by (months)")}<input name="renew_months" type="number" step="1" value="${c.renew_months ?? ""}" placeholder="z.B. 12"></label>
      <label>${__("Paperless correspondent")}<select name="correspondent_id">${sel(corr, c.correspondent_id)}</select></label>
      <label>${__("Paperless tag")}<select name="tag_id">${sel(tags, c.tag_id)}</select></label>
      <label title="${__("Comma = or, + = and, e.g. 'Helsana, Krankenkasse+Prämie'")}">${__("Bank transaction keywords")}<input name="match_text" value="${esc(c.match_text || "")}" placeholder="${__("e.g. Helsana")}"></label>
      <label class="check"><input name="active" type="checkbox" ${c.active ? "checked" : ""}> ${__("active")}</label>
      <label style="grid-column:1/-1">${__("Note")}<textarea name="note" rows="2">${esc(c.note || "")}</textarea></label>
    </div>

    <div class="ct-section">
      <h4>${__("Versions / terms")} <button class="linkbtn" id="ctAddVersion">+ Version</button></h4>
      <div class="tablewrap"><table class="etable ${loan ? "loan" : ""}" id="ctVersions"><thead><tr><th style="width:140px">${__("valid from")}</th><th class="num" style="width:110px">${__("Amount")}</th><th style="width:130px">${__("Interval")}</th>${vcols}<th class="num" style="width:90px">${__("/ month")}</th><th style="width:70px">${__("Receipt")}</th><th>${__("Note")}</th><th></th></tr></thead>
      <tbody>${vrows}</tbody></table></div>
      ${loan ? `<p class="muted small">${__("Leave the amount empty = calculated from interest on the outstanding balance + repayment.")}</p>` : ""}
    </div>

    ${loan && r.schedule.length ? `<div class="ct-section"><h4>${__("Outstanding balance per plan")}</h4><table class="etable"><thead><tr>${r.schedule.map((s) => `<th class="num">${__("End {year}", {year: s.year})}</th>`).join("")}</tr></thead>
      <tbody><tr>${r.schedule.map((s) => `<td class="num">${fmt(s.balance_end)}</td>`).join("")}</tr></tbody></table></div>` : ""}

    <div class="ct-section">
      <h4>${__("Payments per year")}</h4>
      <table class="etable"><thead><tr><th>${__("Year")}</th><th class="num">${__("Payments")}</th><th class="num">${__("paid")}</th><th class="num">${__("expected")}</th><th class="num">${__("Difference")}</th></tr></thead>
      <tbody>${r.per_year.map((y) => { const diff = y.paid - y.expected; return `<tr><td>${y.year}</td><td class="num">${y.count}</td><td class="num">${fmt(y.paid)}</td><td class="num">${fmt(y.expected)}</td>
        <td class="num ${Math.abs(diff) > 1 ? "warn" : ""}">${Math.abs(diff) < 0.01 ? "–" : fmt(diff)}</td></tr>`; }).join("")}</tbody></table>
    </div>

    <div class="ct-section">
      <h4>${__("Payments (bank transactions)")} <button class="linkbtn" id="ctFindTx">${__("+ Assign payment")}</button></h4>
      <div id="ctTxSearch" hidden><div class="ct-search"><input id="ctTxQ" type="search" placeholder="${__("Search booking text …")}"></div><div id="ctTxRes" class="seresults"></div></div>
      ${c.match_text ? "" : `<p class="muted small">${__("Tip: enter bank transaction keywords – then payments from the bank statements are matched automatically.")}</p>`}
      <div class="tablewrap"><table class="etable"><thead><tr><th style="width:90px">${__("Date")}</th><th>${__("Transaction")}</th><th class="num" style="width:100px">${__("Amount")}</th><th style="width:130px"></th><th style="width:80px"></th></tr></thead>
      <tbody>${r.payments.slice(0, 60).map(prow).join("") || `<tr><td colspan="5" class="muted small">${__("No payments matched yet.")}</td></tr>`}</tbody></table></div>
    </div>

    <div class="ct-section">
      <h4>${__("Documents from Paperless")}</h4>
      <div id="ctDocs" class="muted small">${c.correspondent_id || c.tag_id ? __("Loading …") : __("Choose a correspondent or tag so the contract, policies and invoices appear here.")}</div>
    </div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="linkbtn danger" id="ctDel">${__("Delete {loan4}", {loan4: loan ? __("Loan") : __("Contract")})}</button></div>`;
  loadContractDocs(c);
}

async function loadContractDocs(c) {
  if (!c.correspondent_id && !c.tag_id && !CT.detail.versions.some((v) => v.doc_id)) return;
  try {
    const docs = await api(`/api/contracts/${c.id}/docs`);
    if (CT.id !== c.id) return;
    $("#ctDocs").classList.remove("muted", "small");
    const row = (x) => `<div class="invitem"><span>${fmtDate(x.date)} · <a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b></a>
        <span class="muted small">${esc([x.type, x.purpose].filter(Boolean).join(" · "))}</span></span>
        <span class="row">${x.amount != null ? `<b class="num">${fmt(x.amount)}</b>` : ""}${x.linked ? `<span class="muted small">✓ Version</span>` : `<button class="linkbtn" data-vdoc="${x.id}" title="${__("Adopt date and amount as a new version")}">${__("→ as version")}</button>`}</span></div>`;
    const first = docs.slice(0, 8), more = docs.slice(8);
    $("#ctDocs").innerHTML = docs.length ? first.map(row).join("") + (more.length
      ? `<details class="small"><summary class="linkbtn">${__("{length} more documents", {length: more.length})}</summary>${more.map(row).join("")}</details>` : "")
      : `<div class="empty">${__("No documents found.")}</div>`;
  } catch (e) { $("#ctDocs").textContent = e.message; }
}

async function newContract(kind) {
  const r = await openDialog({ title: kind === "kredit" ? __("New loan") : __("New contract"), label: "Name", ok: __("Create"),
    suggestions: kind === "kredit" ? [__("Mortgage"), __("Car lease"), __("Personal loan")] : [__("Health insurance"), __("Home contents / liability insurance"), __("Car insurance"), __("Mobile plan"), "Internet/TV", __("Electricity"), "Streaming"] });
  if (!r || !r.value) return;
  const c = await api("/api/re/contracts", { method: "POST", body: JSON.stringify({ kind, name: r.value, active: 1, start: new Date().toISOString().slice(0, 10),
    notice_months: kind === "kredit" ? null : 3, renew_months: kind === "kredit" ? null : 12 }) });
  await api("/api/re/contract-versions", { method: "POST", body: JSON.stringify({ contract_id: c.id, valid_from: c.start, interval: kind === "kredit" ? "quartal" : "monat" }) });
  CT.id = c.id; renderContracts();
}
$("#ctAddContract").onclick = () => newContract("vertrag");
$("#ctAddLoan").onclick = () => newContract("kredit");
$("#ctShowEnded").onchange = (e) => { CT.showEnded = e.target.checked; renderContracts(); };
$("#view-contracts").addEventListener("click", (e) => {
  const c = e.target.closest("[data-ct]"); if (!c) return;
  e.preventDefault(); CT.id = Number(c.dataset.ct); renderContracts();
});

$("#ctDetail").addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.closest("#ctForm")) {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number" || /_id$/.test(el.name)) v = ctNum(v);
      await api(`/api/re/contracts/${CT.id}`, { method: "PUT", body: JSON.stringify({ [el.name]: v }) });
    } else if (el.dataset.vf) {
      let v = el.value;
      if (el.type === "number") v = ctNum(v);
      await api(`/api/re/contract-versions/${el.closest("tr").dataset.v}`, { method: "PUT", body: JSON.stringify({ [el.dataset.vf]: v }) });
    } else return;
    toast(__("Saved")); renderContracts();
  } catch (err) { toast(err.message, true); }
});

$("#ctDetail").addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.id === "ctAddVersion") {
      const last = CT.detail.versions[CT.detail.versions.length - 1] || {};
      await api("/api/re/contract-versions", { method: "POST", body: JSON.stringify({ contract_id: CT.id, valid_from: new Date().toISOString().slice(0, 10),
        amount: last.amount ?? null, interval: last.interval || "monat", interest_rate: last.interest_rate ?? null, amortization: last.amortization ?? null }) });
      renderContracts();
    } else if (t.dataset.vdel) {
      await api(`/api/re/contract-versions/${t.dataset.vdel}`, { method: "DELETE" }); renderContracts();
    } else if (t.dataset.vdoc) {
      await api(`/api/contracts/${CT.id}/version-from-doc`, { method: "POST", body: JSON.stringify({ doc_id: Number(t.dataset.vdoc) }) });
      toast(__("Version created from receipt – check interval")); renderContracts();
    } else if (t.dataset.pdel) {
      await api(`/api/contract-payments/${t.dataset.pdel}`, { method: "DELETE" }); renderContracts();
    } else if (t.id === "ctFindTx") {
      $("#ctTxSearch").hidden = false;
      const c = CT.detail.contract;
      $("#ctTxQ").value = (c.match_text || c.provider || c.name || "").split(/[,+]/)[0].trim();
      ctTxSearch(); $("#ctTxQ").focus();
    } else if (t.dataset.txadd) {
      await api("/api/contract-payments", { method: "POST", body: JSON.stringify({ tx_id: Number(t.dataset.txadd), contract_id: CT.id }) });
      toast(__("Assigned")); renderContracts();
    } else if (t.id === "ctDel") {
      if (!confirm(__("Really delete? Versions and assignments are removed; bank transactions and receipts stay."))) return;
      await api(`/api/contracts/${CT.id}`, { method: "DELETE" }); CT.id = null; renderContracts();
    }
  } catch (err) { toast(err.message, true); }
});

let ctTimer = null;
$("#ctDetail").addEventListener("input", (e) => { if (e.target.id === "ctTxQ") { clearTimeout(ctTimer); ctTimer = setTimeout(ctTxSearch, 300); } });
async function ctTxSearch() {
  const q = $("#ctTxQ").value.trim();
  const rows = await api(`/api/contracts/${CT.id}/tx-search?q=${encodeURIComponent(q)}`);
  $("#ctTxRes").innerHTML = rows.length ? rows.map((t) => `<div class="invitem"><span>${fmtDate(t.date)} · <b>${esc(t.merchant || t.text.slice(0, 50))}</b> <span class="muted small">${esc(t.text.slice(0, 70))}</span></span>
      <span class="row"><b class="num">${fmt(-t.amount)}</b><button data-txadd="${t.id}">${__("assign")}</button></span></div>`).join("")
    : `<div class="empty">${__("No free debits found{q}.", {q: q ? ` ${__("for “{q}”", {q: esc(q)})}` : ""})}</div>`;
}
