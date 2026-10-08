"use strict";

const state = {
  data: null,
  selectedMerchants: new Set(),
  merchantSort: { key: "TPV_USD", direction: -1 },
  chartData: { daily: [], statuses: [] },
};
const $ = (id) => document.getElementById(id);
const FILTER_KEYS = { currencyFilter: "currency", paymentFilter: "payment_method", integrationFilter: "integration" };

const fmtMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtCount = new Intl.NumberFormat("en-US");
const fmtPct = (value) => value == null ? "N/A" : `${(value * 100).toFixed(1)}%`;
const safeDivide = (a, b) => b === 0 ? null : a / b;
const fmtDate = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));

function sumMeasures(rows) {
  return rows.reduce((a, r) => ({
    TPV_USD: a.TPV_USD + Number(r.TPV_USD || 0),
    Total_Orders: a.Total_Orders + Number(r.Total_Orders || 0),
    Successful_Orders: a.Successful_Orders + Number(r.Successful_Orders || 0),
    Failed_Orders: a.Failed_Orders + Number(r.Failed_Orders || 0),
    Closed_Orders: a.Closed_Orders + Number(r.Closed_Orders || 0),
  }), { TPV_USD: 0, Total_Orders: 0, Successful_Orders: 0, Failed_Orders: 0, Closed_Orders: 0 });
}

function derived(m) {
  return {
    ...m,
    Success_Rate: m.Total_Orders === 0 ? 0 : m.Successful_Orders / m.Total_Orders,
    Approval_Rate: safeDivide(m.Successful_Orders, m.Successful_Orders + m.Failed_Orders),
    AOV_USD: safeDivide(m.TPV_USD, m.Successful_Orders),
  };
}

function currentFilters(includeMerchant = true) {
  return {
    start: $("startDate").value,
    end: $("endDate").value,
    currency: $("currencyFilter").value,
    payment_method: $("paymentFilter").value,
    integration: $("integrationFilter").value,
    merchants: includeMerchant ? state.selectedMerchants : new Set(),
  };
}

function matches(row, filters) {
  if (filters.start && row.date < filters.start) return false;
  if (filters.end && row.date > filters.end) return false;
  if (filters.currency && row.currency !== filters.currency) return false;
  if (filters.payment_method && row.payment_method !== filters.payment_method) return false;
  if (filters.integration && row.integration !== filters.integration) return false;
  if (filters.merchants.size && !filters.merchants.has(row.merchant)) return false;
  return true;
}

function filteredPerformance(includeMerchant = true) {
  const filters = currentFilters(includeMerchant);
  return state.data.performance.filter((row) => matches(row, filters));
}

function grouped(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const groupKey = row[key] ?? "Unknown";
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(row);
  });
  return [...groups.entries()].map(([label, groupRows]) => ({ label, ...derived(sumMeasures(groupRows)) }));
}

function fillSelect(id, values, allLabel) {
  const select = $(id);
  select.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function setupFilters() {
  const rows = state.data.performance;
  const unique = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort();
  $("startDate").min = $("endDate").min = state.data.metadata.date_min;
  $("startDate").max = $("endDate").max = state.data.metadata.date_max;
  $("startDate").value = state.data.metadata.date_min;
  $("endDate").value = state.data.metadata.date_max;
  fillSelect("currencyFilter", unique("currency"), "All Currencies");
  fillSelect("paymentFilter", unique("payment_method"), "All Payment Methods");
  fillSelect("integrationFilter", unique("integration"), "All Integrations");
  const merchants = unique("merchant");
  $("merchantMenu").innerHTML = merchants.map((m) => `<label><input type="checkbox" value="${escapeHtml(m)}">${escapeHtml(m)}</label>`).join("");
  $("merchantMenu").addEventListener("change", (event) => {
    if (!event.target.matches("input")) return;
    event.target.checked ? state.selectedMerchants.add(event.target.value) : state.selectedMerchants.delete(event.target.value);
    updateMerchantButton(merchants.length);
    renderAll();
  });
  $("merchantButton").addEventListener("click", () => {
    const menu = $("merchantMenu");
    menu.hidden = !menu.hidden;
    $("merchantButton").setAttribute("aria-expanded", String(!menu.hidden));
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".merchant-filter")) { $("merchantMenu").hidden = true; $("merchantButton").setAttribute("aria-expanded", "false"); }
  });
  ["startDate", "endDate", ...Object.keys(FILTER_KEYS), "breakdownDimension"].forEach((id) => $(id).addEventListener("change", renderAll));
  $("resetFilters").addEventListener("click", () => {
    $("startDate").value = state.data.metadata.date_min; $("endDate").value = state.data.metadata.date_max;
    Object.keys(FILTER_KEYS).forEach((id) => $(id).value = "");
    state.selectedMerchants.clear();
    $("merchantMenu").querySelectorAll("input").forEach((input) => input.checked = false);
    updateMerchantButton(merchants.length); renderAll();
  });
  bindChartTooltips();
}

function updateMerchantButton(total) {
  const count = state.selectedMerchants.size;
  $("merchantButton").textContent = count === 0 ? "All Merchants" : count === 1 ? [...state.selectedMerchants][0] : `${count} of ${total} merchants`;
}

function renderKpis(rows) {
  const m = derived(sumMeasures(rows));
  $("kpiTpv").textContent = fmtMoney.format(m.TPV_USD);
  $("kpiOrders").textContent = fmtCount.format(m.Successful_Orders);
  $("kpiSuccess").textContent = fmtPct(m.Success_Rate);
  $("kpiApproval").textContent = fmtPct(m.Approval_Rate);
  $("kpiAov").textContent = m.AOV_USD == null ? "N/A" : fmtMoney.format(m.AOV_USD);
}

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); return { ctx, w: rect.width, h: rect.height };
}

function drawAxes(ctx, w, h, labels, maxLeft, leftFormatter, maxRight = null, rightFormatter = null) {
  const p = { l: 62, r: maxRight == null ? 18 : 55, t: 18, b: 40 };
  ctx.font = "12px system-ui"; ctx.fillStyle = "#7f92aa"; ctx.strokeStyle = "#20344e"; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = p.t + (h - p.t - p.b) * i / 4; ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(w - p.r, y); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(leftFormatter(maxLeft * (1 - i / 4)), p.l - 9, y + 4); if (maxRight != null) { ctx.textAlign = "left"; ctx.fillText(rightFormatter(maxRight * (1 - i / 4)), w - p.r + 9, y + 4); } }
  const step = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor((w - p.l - p.r) / 90))));
  labels.forEach((label, i) => { if (i % step !== 0 && i !== labels.length - 1) return; const x = p.l + (w - p.l - p.r) * (i + .5) / labels.length; ctx.textAlign = "center"; ctx.fillText(label.slice(5), x, h - 14); });
  return p;
}

function renderVolumeChart(daily) {
  const canvas = $("volumeChart"), empty = canvas.parentElement.querySelector(".chart-empty"); empty.hidden = daily.length > 0; canvas.hidden = daily.length === 0; if (!daily.length) return;
  state.chartData.daily = daily;
  const { ctx, w, h } = sizeCanvas(canvas); const maxTpv = Math.max(...daily.map((d) => d.TPV_USD), 1); const maxOrders = Math.max(...daily.map((d) => d.Successful_Orders), 1);
  const p = drawAxes(ctx, w, h, daily.map((d) => d.label), maxTpv, (v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v.toFixed(0)}`, maxOrders, (v) => Math.round(v));
  const plotW = w - p.l - p.r, plotH = h - p.t - p.b, slot = plotW / daily.length;
  daily.forEach((d, i) => { const bh = plotH * d.TPV_USD / maxTpv; ctx.fillStyle = "#28d7a1aa"; ctx.fillRect(p.l + i * slot + slot * .18, p.t + plotH - bh, Math.max(3, slot * .5), bh); });
  ctx.strokeStyle = "#56b8ff"; ctx.lineWidth = 2.5; ctx.beginPath(); daily.forEach((d, i) => { const x = p.l + slot * (i + .5), y = p.t + plotH * (1 - d.Successful_Orders / maxOrders); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); }); ctx.stroke();
}

function renderRateChart(daily) {
  const canvas = $("rateChart"), empty = canvas.parentElement.querySelector(".chart-empty"); empty.hidden = daily.length > 0; canvas.hidden = daily.length === 0; if (!daily.length) return;
  const { ctx, w, h } = sizeCanvas(canvas); const p = drawAxes(ctx, w, h, daily.map((d) => d.label), 1, (v) => `${Math.round(v*100)}%`); const plotW=w-p.l-p.r, plotH=h-p.t-p.b, slot=plotW/daily.length;
  [["Success_Rate", "#28d7a1"], ["Approval_Rate", "#56b8ff"]].forEach(([key,color]) => { ctx.strokeStyle=color; ctx.lineWidth=2.5; ctx.beginPath(); let started=false; daily.forEach((d,i)=>{ if(d[key]==null) return; const x=p.l+slot*(i+.5), y=p.t+plotH*(1-d[key]); if(started) ctx.lineTo(x,y); else {ctx.moveTo(x,y);started=true;} }); ctx.stroke(); });
}

function renderStatus(rows) {
  const m = sumMeasures(rows), total = m.Total_Orders || 1;
  const statuses = [["Successful",m.Successful_Orders,"#28d7a1"],["Failed",m.Failed_Orders,"#ff6b7a"],["Closed",m.Closed_Orders,"#ffb454"]];
  state.chartData.statuses = statuses;
  let pos=0; const stops=[]; statuses.forEach(([,value,color])=>{ const start=pos; pos += value/total*100; stops.push(`${color} ${start}% ${pos}%`); });
  $("statusDonut").style.background = m.Total_Orders ? `conic-gradient(${stops.join(",")})` : "#20344e";
  $("donutTotal").textContent=fmtCount.format(m.Total_Orders);
  $("statusList").innerHTML=statuses.map(([name,value,color])=>`<div class="status-row"><i style="background:${color}"></i><span>${name}</span><strong>${fmtCount.format(value)}</strong></div>`).join("");
}

function renderDeclines() {
  const filters=currentFilters(true); const rows=state.data.declines.filter((r)=>matches(r,filters)); const counts=new Map();
  rows.forEach((r)=>counts.set(r.channel_response,(counts.get(r.channel_response)||0)+Number(r.Failed_Order_Count||0)));
  const sorted=[...counts.entries()].map(([reason,count])=>({reason,count})).sort((a,b)=>b.count-a.count); const total=sorted.reduce((a,r)=>a+r.count,0);
  const visible=sorted.slice(0,15);
  $("declineTable").innerHTML=visible.length?visible.map((r)=>`<tr><td>${escapeHtml(r.reason)}</td><td class="numeric">${fmtCount.format(r.count)}</td><td class="numeric">${fmtPct(safeDivide(r.count,total))}</td></tr>`).join(""):emptyRow(3);
}

function tableMetricRow(r,total,label) { return `<tr><td>${escapeHtml(label)}</td><td class="numeric">${fmtMoney.format(r.TPV_USD)}</td><td class="numeric">${fmtPct(safeDivide(r.TPV_USD,total.TPV_USD))}</td><td class="numeric">${fmtCount.format(r.Successful_Orders)}</td><td class="numeric">${fmtPct(safeDivide(r.Successful_Orders,total.Successful_Orders))}</td><td class="numeric">${fmtPct(r.Success_Rate)}</td><td class="numeric">${fmtPct(r.Approval_Rate)}</td><td class="numeric">${r.AOV_USD==null?"N/A":fmtMoney.format(r.AOV_USD)}</td></tr>`; }
function emptyRow(cols) { return `<tr class="empty-row"><td colspan="${cols}">No data for this filter selection.</td></tr>`; }

function renderBreakdown(rows) {
  const total=sumMeasures(rows), key=$("breakdownDimension").value; const groups=grouped(rows,key).sort((a,b)=>b.TPV_USD-a.TPV_USD);
  $("breakdownTable").innerHTML=groups.length?groups.map((r)=>tableMetricRow(r,total,r.label)).join(""):emptyRow(8);
}

function merchantRows() {
  const rows=filteredPerformance(false), total=sumMeasures(rows);
  return grouped(rows,"merchant").map((r)=>({...r,TPV_Share:safeDivide(r.TPV_USD,total.TPV_USD),Order_Share:safeDivide(r.Successful_Orders,total.Successful_Orders)}));
}

function renderMerchants() {
  const rows=merchantRows(); const {key,direction}=state.merchantSort;
  rows.sort((a,b)=> typeof a[key]==="string" ? direction*a[key].localeCompare(b[key]) : direction*((a[key]??-Infinity)-(b[key]??-Infinity)));
  const total=sumMeasures(rows);
  $("merchantTableBody").innerHTML=rows.length?rows.map((r)=>tableMetricRow(r,total,r.label)).join(""):emptyRow(8);
  document.querySelectorAll("#merchantTable th").forEach((th)=>th.classList.toggle("active-sort",th.dataset.sort===key));
}

function renderAll() {
  if (!state.data) return;
  if ($("startDate").value && $("endDate").value && $("startDate").value > $("endDate").value) $("endDate").value = $("startDate").value;
  const rows=filteredPerformance(true), daily=grouped(rows,"date").sort((a,b)=>a.label.localeCompare(b.label));
  renderKpis(rows); renderVolumeChart(daily); renderRateChart(daily); renderStatus(rows); renderDeclines(); renderBreakdown(rows); renderMerchants();
}

function showTooltip(event, title, lines) {
  const tooltip = $("chartTooltip");
  tooltip.innerHTML = `<strong>${escapeHtml(title)}</strong>${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}`;
  tooltip.hidden = false;
  const gap = 14;
  const rect = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.min(event.clientX + gap, window.innerWidth - rect.width - 10)}px`;
  tooltip.style.top = `${Math.min(event.clientY + gap, window.innerHeight - rect.height - 10)}px`;
}

function hideTooltip() { $("chartTooltip").hidden = true; }

function nearestDailyPoint(event, canvas) {
  const daily = state.chartData.daily;
  if (!daily.length) return null;
  const rect = canvas.getBoundingClientRect();
  const left = 62, right = canvas.id === "volumeChart" ? 55 : 18;
  const x = event.clientX - rect.left;
  if (x < left || x > rect.width - right) return null;
  const index = Math.max(0, Math.min(daily.length - 1, Math.floor((x - left) / (rect.width - left - right) * daily.length)));
  return daily[index];
}

function bindChartTooltips() {
  $("volumeChart").addEventListener("mousemove", (event) => {
    const point = nearestDailyPoint(event, event.currentTarget);
    if (!point) return hideTooltip();
    showTooltip(event, fmtDate(point.label), [
      `TPV (USD): ${fmtMoney.format(point.TPV_USD)}`,
      `Order Count: ${fmtCount.format(point.Successful_Orders)}`,
    ]);
  });
  $("rateChart").addEventListener("mousemove", (event) => {
    const point = nearestDailyPoint(event, event.currentTarget);
    if (!point) return hideTooltip();
    showTooltip(event, fmtDate(point.label), [
      `Success Rate: ${fmtPct(point.Success_Rate)}`,
      `Approval Rate: ${fmtPct(point.Approval_Rate)}`,
    ]);
  });
  ["volumeChart", "rateChart"].forEach((id) => $(id).addEventListener("mouseleave", hideTooltip));

  $("statusDonut").addEventListener("mousemove", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2), y = event.clientY - (rect.top + rect.height / 2);
    const radius = Math.hypot(x, y);
    if (radius < rect.width * .15 || radius > rect.width / 2) return hideTooltip();
    const total = state.chartData.statuses.reduce((sum, item) => sum + item[1], 0);
    if (!total) return hideTooltip();
    let pct = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    let cumulative = 0;
    const item = state.chartData.statuses.find((status) => { cumulative += status[1] / total; return pct <= cumulative; });
    if (item) showTooltip(event, item[0], [`Order Count: ${fmtCount.format(item[1])}`, `Order Count %: ${fmtPct(item[1] / total)}`]);
  });
  $("statusDonut").addEventListener("mouseleave", hideTooltip);

}

document.querySelectorAll("#merchantTable th[data-sort]").forEach((th)=>th.addEventListener("click",()=>{ const key=th.dataset.sort; state.merchantSort.direction=state.merchantSort.key===key ? -state.merchantSort.direction : (key==="merchant"?1:-1); state.merchantSort.key=key; renderMerchants(); }));
window.addEventListener("resize",()=>{ clearTimeout(window.__chartTimer); window.__chartTimer=setTimeout(renderAll,120); });

fetch("dashboard_data.json")
  .then((response)=>{ if(!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then((data)=>{ state.data=data; setupFilters(); renderAll(); $("dataStatus").textContent=`Daily data · ${data.metadata.date_min} to ${data.metadata.date_max}`; })
  .catch((error)=>{ $("dataStatus").textContent="Dashboard data could not be loaded."; document.querySelector("main").innerHTML=`<section class="panel"><h2>Unable to load dashboard data</h2><p class="section-copy">Start a local web server from the project root, then open the dashboard URL. ${escapeHtml(error.message)}</p></section>`; });
