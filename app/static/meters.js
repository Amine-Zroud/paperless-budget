"use strict";
/* Meters: reading, consumption since the start of the period, projection and expected statement minus advance payments */

const MT = { data: null, open: new Set() };
const MT_SRC = { ams: __("AMS reader"), http: __("HTTP-JSON (e.g. Shelly)"), homeassistant: "Home Assistant", manuell: __("manual") };
const MT_KIND = { strom: __("Electricity"), wasser: __("Water"), gas: "Gas", waerme: __("Heat") };
const mtNum = (v, d = 1) => (v == null ? "–" : new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d }).format(v));

async function renderMeters() {
  MT.data = await api("/api/meters");
  const d = MT.data;
  Object.keys(S.charts).filter((k) => k.startsWith("mt")).forEach((k) => { S.charts[k].destroy(); delete S.charts[k]; });
  const bal = d.meters.filter((m) => m.projection?.balance != null);
  const sum = bal.reduce((a, m) => a + m.projection.balance, 0);
  $("#mtKpis").innerHTML = bal.length ? `
    <div class="kpi"><div class="kpi-label">${__("Expected statements")}</div><div class="kpi-value ${sum > 0 ? "neg" : "pos"}">${sum > 0 ? __("Additional payment ") : __("Credit balance ")}${fmt(Math.abs(sum))}</div>
      <div class="kpi-sub">${__("{length} meter(s) with tariff and advance payment", {length: bal.length})}</div></div>` : "";
  let lastProp;
  $("#mtList").innerHTML = d.meters.length ? d.meters.map((m) => {
    const head = m.property_id !== lastProp ? `<h3 class="mt-grp">${esc(d.properties.find((x) => x.id === m.property_id)?.name || __("Unassigned"))}</h3>` : "";
    lastProp = m.property_id; return head + meterCard(m);
  }).join("")
    : `<div class="card hint">${__("No meter yet. Add one above – e.g.")} <b>${__("Electricity (AMS reader)")}</b>.</div>`;
  d.meters.forEach((m) => drawMeterChart(m));
}

function meterCard(m) {
  const p = m.projection || {};
  const ctOpts = [["", __("– no advance-payment contract –")], ...MT.data.contracts.map((c) => [c.id, c.name])];
  const opt = (list, v) => list.map(([k, l]) => `<option value="${esc(k ?? "")}" ${String(k ?? "") === String(v ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("");
  const months = MONTHS.map((n, i) => [i + 1, n]);
  const u = esc(m.unit || "");
  const head = `<div class="mt-head"><h3>${m.icon} ${esc(m.name)}</h3>
      <span class="muted small">${esc(MT_KIND[m.kind] || m.kind)} · ${esc(MT_SRC[m.source] || m.source)}${mtProp(m)}${p.latest_ts ? ` ${__("· reading")} <b>${mtNum(p.latest_value, 2)} ${u}</b> (${new Date(p.latest_ts).toLocaleString(LOCALE, { dateStyle: "short", timeStyle: "short" })})` : ""}</span>
      <span class="row">${m.source !== "manuell" && m.active ? `<button class="linkbtn" data-mtread>${__("read now")}</button>` : ""}<button class="linkbtn" data-mtadd>${__("Record reading")}</button></span></div>
    ${m.last_error && m.active ? `<div class="alert" style="margin:6px 0">${__("Meter not readable: {last_error}", {last_error: esc(m.last_error)})}</div>` : ""}`;
  let body;
  if (!m.active) {
    body = `<div class="card hint" style="margin:8px 0">${__("Planned – not active yet{note}. Under “Settings” enter the address, “Test source” and", {note: m.note ? ` (${esc(m.note)})` : ""})} <b>${__("active")}</b> setzen.</div>`;
  } else if (p.status !== "ok") {
    body = `<p class="muted small">${esc(p.status || __("no data"))}${p.status === __("not enough data") ? __(" – the projection starts after a few days of readings. It is faster with the meter reading of the last invoice (Settings).") : ""}</p>`;
  } else {
    const a = p.akonto;
    const balance = p.balance == null ? "" : `<div class="mt-bal ${p.balance > 0 ? "neg" : "pos"}">${__("{balance2} approx.", {balance2: p.balance > 0 ? __("Additional payment") : __("Credit balance")})} <b>${fmt(Math.abs(p.balance))}</b></div>`;
    body = `<div class="mt-grid">
      <div><div class="l">${__("Period")}</div><div class="v">${fmtDate(p.period[0])} – ${fmtDate(p.period[1])}</div><div class="bar"><div style="width:${Math.round(p.progress * 100)}%"></div></div></div>
      <div><div class="l">${__("Consumption so far")}</div><div class="v">${mtNum(p.so_far)} ${u}</div><div class="muted small">${__("since {slice} · {daily} {u2}/day", {slice: fmtDate(p.start_ts.slice(0, 10)), daily: mtNum(p.daily, 2), u2: u})}</div></div>
      <div><div class="l">${__("Projection for period")}</div><div class="v">${mtNum(p.total, 0)} ${u}</div><div class="muted small">${esc(p.method)}</div></div>
      <div><div class="l">${__("Invoice approx.")}</div><div class="v">${p.cost == null ? "–" : fmt(p.cost)}</div><div class="muted small">${m.tariff != null ? `${mtNum(m.tariff, 4)} ${S.meta?.currency || "EUR"}/${u}${m.base_fee ? ` ${__("+ {base_fee}/mo.", {base_fee: fmt(m.base_fee)})}` : ""}` : __("Tariff missing (Settings)")}</div></div>
      <div><div class="l">${__("Advance payment")}</div><div class="v">${a ? fmt(a.total) : "–"}</div><div class="muted small">${a ? __("paid {paid} ({payments}) + still {remaining} ({remaining_count})", {paid: fmt(a.paid), payments: a.payments, remaining: fmt(a.remaining), remaining_count: a.remaining_count}) : __("Choose advance-payment contract (Settings)")}</div></div>
      <div>${balance || `<div class="l">${__("Balance")}</div><div class="v">–</div><div class="muted small">${a ? "" : __("no advance payments – consumption only")}</div>`}</div>
    </div><div class="chartbox small"><canvas id="mt${m.id}"></canvas></div>`;
  }
  const f = (label, hint, html) => `<div class="field"><div class="lbl"><b>${label}</b>${hint ? `<span>${hint}</span>` : ""}</div><div>${html}</div></div>`;
  const settings = `<details class="mt-set" ${MT.open.has(m.id) ? "open" : ""} data-mtset><summary>${__("Settings")}</summary>
    ${f(__("Name / type"), "", `<div class="row"><input name="name" value="${esc(m.name)}"><select name="kind">${opt(Object.entries(MT_KIND), m.kind)}</select><input name="unit" value="${u}" style="width:80px" placeholder="${__("Unit")}"></div>`)}
    ${f(__("Source"), "", `<select name="source">${opt(Object.entries(MT_SRC), m.source)}</select>`)}
    ${m.source === "homeassistant" ? f("Sensor in Home Assistant", MT.data.ha_configured ? __("Entity ID, meter reading (not an instantaneous value)") : __("HOMEASSISTANT_URL and _TOKEN are missing in .env"), `<input name="ha_entity" value="${esc(m.ha_entity || "")}" placeholder="sensor.ams_energie_bezug">`) : ""}
    ${["ams", "http"].includes(m.source) ? f(__("Address"), m.source === "ams" ? __("IP or name of the AMS reader – /data.json is read") : __("URL that returns JSON"), `<input name="url" value="${esc(m.url || "")}" placeholder="${m.source === "ams" ? "192.168.1.50" : "http://192.168.1.60/rpc/Input.GetStatus?id=2"}" style="width:100%">`)
      + f(__("JSON field / factor"), m.source === "ams" ? __("“ic” = cumulative import in kWh") : __("e.g. counts.total; factor 0.001 = litre pulses → m³"), `<div class="row"><input name="json_path" value="${esc(m.json_path || (m.source === "ams" ? "ic" : ""))}" placeholder="ic"><input name="factor" type="number" step="any" value="${m.factor ?? 1}" style="width:110px" title="${__("Factor")}"></div>`) : ""}
    ${f(__("Tariff"), __("Price per unit incl. VAT (all components) and base fee per month"), `<div class="row"><input name="tariff" type="number" step="0.0001" value="${m.tariff ?? ""}" placeholder="${__("e.g. 0.2950")}" style="width:130px"><input name="base_fee" type="number" step="0.05" value="${m.base_fee ?? ""}" placeholder="${__("Base fee/mo.")}" style="width:130px"></div>`)}
    ${f(__("Billing period"), __("starts in"), `<select name="period_start_month">${opt(months, m.period_start_month)}</select>`)}
    ${f(__("Reading of the last invoice"), __("Start value of the period – otherwise the first reading counts"), `<div class="row"><input name="start_reading" type="number" step="any" value="${m.start_reading ?? ""}" placeholder="${__("Meter reading")}" style="width:140px"><input name="start_date" type="date" value="${esc(m.start_date || "")}"></div>`)}
    ${f(__("Assignment"), __("Building = general (e.g. common electricity), otherwise the flat"), `<select name="assign">${opt([["", __("– none –")],
      ...MT.data.properties.flatMap((x) => [[`${x.id}:`, __("{name} – building (general)", {name: x.name})],
        ...MT.data.units.filter((u) => u.property_id === x.id).map((u) => [`${x.id}:${u.id}`, __("{name} – flat {name2}", {name: x.name, name2: u.name})])])],
      m.property_id ? `${m.property_id}:${m.unit_id ?? ""}` : "")}</select>`)}
    ${m.property_id && !m.unit_id ? f(__("Show in utility statement at"), __("expected costs in brackets after this category (empty: category with “Strom” in its name)"),
      `<select name="nk_category_id">${opt([["", __("– automatic –")], ...MT.data.nk_categories.filter((c) => c.property_id === m.property_id).map((c) => [c.id, `${c.grp} · ${c.name}`])], m.nk_category_id)}</select>`) : ""}
    ${f(__("Advance-payment contract"), __("Contract with the advance payments (record under Contracts, set the bank transaction keyword)"), `<select name="contract_id">${opt(ctOpts, m.contract_id)}</select>`)}
    <div class="row" style="justify-content:space-between;margin-top:8px"><label class="check small"><input type="checkbox" name="active" ${m.active ? "checked" : ""}> ${__("active")}</label>
      <span class="row">${m.source !== "manuell" ? `<button class="linkbtn" data-mttest>${__("Test source")}</button>` : ""}<button class="linkbtn danger" data-mtdel>${__("Delete meter")}</button></span></div>
  </details>`;
  return `<div class="card mt ${m.active ? "" : "off"}" data-mid="${m.id}">${head}${body}${settings}</div>`;
}

function mtProp(m) {
  const pr = MT.data.properties.find((x) => x.id === m.property_id);
  const u = MT.data.units.find((x) => x.id === m.unit_id);
  return pr ? ` · <span class="pill">${esc(pr.name)} · ${u ? __("Flat ") + esc(u.name) : __("general")}</span>` : "";
}

function drawMeterChart(m) {
  const p = m.projection, el = document.getElementById("mt" + m.id);
  if (!el || !window.Chart || !p?.monthly?.length) return;
  S.charts["mt" + m.id] = new Chart(el, {
    type: "bar",
    data: { labels: p.monthly.map((x) => monthShort(x.month)), datasets: [{ label: __("Consumption {unit}", {unit: m.unit}), data: p.monthly.map((x) => x.value),
      backgroundColor: p.monthly.map((x) => (x.partial ? "#9aa5a0aa" : (m.kind === "wasser" ? "#2b7bb9cc" : "#e0a82ecc"))) }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: css("--muted") } }, y: { grid: { color: css("--line") }, ticks: { color: css("--muted") } } } },
  });
}

$("#mtList").addEventListener("toggle", (e) => {
  const c = e.target.closest?.("[data-mid]"); if (!c || !e.target.matches("[data-mtset]")) return;
  const id = Number(c.dataset.mid); e.target.open ? MT.open.add(id) : MT.open.delete(id);
}, true);
$("#mtList").addEventListener("change", async (e) => {
  const c = e.target.closest("[data-mid]"), el = e.target; if (!c || !el.name || !el.closest("[data-mtset]")) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (el.type === "number" || ["contract_id", "period_start_month", "nk_category_id"].includes(el.name)) v = v === "" ? null : Number(v);
  let body = { [el.name]: v };
  if (el.name === "assign") { const [pid, uid] = v.split(":"); body = { property_id: pid ? Number(pid) : null, unit_id: uid ? Number(uid) : null }; }
  try { await api(`/api/meters/${c.dataset.mid}`, { method: "PUT", body: JSON.stringify(body) }); toast(__("Saved")); renderMeters(); }
  catch (err) { toast(err.message, true); }
});
$("#mtList").addEventListener("click", async (e) => {
  const c = e.target.closest("[data-mid]"); if (!c) return;
  const id = c.dataset.mid, m = MT.data.meters.find((x) => String(x.id) === id);
  try {
    if (e.target.hasAttribute("data-mtread")) {
      const r = await api(`/api/meters/${id}/read`, { method: "POST" }); toast(__("Reading {value} {unit}", {value: mtNum(r.value, 2), unit: m.unit})); renderMeters();
    } else if (e.target.hasAttribute("data-mtadd")) {
      const r = await openDialog({ title: __("Record meter reading"), sub: __("{name} – e.g. read off or from the invoice", {name: m.name}), label: __("Reading in {unit}", {unit: m.unit}), ok: __("Save") });
      if (!r || r.value === "") return;
      const d = await openDialog({ title: __("Date"), label: "TT.MM.JJJJ (leer = jetzt)", value: new Date().toLocaleDateString(LOCALE), ok: __("Save") });
      if (!d) return;
      const [dd, mm, yy] = (d.value || "").split(".");
      const iso = yy ? `${yy.length === 2 ? "20" + yy : yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}T12:00:00` : null;
      await api(`/api/meters/${id}/readings`, { method: "POST", body: JSON.stringify({ value: Number(String(r.value).replace("'", "").replace(",", ".")), date: iso }) });
      toast(__("Meter reading saved")); renderMeters();
    } else if (e.target.hasAttribute("data-mttest")) {
      const t = await api("/api/meters/test", { method: "POST", body: JSON.stringify(m) });
      toast(t.ok ? __("Source works: {value} {unit}", {value: mtNum(t.value, 3), unit: m.unit}) : __("Source not readable: {error}", {error: t.error}), !t.ok);
    } else if (e.target.hasAttribute("data-mtdel")) {
      if (!confirm(__("Delete meter with all readings?"))) return;
      await api(`/api/meters/${id}`, { method: "DELETE" }); renderMeters();
    }
  } catch (err) { toast(err.message, true); }
});
document.querySelectorAll("[data-mtnew]").forEach((b) => (b.onclick = async () => {
  const presets = {
    ams: { name: __("Electricity"), kind: "strom", unit: "kWh", source: "ams", json_path: "ic", active: 1 },
    shelly: { name: __("Water"), kind: "wasser", unit: "m³", source: "http", url: "http://<shelly-ip>/rpc/Input.GetStatus?id=2", json_path: "counts.total",
      factor: 0.001, active: 0, note: __("Shelly water meter coming soon") },
    ha: { name: __("Meter"), kind: "strom", unit: "kWh", source: "homeassistant", active: 1 },
    manual: { name: __("Meter"), kind: "wasser", unit: "m³", source: "manuell", active: 1 },
  };
  try { const m = await api("/api/meters", { method: "POST", body: JSON.stringify(presets[b.dataset.mtnew]) }); MT.open.add(m.id); renderMeters(); }
  catch (err) { toast(err.message, true); }
}));
