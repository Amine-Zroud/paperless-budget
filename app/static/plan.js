"use strict";
/* Left of salary: income − expenses − still-due contract payments − planned orders */

const PL = { data: null, editId: null };

async function renderPlan() {
  if (typeof canSee === "function" && !canSee("income")) { $("#planCard").hidden = true; return; }   // pointless without the income permission
  $("#planCard").hidden = false;
  let d;
  try { d = await api(`/api/plan?month=${S.month}`); } catch (e) { $("#planBody").textContent = e.message; return; }
  PL.data = d;
  const inMonth = new Set(d.orders_in_month);
  const line = (label, val, cls = "", sub = "") => `<div class="pl-line ${cls}"><span>${label}${sub ? ` <span class="muted small">${sub}</span>` : ""}</span><b class="num">${val}</b></div>`;
  const rec = d.recurring;
  const recRow = (r) => `<div class="invitem ${r.status === "bezahlt" ? "pl-paid" : ""}"><span>${fmtDate(r.due)} · <a href="#" data-goct="${r.contract_id}">${esc(r.name)}</a>
      <span class="muted small">${r.kind === "kredit" ? __("Loan") : esc(__(r.category || "Contract"))}${r.interval && r.interval !== "monat" ? " · " + esc(IV_LABEL[r.interval] || r.interval) : ""}</span></span>
      <span class="row">${r.status === "bezahlt" ? `<span class="pill">${__("paid {paid_date}", {paid_date: fmtDate(r.paid_date)})}</span>` : r.overdue ? `<span class="pill warn">${__("overdue?")}</span>` : `<span class="pill grey">${__("open")}</span>`}
      <b class="num">${r.amount != null ? fmt(r.amount) : "–"}</b></span></div>`;
  const ordRow = (o) => `<div class="invitem ${inMonth.has(o.id) ? "" : "pl-later"}" data-oid="${o.id}"><span>${o.source === "paperless" ? `<span class="srcb Beleg">Mail</span>` : `<span class="srcb Manuell">${__("Manual")}</span>`}
      <b>${esc(o.merchant)}</b> <span class="muted small">${__("{description} · ordered {date} · expected {expected}{id3}", {description: esc(o.description && o.description !== o.merchant ? o.description : ""), date: fmtDate(o.date), expected: fmtDate(o.expected), id3: inMonth.has(o.id) ? "" : " " + __("(later)")})}</span>
      ${o.url ? `<a href="${esc(o.url)}" target="_blank" rel="noopener" class="small">↗</a>` : ""}</span>
      <span class="row">${o.amount != null ? `<b class="num">${fmt(o.amount)}</b>` : `<span class="pill warn">${__("Amount?")}</span>`}
      <button class="linkbtn" data-odone="${o.id}" title="${__("Invoice/debit has arrived")}">${__("done")}</button><button class="linkbtn" data-oedit="${o.id}">${__("edit")}</button></span></div>`;
  const pastNote = d.past ? `<p class="muted small">${__("Past month – open planned items are no longer included.")}</p>` : "";
  $("#planBody").classList.remove("muted", "small");
  $("#planBody").innerHTML = `
    <div class="pl-grid">
      <div class="pl-calc">
        ${line(__("Income"), fmt(d.income), "", !d.income ? `${__("– under")} <a href="#" data-goto="income">${__("Income")}</a> ${__("record the salary")}` : d.income_expected ? __("of which {income_expected} expected", {income_expected: fmt(d.income_expected)}) : "")}
        ${line(__("− already spent"), fmt(d.spent))}
        ${line(__("− still due"), fmt(d.due_open), "", __("{length} contract payment(s)", {length: rec.filter((r) => r.status === "offen").length}))}
        ${line(__("− planned"), fmt(d.orders), "", __("{length} order(s)", {length: d.orders_in_month.length}))}
        <div class="pl-line pl-total"><span>${__("freely available")}</span><b class="num ${d.free >= 0 ? "pos" : "neg"}">${fmt(d.free)}</b></div>
        ${pastNote}
      </div>
      <div class="pl-lists">
        <h4>${__("Contracts & loans this month")}</h4>
        ${rec.length ? rec.map(recRow).join("") : `<div class="muted small">${__("No payments due – contracts under")} <a href="#" data-goto="contracts">${__("Contracts")}</a> ${__("tab.")}</div>`}
        <h4 style="margin-top:14px">${__("Planned")}</h4>
        ${d.open_orders.length ? d.open_orders.map(ordRow).join("") : `<div class="muted small">${__("Nothing planned. {ngen}", {ngen: d.order_tag_found ? "" : __("For automatic planned items, create the tag “{order_tag}” in Paperless and attach it to order confirmations via a mail rule.", {order_tag: esc(d.order_tag)})})}</div>`}
        ${d.recent_done.length ? `<details class="small" style="margin-top:6px"><summary class="muted">${__("Recently done ({length})", {length: d.recent_done.length})}</summary>${d.recent_done.map((o) => `<div class="invitem pl-paid"><span>${esc(o.merchant)} <span class="muted small">${esc(o.done_title || "")}</span></span>
          <span class="row"><b class="num">${o.amount != null ? fmt(o.amount) : ""}</b><button class="linkbtn" data-oreopen="${o.id}">${__("reopen")}</button></span></div>`).join("")}</details>` : ""}
      </div>
    </div>`;
}

function openOrder(o = null) {
  PL.editId = o?.id ?? null;
  const f = $("#orderForm"), today = new Date().toISOString().slice(0, 10);
  $("#odTitle").textContent = o ? __("Edit planned item") : __("Plan an expense");
  f.merchant.value = o?.merchant || ""; f.description.value = o?.description || ""; f.amount.value = o?.amount ?? "";
  f.date.value = o?.date || today; f.expected.value = o?.expected || ""; f.note.value = o?.note || "";
  $("#odDelete").hidden = !o;
  const names = new Set([...(PL.data?.open_orders || []).map((x) => x.merchant), ...S.meta.correspondents.map((c) => c.name)]);
  $("#odMerchants").innerHTML = [...names].map((n) => `<option value="${esc(n)}">`).join("");
  $("#orderDlg").showModal(); f.merchant.focus();
}
$("#planAdd").onclick = () => openOrder();
$("#orderDlg").addEventListener("close", async () => {
  if ($("#orderDlg").returnValue !== "ok") return;
  const f = $("#orderForm");
  const body = { merchant: f.merchant.value.trim(), description: f.description.value || null, amount: f.amount.value === "" ? null : Number(f.amount.value),
    date: f.date.value || null, expected: f.expected.value || null, note: f.note.value || null };
  try {
    if (PL.editId) await api(`/api/orders/${PL.editId}`, { method: "PUT", body: JSON.stringify(body) });
    else await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
    toast(__("Planned")); renderPlan();
  } catch (e) { toast(e.message, true); }
});
$("#odDelete").onclick = async () => {
  if (!PL.editId || !confirm(__("Delete planned item?"))) return;
  await api(`/api/orders/${PL.editId}`, { method: "DELETE" }); $("#orderDlg").close(); renderPlan();
};
$("#planBody").addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.odone) { await api(`/api/orders/${t.dataset.odone}`, { method: "PUT", body: JSON.stringify({ status: "done" }) }); toast(__("Done")); renderPlan(); }
    else if (t.dataset.oreopen) { await api(`/api/orders/${t.dataset.oreopen}`, { method: "PUT", body: JSON.stringify({ status: "open" }) }); renderPlan(); }
    else if (t.dataset.oedit) openOrder(PL.data.open_orders.find((o) => o.id === Number(t.dataset.oedit)));
    else if (t.dataset.goct) { e.preventDefault(); CT.id = Number(t.dataset.goct); setView("contracts"); }
  } catch (err) { toast(err.message, true); }
});
