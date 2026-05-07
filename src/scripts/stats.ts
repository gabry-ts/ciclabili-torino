// @ts-nocheck
// Stats page logic. Uses Chart (Chart.js) loaded globally via CDN script in stats.astro.
(() => {
  const CONFIG = window.APP_CONFIG || {};
  const ORG_ID = CONFIG.orgId || 6771;
  const API_BASE = CONFIG.apiBase || "https://www.eco-visio.net/api/aladdin/1.0.0/pbl/publicwebpageplus/";
  const BATCH_SIZE = 6;
  const TODAY = new Date();

  const numberFmt = new Intl.NumberFormat("it-IT");
  const compactFmt = (n) => {
    if (!Number.isFinite(n)) return "—";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(".", ",")}M`;
    if (n >= 10_000) return `${Math.round(n / 1000)}k`;
    if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(".", ",")}k`;
    return numberFmt.format(n);
  };
  const pctFmt = (n) => {
    if (!Number.isFinite(n)) return "";
    const sign = n > 0 ? "+" : "";
    return `${sign}${(n * 100).toFixed(1).replace(".", ",")}%`;
  };

  const fmtDateForApi = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const parseResponseDate = (s) => {
    const [mm, dd, yyyy] = s.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  };
  const parseItDate = (s) => {
    const [dd, mm, yyyy] = s.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  };

  const loader = document.getElementById("loader");
  const loaderText = loader.querySelector(".loader-text");
  const loaderKeys = new Set();
  const setLoader = (key, text) => {
    if (text) {
      loaderKeys.add(key);
      loaderText.textContent = text;
      loader.classList.remove("hidden");
    } else {
      loaderKeys.delete(key);
      if (loaderKeys.size === 0) loader.classList.add("hidden");
    }
  };

  const flowIdsFor = (counter) => (counter.pratique || []).map((p) => p.id).join(";");

  const fetchSeries = async (counter, interval, start, end) => {
    const params = new URLSearchParams({
      idOrganisme: String(ORG_ID),
      idPdc: String(counter.idPdc),
      debut: fmtDateForApi(start),
      fin: fmtDateForApi(end),
      interval: String(interval),
      flowIds: flowIdsFor(counter),
    });
    const resp = await fetch(`${API_BASE}data/${counter.idPdc}?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows = await resp.json();
    return rows.map(([d, v]) => [parseResponseDate(d), parseInt(v, 10) || 0]);
  };

  const runBatched = async (items, worker) => {
    const results = new Array(items.length);
    let idx = 0;
    const runNext = async () => {
      while (idx < items.length) {
        const my = idx++;
        try { results[my] = await worker(items[my], my); }
        catch (err) { results[my] = null; console.warn("batch item failed", err); }
      }
    };
    const pool = Array.from({ length: Math.min(BATCH_SIZE, items.length) }, runNext);
    await Promise.all(pool);
    return results;
  };

  let counters = [];
  let monthlySeries = [];
  let dailySeries = [];

  const state = {
    trendRange: "day",
    rankRange: "total",
  };

  let trendChart = null;
  let monthsChart = null;

  const step = (n, msg) => {
    console.log(`[stats] step ${n}: ${msg}`);
    loaderText.textContent = msg;
    loader.classList.remove("hidden");
  };

  const init = async () => {
    step(1, "Carico contatori…");
    const resp = await fetch(`${API_BASE}${ORG_ID}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} su counters`);
    counters = await resp.json();
    console.log(`[stats] counters loaded: ${counters.length}`);

    step(2, "Render hero + tabella iniziale…");
    renderHero();
    renderRankTable();

    step(3, `Fetch mensili per ${counters.length} contatori…`);
    monthlySeries = await runBatched(counters, async (c) => {
      const start = parseItDate(c.debut);
      return { counter: c, data: await fetchSeries(c, 6, start, TODAY) };
    });
    const monthlyOk = monthlySeries.filter(Boolean).length;
    console.log(`[stats] monthly fetched: ${monthlyOk}/${counters.length}`);
    monthlySeries = monthlySeries.filter(Boolean);

    step(4, "Aggrego mensili…");
    computeDerived();
    renderKpis();
    renderMonthsChart();
    renderTrend();
    renderRankTable();

    step(5, "Fetch giornalieri (ultimi 400gg)…");
    const from90 = new Date(TODAY); from90.setDate(from90.getDate() - 400);
    dailySeries = await runBatched(counters, async (c) => {
      const start = parseItDate(c.debut) > from90 ? parseItDate(c.debut) : from90;
      return { counter: c, data: await fetchSeries(c, 4, start, TODAY) };
    });
    const dailyOk = dailySeries.filter(Boolean).length;
    console.log(`[stats] daily fetched: ${dailyOk}/${counters.length}`);
    dailySeries = dailySeries.filter(Boolean);

    step(6, "Render weekdays + trend giornaliero…");
    renderWeekdays();
    if (state.trendRange === "day") renderTrend();

    const updated = TODAY.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    document.getElementById("update-time").textContent = updated;
    document.getElementById("hero-update").textContent = updated;
    document.getElementById("data-range").textContent = `Aggiornato ${updated}`;

    console.log("[stats] init completed");
    loader.classList.add("hidden");
  };

  const aggregateByMonth = () => {
    const agg = new Map();
    for (const s of monthlySeries) {
      if (!s) continue;
      for (const [d, v] of s.data) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        agg.set(key, (agg.get(key) || 0) + v);
      }
    }
    return [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const aggregateByYear = () => {
    const agg = new Map();
    for (const s of monthlySeries) {
      if (!s) continue;
      for (const [d, v] of s.data) {
        const key = d.getFullYear();
        agg.set(key, (agg.get(key) || 0) + v);
      }
    }
    return [...agg.entries()].sort((a, b) => a[0] - b[0]);
  };

  const aggregateByDay = () => {
    const agg = new Map();
    for (const s of dailySeries) {
      if (!s) continue;
      for (const [d, v] of s.data) {
        const key = d.toISOString().slice(0, 10);
        agg.set(key, (agg.get(key) || 0) + v);
      }
    }
    return [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  const derived = {
    totalHistoric: 0,
    byYear: [],
    byMonth: [],
    currentYear: 0,
    prevYear: 0,
    last30: 0,
    prev30: 0,
    monthAvg: Array(12).fill(0),
    monthCount: Array(12).fill(0),
  };

  const computeDerived = () => {
    derived.totalHistoric = counters.reduce((a, c) => a + (c.total || 0), 0);
    derived.byMonth = aggregateByMonth();
    derived.byYear = aggregateByYear();

    const yNow = TODAY.getFullYear();
    derived.currentYear = derived.byYear.find((r) => r[0] === yNow)?.[1] || 0;
    derived.prevYear = derived.byYear.find((r) => r[0] === yNow - 1)?.[1] || 0;

    for (const [key, val] of derived.byMonth) {
      const m = parseInt(key.slice(5, 7), 10) - 1;
      derived.monthAvg[m] += val;
      derived.monthCount[m] += 1;
    }
    for (let i = 0; i < 12; i++) {
      if (derived.monthCount[i] > 0) derived.monthAvg[i] /= derived.monthCount[i];
    }
  };

  const renderHero = () => {
    document.getElementById("hero-ncounters").textContent = counters.length;
    const debuts = counters.map((c) => parseItDate(c.debut)).sort((a, b) => a - b);
    const first = debuts[0];
    if (first) {
      document.getElementById("hero-from").textContent = first.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
    }
    const totalHistoric = counters.reduce((a, c) => a + (c.total || 0), 0);
    document.getElementById("kpi-total").textContent = compactFmt(totalHistoric);
    document.getElementById("kpi-total-meta").textContent = `${numberFmt.format(totalHistoric)} passaggi`;

    const ydaySum = counters.reduce((a, c) => a + (c.lastDay || 0), 0);
    const avgSum = counters.reduce((a, c) => a + (c.moyD || 0), 0);
    document.getElementById("kpi-yday").textContent = compactFmt(ydaySum);
    const delta = avgSum ? (ydaySum - avgSum) / avgSum : 0;
    const deltaEl = document.getElementById("kpi-yday-delta");
    deltaEl.textContent = `${pctFmt(delta)} vs media giornaliera`;
    deltaEl.classList.toggle("up", delta > 0);
    deltaEl.classList.toggle("down", delta < 0);
  };

  const renderKpis = () => {
    const last30 = derived.byMonth.slice(-1).reduce((a, [, v]) => a + v, 0)
      + derived.byMonth.slice(-2, -1).reduce((a, [, v]) => a + v, 0) / 2;
    document.getElementById("kpi-30d").textContent = compactFmt(Math.round(last30));

    let baseline = 0, baselineCount = 0;
    for (const [k, v] of derived.byMonth) {
      const m = parseInt(k.slice(5, 7), 10) - 1;
      const y = parseInt(k.slice(0, 4), 10);
      if (y < TODAY.getFullYear() && (m === TODAY.getMonth() - 1 || m === TODAY.getMonth())) {
        baseline += v; baselineCount++;
      }
    }
    const baselineAvg = baselineCount ? baseline / Math.max(1, baselineCount / 2) : 0;
    const d30 = baselineAvg ? (last30 - baselineAvg) / baselineAvg : 0;
    const d30El = document.getElementById("kpi-30d-delta");
    d30El.textContent = baselineAvg ? `${pctFmt(d30)} vs stessi mesi anni precedenti` : "";
    d30El.classList.toggle("up", d30 > 0);
    d30El.classList.toggle("down", d30 < 0);

    document.getElementById("kpi-year").textContent = compactFmt(derived.currentYear);
    const yDelta = derived.prevYear ? (derived.currentYear - derived.prevYear) / derived.prevYear : 0;
    const yEl = document.getElementById("kpi-year-delta");
    if (derived.prevYear) {
      yEl.textContent = `${pctFmt(yDelta)} vs ${TODAY.getFullYear() - 1}`;
    } else {
      yEl.textContent = "";
    }
    yEl.classList.toggle("up", yDelta > 0);
    yEl.classList.toggle("down", yDelta < 0);
  };

  const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const hexToRgb = (hex) => {
    if (!hex || !hex.startsWith("#")) return null;
    let h = hex.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6) return null;
    const n = parseInt(h, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  };

  const chartBase = (ctx, type, labels, datasets, extraOptions = {}) => {
    const accent = getCssVar("--accent") || "#d4ff3a";
    const ink = getCssVar("--ink") || "#f5f5f4";
    const inkSoft = getCssVar("--ink-soft") || "#9ca3af";
    const surface = getCssVar("--surface") || "#171717";
    const borderStrong = getCssVar("--border-strong") || "#333333";
    const gridLine = getCssVar("--grid-line") || "rgba(255,255,255,0.05)";
    return new Chart(ctx, {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: surface,
            borderColor: borderStrong,
            borderWidth: 1,
            titleColor: ink,
            bodyColor: accent,
            titleFont: { family: "JetBrains Mono", size: 11, weight: "500" },
            bodyFont: { family: "JetBrains Mono", size: 12, weight: "600" },
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (c) => ` ${numberFmt.format(c.parsed.y)} passaggi`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: inkSoft, font: { family: "JetBrains Mono", size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
            grid: { display: false },
            border: { color: gridLine },
          },
          y: {
            ticks: {
              color: inkSoft,
              font: { family: "JetBrains Mono", size: 10 },
              maxTicksLimit: 5,
              callback: (v) => compactFmt(v),
            },
            grid: { color: gridLine, drawTicks: false },
            border: { display: false },
          },
          ...extraOptions.scales,
        },
        ...extraOptions,
      },
    });
  };

  const renderTrend = () => {
    const empty = document.getElementById("chart-empty");
    const canvas = document.getElementById("chart-trend");
    const legend = document.getElementById("chart-legend");
    if (trendChart) { trendChart.destroy(); trendChart = null; }

    let labels = [], values = [], ctxLabel = "";
    if (state.trendRange === "day") {
      if (!dailySeries.length) { empty.classList.remove("hidden"); empty.textContent = "Carico giornalieri…"; return; }
      const daily = aggregateByDay().slice(-90);
      labels = daily.map(([k]) => {
        const [y, m, d] = k.split("-");
        return `${d}/${m}`;
      });
      values = daily.map(([, v]) => v);
      ctxLabel = "Passaggi totali città — ultimi 90 giorni";
    } else if (state.trendRange === "month") {
      const months = derived.byMonth.slice(-24);
      labels = months.map(([k]) => {
        const [y, m] = k.split("-");
        return `${m}/${y.slice(2)}`;
      });
      values = months.map(([, v]) => v);
      ctxLabel = "Passaggi totali città — ultimi 24 mesi";
    } else {
      const years = derived.byYear;
      labels = years.map(([y]) => String(y));
      values = years.map(([, v]) => v);
      ctxLabel = `Passaggi totali città — ${years.length ? `${years[0][0]}–${years[years.length - 1][0]}` : ""}`;
    }

    if (!values.length) { empty.classList.remove("hidden"); empty.textContent = "Nessun dato."; return; }
    empty.classList.add("hidden");

    const accent = getCssVar("--accent") || "#d4ff3a";
    const accentInk = getCssVar("--accent-ink") || "#0a0a0a";
    const ink = getCssVar("--ink") || "#f5f5f4";
    const accentRGB = hexToRgb(accent);
    const accentSoft = (a) => accentRGB ? `rgba(${accentRGB},${a})` : `rgba(212,255,58,${a})`;

    const isBar = state.trendRange !== "day";
    const type = isBar ? "bar" : "line";
    const datasets = isBar
      ? [{
          data: values,
          backgroundColor: accent,
          hoverBackgroundColor: ink,
          borderRadius: 4,
          borderSkipped: false,
        }]
      : [{
          data: values,
          borderColor: accent,
          backgroundColor: (c) => {
            const { chart } = c;
            const { ctx, chartArea } = chart;
            if (!chartArea) return accentSoft(0.15);
            const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            grad.addColorStop(0, accentSoft(0.35));
            grad.addColorStop(1, accentSoft(0));
            return grad;
          },
          fill: true,
          tension: 0.32,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: accent,
          pointHoverBorderColor: accentInk,
          pointHoverBorderWidth: 2,
        }];

    trendChart = chartBase(canvas.getContext("2d"), type, labels, datasets);
    legend.textContent = ctxLabel;
  };

  const renderMonthsChart = () => {
    const canvas = document.getElementById("chart-months");
    if (!canvas) return;
    if (monthsChart) { monthsChart.destroy(); monthsChart = null; }
    const labels = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
    const values = derived.monthAvg.map((v) => Math.round(v));
    const accent = getCssVar("--accent") || "#d4ff3a";
    const accentRGB = hexToRgb(accent) || "212,255,58";
    const inkSoft = getCssVar("--ink-soft") || "#9ca3af";
    const gridLine = getCssVar("--grid-line") || "rgba(255,255,255,0.05)";
    monthsChart = chartBase(canvas.getContext("2d"), "bar", labels, [{
      data: values,
      backgroundColor: values.map((v) => {
        const maxV = Math.max(...values, 1);
        const i = v / maxV;
        const a = 0.35 + i * 0.65;
        return `rgba(${accentRGB}, ${a})`;
      }),
      borderRadius: 4,
      borderSkipped: false,
    }], {
      scales: {
        y: {
          ticks: {
            color: inkSoft,
            font: { family: "JetBrains Mono", size: 10 },
            maxTicksLimit: 4,
            callback: (v) => compactFmt(v),
          },
          grid: { color: gridLine, drawTicks: false },
          border: { display: false },
        },
      },
    });
  };

  const renderWeekdays = () => {
    const container = document.getElementById("weekdays");
    if (!container) return;
    const daily = aggregateByDay();
    const cutoff = new Date(TODAY); cutoff.setDate(cutoff.getDate() - 365);
    const sums = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const [k, v] of daily) {
      const d = new Date(k);
      if (d < cutoff) continue;
      const wd = (d.getDay() + 6) % 7;
      sums[wd] += v;
      counts[wd] += 1;
    }
    const avgs = sums.map((s, i) => counts[i] ? s / counts[i] : 0);
    const max = Math.max(...avgs, 1);
    const maxIdx = avgs.indexOf(max);
    const labels = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
    container.innerHTML = "";
    for (let i = 0; i < 7; i++) {
      const intensity = avgs[i] / max;
      const el = document.createElement("div");
      el.className = "weekday" + (i === maxIdx ? " peak" : "");
      el.style.setProperty("--intensity", (intensity * 0.4).toFixed(3));
      el.innerHTML = `
        <span class="weekday-label">${labels[i]}</span>
        <span class="weekday-value">${avgs[i] ? compactFmt(Math.round(avgs[i])) : "—"}</span>
      `;
      container.appendChild(el);
    }
  };

  const renderRankTable = () => {
    const ctx = document.getElementById("rank-ctx");
    const tbody = document.querySelector("#rank-table tbody");
    if (!tbody) return;
    const metric = state.rankRange;

    const valueFor = (c) => {
      if (metric === "total") return c.total || 0;
      if (metric === "lastDay") return c.lastDay || 0;
      if (metric === "year") {
        const s = monthlySeries.find((x) => x && x.counter.idPdc === c.idPdc);
        if (!s) return 0;
        const y = TODAY.getFullYear();
        return s.data.filter(([d]) => d.getFullYear() === y).reduce((a, [, v]) => a + v, 0);
      }
      return 0;
    };

    const rows = counters
      .map((c) => ({ c, v: valueFor(c) }))
      .sort((a, b) => b.v - a.v);

    const max = rows.length ? rows[0].v : 1;
    tbody.innerHTML = "";
    const ctxLabel = { total: "— totale storico", year: `— anno ${TODAY.getFullYear()}`, lastDay: "— passaggi ieri" }[metric];
    ctx.textContent = ctxLabel;

    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      const pct = max ? (r.v / max) * 100 : 0;
      tr.innerHTML = `
        <td class="col-rank">${i + 1}</td>
        <td class="col-name" title="${escapeHtml(r.c.nom)}">${escapeHtml(r.c.nom)}</td>
        <td class="col-bar"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div></td>
        <td class="col-val">${numberFmt.format(r.v)}</td>
        <td class="col-from">${escapeHtml(r.c.debut)}</td>
      `;
      tbody.appendChild(tr);
    });

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-row">Nessun contatore.</td></tr>';
    }
  };

  const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  document.querySelectorAll(".tabs [data-range]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs [data-range]").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      state.trendRange = btn.dataset.range;
      renderTrend();
    });
  });

  document.querySelectorAll(".tabs [data-rank]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabs [data-rank]").forEach((b) => {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      state.rankRange = btn.dataset.rank;
      renderRankTable();
    });
  });

  // ---- Day picker -------------------------------------------------------
  const dayInput = document.getElementById("day-picker");
  const dayPrev = document.getElementById("day-prev");
  const dayNext = document.getElementById("day-next");

  const isoToDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const dateToIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const dayCache = new Map();

  const fetchDay = async (counter, iso) => {
    const key = `${counter.idPdc}:${iso}`;
    if (dayCache.has(key)) return dayCache.get(key);
    const d = isoToDate(iso);
    // API is semi-open [debut, fin): fin is excluded. Ask 2 days starting from D.
    const dayAfter = new Date(d); dayAfter.setDate(d.getDate() + 1);
    const params = new URLSearchParams({
      idOrganisme: String(ORG_ID),
      idPdc: String(counter.idPdc),
      debut: fmtDateForApi(d),
      fin: fmtDateForApi(dayAfter),
      interval: "4",
      flowIds: flowIdsFor(counter),
    });
    try {
      const resp = await fetch(`${API_BASE}data/${counter.idPdc}?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = await resp.json();
      const target = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
      const match = rows.find(([rd]) => rd === target);
      const v = match ? parseInt(match[1], 10) || 0 : 0;
      dayCache.set(key, v);
      return v;
    } catch (err) {
      console.warn("day fetch failed", counter.idPdc, err);
      return null;
    }
  };

  let dayLoadToken = 0;

  const renderDay = async (iso) => {
    if (!counters.length) return;
    const myToken = ++dayLoadToken;

    const ctx = document.getElementById("day-ctx");
    const tbody = document.querySelector("#day-table tbody");
    const dateObj = isoToDate(iso);
    const human = dateObj.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    ctx.textContent = `— ${human}`;

    document.getElementById("day-total").textContent = "—";
    document.getElementById("day-vs-avg").textContent = "carico…";
    document.getElementById("day-vs-avg").className = "day-meta";
    document.getElementById("day-top-name").textContent = "—";
    document.getElementById("day-top-val").textContent = "";
    document.getElementById("day-active").textContent = "—";
    document.getElementById("day-active-meta").textContent = "";
    tbody.innerHTML = '<tr><td colspan="5" class="loading-row">Carico passaggi del giorno…</td></tr>';

    setLoader("day", `Carico ${human}…`);
    const values = await runBatched(counters, async (c) => ({ c, v: await fetchDay(c, iso) }));
    setLoader("day", null);
    if (myToken !== dayLoadToken) return;

    const rows = values.filter(Boolean).sort((a, b) => (b.v || 0) - (a.v || 0));
    const total = rows.reduce((a, r) => a + (r.v || 0), 0);
    const active = rows.filter((r) => r.v !== null && r.v > 0).length;
    const top = rows[0];
    const max = top ? (top.v || 0) : 1;

    document.getElementById("day-total").textContent = numberFmt.format(total);
    document.getElementById("day-active").textContent = `${active} / ${counters.length}`;
    document.getElementById("day-active-meta").textContent = active < counters.length ? `${counters.length - active} senza dato` : "tutte attive";

    if (top) {
      document.getElementById("day-top-name").textContent = top.c.nom;
      document.getElementById("day-top-val").textContent = `${numberFmt.format(top.v || 0)} passaggi`;
    }

    const wd = (dateObj.getDay() + 6) % 7;
    const baselineSum = computeWeekdayBaseline(wd, iso);
    const vsAvgEl = document.getElementById("day-vs-avg");
    if (baselineSum > 0) {
      const delta = (total - baselineSum) / baselineSum;
      vsAvgEl.textContent = `${pctFmt(delta)} vs media ${["lun", "mar", "mer", "gio", "ven", "sab", "dom"][wd]}`;
      vsAvgEl.classList.toggle("up", delta > 0);
      vsAvgEl.classList.toggle("down", delta < 0);
    } else {
      vsAvgEl.textContent = "";
    }

    tbody.innerHTML = "";
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      const pct = max ? ((r.v || 0) / max) * 100 : 0;
      const tag = r.c.mainPratique === 7 ? "ciclisti + pedoni" : "ciclisti";
      const valDisplay = r.v === null ? '<span class="t-muted">—</span>' : numberFmt.format(r.v);
      tr.innerHTML = `
        <td class="col-rank">${i + 1}</td>
        <td class="col-name" title="${escapeHtml(r.c.nom)}">${escapeHtml(r.c.nom)}</td>
        <td class="col-bar"><div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div></td>
        <td class="col-val">${valDisplay}</td>
        <td class="col-from">${tag}</td>
      `;
      tbody.appendChild(tr);
    });
  };

  const computeWeekdayBaseline = (wd, excludeIso) => {
    if (!dailySeries.length) return 0;
    let sum = 0, count = 0;
    const buckets = new Map();
    for (const s of dailySeries) {
      if (!s) continue;
      for (const [d, v] of s.data) {
        if ((d.getDay() + 6) % 7 !== wd) continue;
        const key = d.toISOString().slice(0, 10);
        if (key === excludeIso) continue;
        buckets.set(key, (buckets.get(key) || 0) + v);
      }
    }
    for (const v of buckets.values()) { sum += v; count++; }
    return count ? sum / count : 0;
  };

  const setDate = (iso) => {
    if (!iso) return;
    dayInput.value = iso;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sel = isoToDate(iso);
    dayNext.disabled = sel >= today;
    dayPrev.disabled = false;
    renderDay(iso);
  };

  const yesterdayIso = () => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return dateToIso(d);
  };

  dayInput.value = yesterdayIso();
  dayInput.max = dateToIso(new Date());
  dayInput.min = "2019-05-10";

  dayInput.addEventListener("change", () => setDate(dayInput.value));
  dayPrev.addEventListener("click", () => {
    const d = isoToDate(dayInput.value); d.setDate(d.getDate() - 1);
    setDate(dateToIso(d));
  });
  dayNext.addEventListener("click", () => {
    const d = isoToDate(dayInput.value); d.setDate(d.getDate() + 1);
    setDate(dateToIso(d));
  });

  // First render once counters arrive (slight delay so init populates)
  const waitForCounters = setInterval(() => {
    if (counters.length) {
      clearInterval(waitForCounters);
      setDate(dayInput.value);
    }
  }, 250);

  window.addEventListener("error", (e) => {
    loader.classList.remove("hidden");
    loaderText.textContent = `JS error: ${e.message}`;
    console.error("global error", e.error || e.message, e.filename, e.lineno);
  });
  window.addEventListener("unhandledrejection", (e) => {
    loader.classList.remove("hidden");
    loaderText.textContent = `Promise error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`;
    console.error("unhandled rejection", e.reason);
  });

  window.addEventListener("themechange", () => {
    if (monthlySeries.length) renderMonthsChart();
    renderTrend();
    renderWeekdays();
  });

  init().catch((err) => {
    loader.classList.remove("hidden");
    loaderText.textContent = `Errore: ${err.message || err}`;
    console.error("init failed", err);
  });
})();
