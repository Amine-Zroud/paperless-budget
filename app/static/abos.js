"use strict";
/* Subscriptions: contracts with kind="abo" plus suggestions from recurring bank debits */

const AB = { data: null, sugg: [] };
const AB_IV = { monat: __("monthly"), quartal: __("quarterly"), halbjahr: __("half-yearly"), jahr: __("yearly") };
const AB_GUESS = [["Streaming", /netflix|disney|prime video|zattoo|teleboy|blue tv|sky|dazn|youtube/i], ["Music", /spotify|deezer|tidal|apple music|audible/i],
  ["Software/Cloud", /microsoft|office|adobe|dropbox|icloud|google|openai|chatgpt|anthropic|claude|github/i], ["Newspaper/Magazine", /nzz|anzeiger|blick|watson|zeitung/i],
  ["Fitness", /fitness|basefit|clever fit/i], ["Mobility", /mobility|publibike|swisspass|halbtax|\bga\b|tier|lime/i]];
const abGuessCat = (s) => (AB_GUESS.find(([, rx]) => rx.test(s)) || [null])[0];

async function renderAbos() {
  [AB.data, AB.sugg] = await Promise.all([api("/api/contracts-overview"), api("/api/abo-suggestions").catch(() => [])]);
  const d = AB.data, t = d.totals;
  const abos = d.items.filter((c) => c.kind === "abo");
  const today = new Date().toISOString().slice(0, 10), in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const soon = abos.filter((c) => c.active && c.next_due && c.next_due >= today && c.next_due <= in30);
  $("#aboKpis").innerHTML = `
    <div class="kpi"><div class="kpi-label">${__("Subscriptions per month")}</div><div class="kpi-value">${fmt(t.abos_monthly || 0)}</div><div class="kpi-sub">${__("{abos_count} active subscriptions", {abos_count: t.abos_count || 0})}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Subscriptions per year")}</div><div class="kpi-value">${fmt(t.abos_yearly || 0)}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Next 30 days")}</div><div class="kpi-value">${fmt(soon.reduce((a, c) => a + (c.per_interval || 0), 0))}</div><div class="kpi-sub">${__("{length} debit(s)", {length: soon.length})}</div></div>
    <div class="kpi"><div class="kpi-label">${__("Suggestions")}</div><div class="kpi-value">${AB.sugg.length}</div><div class="kpi-sub">${__("recurring payments")}</div></div>`;
  const cats = [["", "–"], ...(d.abo_categories || []).map((x) => [x, __(x)])];
  const ivs = Object.entries(AB_IV);
  const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  $("#aboBody").innerHTML = abos.length ? abos.map((c) => `<tr data-ab="${c.id}" data-v="${c.version?.id ?? ""}" class="${c.active && !c.ended ? "" : "out"}">
      <td><input data-f="name" value="${esc(c.name)}">${c.notice_by && c.notice_days != null && c.notice_days >= 0 && c.notice_days <= 60 ? `<div class="it-sub warn">${__("cancellable until {notice_by}", {notice_by: fmtDate(c.notice_by)})}</div>` : ""}</td>
      <td><select data-f="category">${opt(cats, c.category)}</select></td>
      <td><input data-vf="amount" type="number" step="0.05" value="${c.version?.amount ?? ""}"></td>
      <td><select data-vf="interval">${opt(ivs, c.version?.interval || "monat")}</select></td>
      <td class="num">${c.monthly != null ? fmt(c.monthly) : "–"}</td>
      <td>${c.next_due ? fmtDate(c.next_due) : "–"}</td>
      <td>${c.last_payment ? `${fmtDate(c.last_payment.date)}` : `<span class="muted small">–</span>`}</td>
      <td><input data-f="active" type="checkbox" ${c.active ? "checked" : ""}></td>
      <td class="row"><a href="#" data-abdetail="${c.id}">Details</a><button class="linkbtn danger" data-abdel="${c.id}">${__("delete")}</button></td></tr>`).join("")
    : `<tr><td colspan="9" class="muted small">${__("No subscriptions yet – adopt a suggestion below or “+ Subscription”.")}</td></tr>`;
  $("#aboSuggest").innerHTML = AB.sugg.length ? AB.sugg.map((s, i) => `<div class="invitem" data-i="${i}">
      <span><b>${esc(s.name)}</b> <span class="muted small">${__("{interval} · last {last}{next}", {interval: s.certain ? `${s.count}× ${esc(AB_IV[s.interval] || s.interval)}` : __("known subscription provider"), last: fmtDate(s.last), next: s.certain ? ` ${__("· next approx. {next}", {next: fmtDate(s.next)})}` : ""})}</span>
        <div class="it-sub" title="${esc(s.sample)}">${esc(s.sample)}</div></span>
      <span class="row"><b class="num">${fmt(s.amount)}</b><span class="muted small">${s.interval !== "monat" ? __("= {monthly}/mo.", {monthly: fmt(s.monthly)}) : ""}</span>
        <button class="primary" data-abok>${__("adopt as subscription")}</button><button class="linkbtn" data-abno>${__("not a subscription")}</button></span></div>`).join("")
    : `<div class="muted small">${__("No new recurring payments found. Based on the imported bank statements of the last 14 months.")}</div>`;
}

$("#aboBody").addEventListener("change", async (e) => {
  const tr = e.target.closest("[data-ab]"); if (!tr) return;
  const el = e.target;
  try {
    if (el.dataset.f) {
      const v = el.type === "checkbox" ? el.checked : el.value || null;
      await api(`/api/re/contracts/${tr.dataset.ab}`, { method: "PUT", body: JSON.stringify({ [el.dataset.f]: v }) });
    } else if (el.dataset.vf && tr.dataset.v) {
      const v = el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value;
      await api(`/api/re/contract-versions/${tr.dataset.v}`, { method: "PUT", body: JSON.stringify({ [el.dataset.vf]: v }) });
    } else return;
    toast(__("Saved")); renderAbos();
  } catch (err) { toast(err.message, true); }
});
$("#aboBody").addEventListener("click", async (e) => {
  const det = e.target.closest("[data-abdetail]"), del = e.target.dataset.abdel;
  if (det) { e.preventDefault(); CT.id = Number(det.dataset.abdetail); setView("contracts"); return; }
  if (del && confirm(__("Delete subscription? Payment assignments are removed, bank transactions stay."))) {
    await api(`/api/contracts/${del}`, { method: "DELETE" }); renderAbos();
  }
});
$("#aboSuggest").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-i]"); if (!row) return;
  const s = AB.sugg[Number(row.dataset.i)];
  try {
    if (e.target.hasAttribute("data-abok")) {
      const r = await openDialog({ title: __("Adopt as subscription"), sub: __("{amount} {interval} · {count} payment(s) will be assigned", {amount: fmt(s.amount), interval: AB_IV[s.interval] || "", count: s.count}), label: "Name", value: s.name, ok: __("Adopt") });
      if (!r || !r.value) return;
      await api("/api/abo-suggestions/accept", { method: "POST", body: JSON.stringify({ name: r.value, amount: s.amount, interval: s.interval, first: s.first, last: s.last,
        keyword: s.key, tx_ids: s.tx_ids, category: abGuessCat(`${s.name} ${s.sample}`) }) });
      toast(__("Subscription created")); renderAbos();
    } else if (e.target.hasAttribute("data-abno")) {
      await api("/api/abo-suggestions/ignore", { method: "POST", body: JSON.stringify({ key: s.key }) }); renderAbos();
    }
  } catch (err) { toast(err.message, true); }
});
$("#aboRescan").onclick = () => renderAbos();
$("#aboAdd").onclick = async () => {
  const r = await openDialog({ title: __("New subscription"), label: "Name", suggestions: ["Netflix", "Spotify", "Disney+", "Microsoft 365", "iCloud", __("Newspaper"), "Fitness"], ok: __("Create") });
  if (!r || !r.value) return;
  const today = new Date().toISOString().slice(0, 10);
  const c = await api("/api/re/contracts", { method: "POST", body: JSON.stringify({ kind: "abo", name: r.value, provider: r.value, match_text: r.value,
    category: abGuessCat(r.value), active: 1, start: today, renew_months: 1 }) });
  await api("/api/re/contract-versions", { method: "POST", body: JSON.stringify({ contract_id: c.id, valid_from: today, interval: "monat" }) });
  toast(__("Subscription created – enter amount")); renderAbos();
};
