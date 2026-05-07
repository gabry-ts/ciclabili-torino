// @ts-nocheck
// Map page logic. Uses L (Leaflet), L.heatLayer (leaflet.heat) and Chart (Chart.js)
// loaded globally via CDN scripts in index.astro.
(() => {
  const CONFIG = window.APP_CONFIG || {};
  const ORG_ID = CONFIG.orgId || 6771;
  const API_BASE = CONFIG.apiBase || "https://www.eco-visio.net/api/aladdin/1.0.0/pbl/publicwebpageplus/";
  const TORINO_CENTER = [45.0703, 7.6869];
  const CATEGORY_FALLBACK = {
    cycleway: "#d4ff3a",
    track: "#7dd3fc",
    lane: "#fbbf24",
    shared_lane: "#c084fc",
    designated_path: "#f472b6",
    other: "#4b5563",
  };
  const lineColor = (cat) => getCssVar(`--cat-${cat}`) || CATEGORY_FALLBACK[cat] || CATEGORY_FALLBACK.other;
  const BASE_WEIGHTS = {
    cycleway: 4.2,
    track: 3.6,
    lane: 3.0,
    shared_lane: 2.8,
    designated_path: 2.8,
    other: 2.2,
  };
  const CATEGORY_OPACITY = {
    cycleway: 1,
    track: 0.95,
    lane: 0.95,
    shared_lane: 0.9,
    designated_path: 0.9,
    other: 0.7,
  };
  const CASING_EXTRA = 3;
  const numberFmt = new Intl.NumberFormat("it-IT");

  const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const currentTheme = () => document.documentElement.getAttribute("data-theme") || "dark";

  const map = L.map("map", { zoomControl: true, preferCanvas: true, zoomSnap: 0.25 }).setView(TORINO_CENTER, 13);

  const casingRenderer = L.canvas({ padding: 0.4 });
  const lineRenderer = L.canvas({ padding: 0.4 });
  casingRenderer.addTo(map);
  lineRenderer.addTo(map);

  const TILES = {
    dark: { base: "dark_nolabels", labels: "dark_only_labels" },
    light: { base: "light_nolabels", labels: "light_only_labels" },
  };
  let baseTileLayer = null, labelsTileLayer = null;
  const setTilesForTheme = (theme) => {
    if (baseTileLayer) map.removeLayer(baseTileLayer);
    if (labelsTileLayer) map.removeLayer(labelsTileLayer);
    const t = TILES[theme] || TILES.dark;
    baseTileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${t.base}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &middot; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);
    labelsTileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${t.labels}/{z}/{x}/{y}{r}.png`, {
      subdomains: "abcd",
      maxZoom: 20,
      pane: "shadowPane",
    }).addTo(map);
  };
  setTilesForTheme(currentTheme());

  const loader = document.getElementById("loader");
  const loaderText = loader.querySelector(".loader-text");
  const activeLoads = new Set();
  const setLoader = (key, text) => {
    if (text) {
      activeLoads.add(key);
      loaderText.textContent = text;
      loader.classList.remove("hidden");
    } else {
      activeLoads.delete(key);
      if (activeLoads.size === 0) loader.classList.add("hidden");
    }
  };

  const pathLayers = {};
  const pathCounts = {};

  const zoomFactor = (z) => {
    if (z >= 16) return 1.45;
    if (z >= 14) return 1.15;
    if (z >= 12) return 0.85;
    return 0.6;
  };

  const styleLine = (cat, z) => ({
    color: lineColor(cat),
    weight: (BASE_WEIGHTS[cat] || 2) * zoomFactor(z),
    opacity: CATEGORY_OPACITY[cat] || 0.8,
    lineCap: "round",
    lineJoin: "round",
  });
  const styleCasing = (cat, z) => ({
    color: getCssVar("--casing") || "rgba(0,0,0,0.7)",
    weight: (BASE_WEIGHTS[cat] || 2) * zoomFactor(z) + CASING_EXTRA,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round",
  });

  let lastZoomBucket = null;
  const restylePaths = (force) => {
    const z = map.getZoom();
    const bucket = zoomFactor(z);
    if (!force && bucket === lastZoomBucket) return;
    lastZoomBucket = bucket;
    for (const cat of Object.keys(pathLayers)) {
      const e = pathLayers[cat];
      e.line.setStyle(styleLine(cat, z));
      e.casing.setStyle(styleCasing(cat, z));
    }
  };

  map.on("zoomend", () => restylePaths(false));
  window.addEventListener("themechange", () => {
    setTilesForTheme(currentTheme());
    restylePaths(true);
  });

  const loadPaths = async () => {
    setLoader("paths", "Carico le ciclabili...");
    try {
      const resp = await fetch("/data/ciclabili-torino.geojson");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const gj = await resp.json();

      const grouped = new Map();
      for (const f of gj.features) {
        const c = f.properties.category || "other";
        if (!grouped.has(c)) grouped.set(c, []);
        grouped.get(c).push(f);
      }

      const built = [];
      for (const [cat, features] of grouped.entries()) {
        pathCounts[cat] = features.length;
        const fc = { type: "FeatureCollection", features };
        const casing = L.geoJSON(fc, {
          renderer: casingRenderer,
          style: () => styleCasing(cat, map.getZoom()),
          interactive: false,
        });
        const line = L.geoJSON(fc, {
          renderer: lineRenderer,
          style: () => styleLine(cat, map.getZoom()),
          onEachFeature: (feat, l) => {
            const p = feat.properties;
            const lbl = p.name ? `<strong>${escapeHtml(p.name)}</strong><br>` : "";
            l.bindTooltip(`${lbl}<small>${categoryLabel(cat)}</small>`, { sticky: true });
          },
        });
        built.push({ cat, casing, line });
      }
      built.forEach(({ casing }) => casing.addTo(map));
      built.forEach(({ line }) => line.addTo(map));
      built.forEach(({ cat, casing, line }) => {
        pathLayers[cat] = { casing, line };
      });

      for (const cat of Object.keys(CATEGORY_COLORS)) {
        const el = document.getElementById(`c-${cat}`);
        if (el) el.textContent = pathCounts[cat] ? numberFmt.format(pathCounts[cat]) : "";
      }

      document.querySelectorAll("[data-filter-cat]").forEach((cb) => {
        cb.addEventListener("change", () => {
          const cat = cb.dataset.filterCat;
          const ent = pathLayers[cat];
          if (!ent) return;
          if (cb.checked) {
            ent.casing.addTo(map);
            ent.line.addTo(map);
          } else {
            map.removeLayer(ent.casing);
            map.removeLayer(ent.line);
          }
        });
      });
    } catch (err) {
      console.error("Failed to load paths", err);
    } finally {
      setLoader("paths", null);
    }
  };

  const counterLayer = L.layerGroup().addTo(map);
  const counterMarkers = new Map();
  let allCounters = [];

  const markerHtml = (value, mainPratique, stale) => {
    const cls = ["counter-marker"];
    if (mainPratique === 7) cls.push("mixed");
    if (stale) cls.push("stale");
    const size = value >= 1000 ? 44 : value >= 300 ? 36 : 30;
    const display = value >= 1000 ? `${Math.round(value / 100) / 10}k` : value;
    return L.divIcon({
      html: `<div class="${cls.join(" ")}" style="width:${size}px;height:${size}px;">${display}</div>`,
      className: "",
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  };

  const tooltipHtml = (c) => {
    const mixed = c.mainPratique === 7;
    const stale = !c.lastDay;
    const yday = stale
      ? '<span class="t-muted">nessun dato ieri</span>'
      : `<strong>${numberFmt.format(c.lastDay)}</strong> <span class="t-muted">passaggi ieri</span>`;
    return `
      <div class="t-counter ${mixed ? "mixed" : ""}">
        <div class="t-name">${escapeHtml(c.nom)}</div>
        <div class="t-row">${yday}</div>
        <div class="t-row"><strong>${numberFmt.format(c.moyD || 0)}</strong> <span class="t-muted">media/giorno</span></div>
        <div class="t-row t-tag">${mixed ? "&#x1F6B4; + &#x1F6B6; ciclisti + pedoni" : "&#x1F6B4; solo ciclisti"}</div>
        <div class="t-hint">click per dettagli</div>
      </div>
    `;
  };

  const popupHtml = (c) => {
    const today = new Date();
    const yday = new Date(today); yday.setDate(yday.getDate() - 1);
    const ydayStr = yday.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
    const mixed = c.mainPratique === 7;
    return `
      <div class="popup-counter ${mixed ? "mixed" : ""}" data-id="${c.idPdc}">
        <span class="tag">${mixed ? "&#x1F6B4; + &#x1F6B6; Ciclisti + pedoni" : "&#x1F6B4; Ciclisti"}</span>
        <h3>${escapeHtml(c.nom)}</h3>
        <div class="meta">Attivo dal ${escapeHtml(c.debut)}</div>
        <div class="stats">
          <div class="stat highlight"><small>${ydayStr}</small><strong>${numberFmt.format(c.lastDay || 0)}</strong></div>
          <div class="stat"><small>Media/giorno</small><strong>${numberFmt.format(c.moyD || 0)}</strong></div>
          <div class="stat"><small>Totale</small><strong>${formatTotal(c.total || 0)}</strong></div>
        </div>
        <div class="chart-loading">Carico 30 giorni&hellip;</div>
        <div class="chart-wrap" style="display:none;"><canvas></canvas></div>
      </div>
    `;
  };

  const formatTotal = (n) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return numberFmt.format(n);
  };

  const flowIdsFor = (counter) => (counter.pratique || []).map((p) => p.id).join(";");

  const fmtDateForApi = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const loadHistory = async (counter, container) => {
    const chartLoading = container.querySelector(".chart-loading");
    const chartWrap = container.querySelector(".chart-wrap");
    const canvas = chartWrap.querySelector("canvas");

    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 30);
    const params = new URLSearchParams({
      idOrganisme: String(ORG_ID),
      idPdc: String(counter.idPdc),
      debut: fmtDateForApi(start),
      fin: fmtDateForApi(end),
      interval: "4",
      flowIds: flowIdsFor(counter),
    });
    try {
      const resp = await fetch(`${API_BASE}data/${counter.idPdc}?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const rows = await resp.json();
      const labels = rows.map(([d]) => {
        const [mm, dd] = d.split("/");
        return `${dd}/${mm}`;
      });
      const values = rows.map(([, v]) => parseInt(v, 10) || 0);

      chartLoading.style.display = "none";
      chartWrap.style.display = "block";

      const accent = getCssVar("--accent") || "#d4ff3a";
      const ink = getCssVar("--ink") || "#f5f5f4";
      const inkSoft = getCssVar("--ink-soft") || "#9ca3af";
      const surface = getCssVar("--surface") || "#171717";
      const borderStrong = getCssVar("--border-strong") || "#333333";
      const gridLine = getCssVar("--grid-line") || "rgba(255,255,255,0.05)";
      new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: accent,
            hoverBackgroundColor: ink,
            borderRadius: 2,
            borderSkipped: false,
          }],
        },
        options: {
          animation: { duration: 350 },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: surface,
              borderColor: borderStrong,
              borderWidth: 1,
              titleColor: ink,
              bodyColor: accent,
              titleFont: { family: "JetBrains Mono", size: 10, weight: "500" },
              bodyFont: { family: "JetBrains Mono", size: 11, weight: "600" },
              padding: 8,
              displayColors: false,
              callbacks: { label: (ctx) => ` ${numberFmt.format(ctx.parsed.y)} passaggi` },
            },
          },
          scales: {
            x: {
              ticks: { color: inkSoft, font: { family: "JetBrains Mono", size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
              grid: { display: false },
              border: { color: gridLine },
            },
            y: {
              ticks: { color: inkSoft, font: { family: "JetBrains Mono", size: 9 }, maxTicksLimit: 4 },
              grid: { color: gridLine, drawTicks: false },
              border: { display: false },
            },
          },
        },
      });
    } catch (err) {
      console.error("history fetch failed", err);
      chartLoading.textContent = "Storico non disponibile.";
    }
  };

  const loadCounters = async () => {
    setLoader("counters", "Carico i contatori...");
    try {
      const resp = await fetch(`${API_BASE}${ORG_ID}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const counters = await resp.json();

      allCounters = counters;
      let sumLastDay = 0, sumTotal = 0, activeCount = 0;
      counters.sort((a, b) => (b.lastDay || 0) - (a.lastDay || 0));

      for (const c of counters) {
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
        const stale = !c.lastDay || c.lastDay === 0;
        const val = c.lastDay || c.moyD || 0;
        const marker = L.marker([c.lat, c.lon], { icon: markerHtml(val, c.mainPratique, stale) });
        marker.bindTooltip(tooltipHtml(c), {
          direction: "top",
          offset: [0, -8],
          className: "counter-tooltip",
          opacity: 1,
        });
        marker.bindPopup(popupHtml(c), { maxWidth: 320, minWidth: 280, autoPanPadding: [40, 40] });
        marker.on("popupopen", (ev) => {
          const node = ev.popup.getElement().querySelector(".popup-counter");
          if (node && !node.dataset.loaded) {
            node.dataset.loaded = "1";
            loadHistory(c, node);
          }
        });
        marker.addTo(counterLayer);
        counterMarkers.set(c.idPdc, marker);

        sumLastDay += c.lastDay || 0;
        sumTotal += c.total || 0;
        activeCount++;
      }

      document.getElementById("m-counters").textContent = numberFmt.format(activeCount);
      document.getElementById("m-lastday").textContent = numberFmt.format(sumLastDay);
      document.getElementById("m-total").textContent = numberFmt.format(sumTotal);

      renderCounterList(counters);
    } catch (err) {
      console.error("Failed to load counters", err);
      document.getElementById("counter-list").innerHTML = '<li class="placeholder">Dati contatori non disponibili.</li>';
    } finally {
      setLoader("counters", null);
    }
  };

  const renderCounterList = (counters) => {
    const list = document.getElementById("counter-list");
    list.innerHTML = "";
    const top = counters.slice(0, 20);
    for (let i = 0; i < top.length; i++) {
      const c = top[i];
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="rank">${i + 1}</span>
        <span class="cname" title="${escapeHtml(c.nom)}">${escapeHtml(c.nom)}</span>
        <span class="cval">${numberFmt.format(c.lastDay || 0)}</span>
      `;
      li.addEventListener("click", () => {
        const m = counterMarkers.get(c.idPdc);
        if (!m) return;
        map.setView(m.getLatLng(), 16, { animate: true });
        m.openPopup();
      });
      list.appendChild(li);
    }
    if (top.length === 0) {
      list.innerHTML = '<li class="placeholder">Nessun contatore.</li>';
    }
  };

  const categoryLabel = (c) => ({
    cycleway: "Pista ciclabile dedicata",
    track: "Corsia ciclabile protetta",
    lane: "Corsia ciclabile su strada",
    shared_lane: "Corsia promiscua",
    designated_path: "Percorso ciclopedonale",
    other: "Altra infrastruttura",
  })[c] || "Infrastruttura ciclabile";

  const escapeHtml = (s) => String(s || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  const sidebar = document.getElementById("sidebar");
  const sidebarToggleBtn = document.getElementById("sidebar-toggle");
  const backdrop = document.createElement("button");
  backdrop.className = "sidebar-backdrop";
  backdrop.setAttribute("aria-label", "Chiudi pannello");
  backdrop.type = "button";
  document.body.appendChild(backdrop);

  const setSidebarOpen = (open) => {
    sidebar.classList.toggle("open", open);
    backdrop.classList.toggle("visible", open);
    document.body.classList.toggle("no-scroll", open && window.innerWidth <= 768);
  };

  sidebarToggleBtn.addEventListener("click", () => setSidebarOpen(!sidebar.classList.contains("open")));
  backdrop.addEventListener("click", () => setSidebarOpen(false));

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidebar.classList.contains("open")) setSidebarOpen(false);
  });

  // Close on map interaction (mobile UX nicety)
  map.on("click dragstart", () => {
    if (window.innerWidth <= 768 && sidebar.classList.contains("open")) setSidebarOpen(false);
  });

  // ---- Heatmap (hourly) ------------------------------------------------
  const heatRoot = document.querySelector(".heat-controls");
  const heatEnabled = document.getElementById("heat-enabled");
  const heatFromEl = document.getElementById("heat-from");
  const heatToEl = document.getElementById("heat-to");
  const heatWarn = document.getElementById("heat-warn");
  const heatLoad = document.getElementById("heat-load");
  const heatPlayer = document.getElementById("heat-player");
  const heatTime = document.getElementById("heat-time");
  const heatSlider = document.getElementById("heat-slider");
  const heatPlayBtn = document.getElementById("heat-play");
  const heatSpeedBtn = document.getElementById("heat-speed");
  const heatMeta = document.getElementById("heat-meta");

  const SPEEDS = [1, 2, 4];
  const BASE_INTERVAL_MS = 700;
  let speedIdx = 0;

  const isoToDate = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const dateToIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parseResponseDate = (s) => {
    const [mm, dd, yyyy] = s.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  };

  const today = new Date();
  const yday = new Date(today); yday.setDate(yday.getDate() - 1);
  const oneWeekAgo = new Date(yday); oneWeekAgo.setDate(yday.getDate() - 6);
  heatFromEl.value = dateToIso(oneWeekAgo);
  heatToEl.value = dateToIso(yday);
  heatFromEl.min = "2019-05-10";
  heatFromEl.max = dateToIso(yday);
  heatToEl.min = "2019-05-10";
  heatToEl.max = dateToIso(yday);

  const validate = () => {
    const from = isoToDate(heatFromEl.value);
    const to = isoToDate(heatToEl.value);
    if (to < from) { heatWarn.textContent = "La data fine deve essere uguale o successiva alla data inizio."; heatLoad.disabled = true; return false; }
    const diffDays = Math.round((to - from) / 86_400_000) + 1;
    if (diffDays > 14) { heatWarn.textContent = `Massimo 14 giorni (selezionati ${diffDays}).`; heatLoad.disabled = true; return false; }
    heatWarn.textContent = "";
    heatLoad.disabled = !heatEnabled.checked;
    return true;
  };
  heatFromEl.addEventListener("change", validate);
  heatToEl.addEventListener("change", validate);

  heatEnabled.addEventListener("change", () => {
    heatRoot.classList.toggle("enabled", heatEnabled.checked);
    if (heatEnabled.checked) {
      validate();
    } else {
      stopHeatmap();
    }
  });

  let heatLayer = null;
  let frames = [];
  let frameIdx = 0;
  let playTimer = null;

  const stopHeatmap = () => {
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    if (counterLayer && !map.hasLayer(counterLayer)) counterLayer.addTo(map);
    heatPlayer.hidden = true;
    if (playTimer) { clearInterval(playTimer); playTimer = null; heatPlayBtn.classList.remove("playing"); heatPlayBtn.innerHTML = "&#9654;"; }
  };

  const fetchHourly = async (counter, fromIso, toIso) => {
    const from = isoToDate(fromIso);
    const to = isoToDate(toIso);
    const toExclusive = new Date(to); toExclusive.setDate(to.getDate() + 1);
    const params = new URLSearchParams({
      idOrganisme: String(ORG_ID),
      idPdc: String(counter.idPdc),
      debut: fmtDateForApi(from),
      fin: fmtDateForApi(toExclusive),
      interval: "3",
      flowIds: flowIdsFor(counter),
    });
    const resp = await fetch(`${API_BASE}data/${counter.idPdc}?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  };

  const parseHourly = (rows) => {
    const out = new Map();
    let lastDay = null, hourIdx = 0;
    for (const [d, v] of rows) {
      const dt = parseResponseDate(d);
      const dayKey = dateToIso(dt);
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        hourIdx = 0;
        out.set(dayKey, new Array(24).fill(0));
      }
      if (hourIdx < 24) out.get(dayKey)[hourIdx] = parseInt(v, 10) || 0;
      hourIdx++;
    }
    return out;
  };

  const runBatchedHeat = async (items, worker, concurrency = 6) => {
    const results = new Array(items.length);
    let idx = 0;
    const runNext = async () => {
      while (idx < items.length) {
        const my = idx++;
        try { results[my] = await worker(items[my]); }
        catch (err) { results[my] = null; console.warn("heat fetch failed", err); }
      }
    };
    const pool = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
    await Promise.all(pool);
    return results;
  };

  let heatMaxIntensity = 200;

  const buildFrames = (fromIso, toIso, dataByCounter) => {
    const days = [];
    const start = isoToDate(fromIso);
    const end = isoToDate(toIso);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      days.push(dateToIso(d));
    }
    const out = [];
    let observedMax = 0;
    for (const day of days) {
      for (let h = 0; h < 24; h++) {
        const points = [];
        for (const c of allCounters) {
          const dayMap = dataByCounter.get(c.idPdc);
          if (!dayMap) continue;
          const arr = dayMap.get(day);
          if (!arr) continue;
          const v = arr[h] || 0;
          if (v > 0) {
            points.push([c.lat, c.lon, v]);
            if (v > observedMax) observedMax = v;
          }
        }
        out.push({ day, hour: h, points });
      }
    }
    heatMaxIntensity = Math.max(40, Math.round(observedMax * 0.45));
    return out;
  };

  const formatFrame = (f) => {
    const dt = isoToDate(f.day);
    const dayStr = dt.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    return `${dayStr} &middot; ${String(f.hour).padStart(2, "0")}:00`;
  };

  const HEAT_OPTIONS = {
    radius: 75,
    blur: 55,
    maxZoom: 18,
    minOpacity: 0.55,
    gradient: {
      0.05: "#312e81",
      0.2: "#1d4ed8",
      0.4: "#0ea5e9",
      0.55: "#84cc16",
      0.7: "#facc15",
      0.85: "#f97316",
      1.0: "#dc2626",
    },
  };

  const renderFrame = (idx) => {
    if (idx < 0 || idx >= frames.length) return;
    if (typeof L.heatLayer !== "function") {
      console.error("leaflet.heat plugin not loaded");
      return;
    }
    frameIdx = idx;
    heatSlider.value = String(idx);
    const f = frames[idx];

    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    heatLayer = L.heatLayer(f.points, { ...HEAT_OPTIONS, max: heatMaxIntensity }).addTo(map);

    heatTime.innerHTML = formatFrame(f);
    const totalAtHour = f.points.reduce((a, p) => a + p[2], 0);
    heatMeta.textContent = `${f.points.length} postazioni · ${totalAtHour.toLocaleString("it-IT")} passaggi`;
  };

  heatLoad.addEventListener("click", async () => {
    if (!validate()) return;
    if (!allCounters.length) { heatWarn.textContent = "Contatori ancora in caricamento…"; return; }
    const fromIso = heatFromEl.value;
    const toIso = heatToEl.value;
    heatLoad.disabled = true;
    heatLoad.textContent = "Carico…";
    setLoader("heat", `Carico orari ${fromIso} → ${toIso}…`);
    const dataByCounter = new Map();
    const results = await runBatchedHeat(allCounters, async (c) => {
      const rows = await fetchHourly(c, fromIso, toIso);
      return { id: c.idPdc, parsed: parseHourly(rows) };
    });
    for (const r of results) {
      if (r) dataByCounter.set(r.id, r.parsed);
    }
    setLoader("heat", null);
    heatLoad.disabled = false;
    heatLoad.textContent = "Ricarica intervallo";

    frames = buildFrames(fromIso, toIso, dataByCounter);
    if (!frames.length) { heatWarn.textContent = "Nessun dato disponibile per il range scelto."; return; }

    if (map.hasLayer(counterLayer)) map.removeLayer(counterLayer);
    heatPlayer.hidden = false;
    heatSlider.min = "0";
    heatSlider.max = String(frames.length - 1);
    const initialIdx = Math.min(8, frames.length - 1);
    renderFrame(initialIdx);
  });

  heatSlider.addEventListener("input", () => {
    renderFrame(parseInt(heatSlider.value, 10) || 0);
  });

  const startTimer = () => {
    if (playTimer) clearInterval(playTimer);
    playTimer = setInterval(() => {
      const next = (frameIdx + 1) % frames.length;
      renderFrame(next);
    }, BASE_INTERVAL_MS / SPEEDS[speedIdx]);
  };

  heatPlayBtn.addEventListener("click", () => {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
      heatPlayBtn.classList.remove("playing");
      heatPlayBtn.innerHTML = "&#9654;";
    } else {
      heatPlayBtn.classList.add("playing");
      heatPlayBtn.innerHTML = "&#10074;&#10074;";
      startTimer();
    }
  });

  heatSpeedBtn.addEventListener("click", () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    const s = SPEEDS[speedIdx];
    heatSpeedBtn.textContent = `${s}×`;
    heatSpeedBtn.classList.toggle("boost", s > 1);
    if (playTimer) startTimer();
  });

  // ---- Reports (Segnala) -----------------------------------------------
  const REPORTS_KEY = "ciclabili.reports";
  const NEARBY_RADIUS_M = 100;
  const MAX_PHOTOS = 3;
  const MAX_PHOTO_DIM = 1600;
  const PHOTO_QUALITY = 0.82;

  const CAT_LABELS = {
    interruzione: "Interruzione",
    pavimento: "Pavimento",
    segnaletica: "Segnaletica",
    ostacolo: "Ostacolo",
    illuminazione: "Illuminazione",
    incrocio: "Incrocio",
    altro: "Altro",
  };
  const CAT_ICONS = {
    interruzione: "⚠",
    pavimento: "▣",
    segnaletica: "△",
    ostacolo: "✕",
    illuminazione: "✦",
    incrocio: "✚",
    altro: "?",
  };

  // Local stub – swap with real fetch() calls when backend is ready.
  const reportApi = {
    async list() {
      try { return JSON.parse(localStorage.getItem(REPORTS_KEY)) || []; }
      catch { return []; }
    },
    async create(report) {
      const all = await reportApi.list();
      all.push(report);
      localStorage.setItem(REPORTS_KEY, JSON.stringify(all));
      return report;
    },
    async remove(id) {
      const all = (await reportApi.list()).filter((r) => r.id !== id);
      localStorage.setItem(REPORTS_KEY, JSON.stringify(all));
    },
  };

  const reportLayer = L.layerGroup();
  const reportMarkers = new Map();

  const distMeters = (a, b) => {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(aa));
  };

  const reportPopupHtml = (r) => {
    const date = new Date(r.createdAt).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
    const photos = r.photos && r.photos.length
      ? `<div class="photos">${r.photos.map((p) => `<img src="${p}" alt="" />`).join("")}</div>`
      : "";
    return `
      <div class="report-popup" data-id="${escapeHtml(r.id)}">
        <span class="tag">${CAT_LABELS[r.category] || r.category}</span>
        <p>${escapeHtml(r.description)}</p>
        ${photos}
        <div class="meta">${date}</div>
        <button class="delete-btn">Elimina</button>
      </div>`;
  };

  const buildReportMarker = (r) => {
    const html = `<div class="report-marker cat-${r.category}"><span class="icon">${CAT_ICONS[r.category] || "?"}</span></div>`;
    const icon = L.divIcon({ html, className: "", iconSize: [28, 28], iconAnchor: [14, 28] });
    const m = L.marker([r.lat, r.lon], { icon });
    m.bindPopup(reportPopupHtml(r), { maxWidth: 320 });
    m.on("popupopen", (ev) => {
      const node = ev.popup.getElement().querySelector(".report-popup");
      const btn = node && node.querySelector(".delete-btn");
      if (btn) {
        btn.addEventListener("click", async () => {
          if (!confirm("Eliminare questa segnalazione?")) return;
          await reportApi.remove(r.id);
          await reloadReports();
        }, { once: true });
      }
    });
    return m;
  };

  const reloadReports = async () => {
    const reports = await reportApi.list();
    reportLayer.clearLayers();
    reportMarkers.clear();
    for (const r of reports) {
      const m = buildReportMarker(r);
      m.addTo(reportLayer);
      reportMarkers.set(r.id, m);
    }
  };

  // DOM refs
  const reportEnabled = document.getElementById("report-enabled");
  const reportShow = document.getElementById("report-show");
  const reportFlow = document.getElementById("report-flow");
  const stepSimilar = reportFlow.querySelector('[data-step="similar"]');
  const stepForm = reportFlow.querySelector('[data-step="form"]');
  const positionCurrent = document.getElementById("position-current");
  const positionTextEl = document.getElementById("position-text");
  const positionClear = document.getElementById("position-clear");
  const posInput = document.getElementById("pos-input");
  const posResults = document.getElementById("pos-results");
  const posMap = document.getElementById("pos-map");
  const posGps = document.getElementById("pos-gps");
  const similarList = document.getElementById("similar-list");
  const similarSkip = document.getElementById("similar-skip");
  const reportCat = document.getElementById("report-cat");
  const reportDesc = document.getElementById("report-desc");
  const reportCount = document.getElementById("report-count");
  const reportSubmitBtn = document.getElementById("report-submit");
  const reportCancel = document.getElementById("report-cancel");
  const reportFeedback = document.getElementById("report-feedback");
  const photoInput = document.getElementById("photo-input");
  const photoAdd = document.getElementById("photo-add");
  const photoThumbs = document.getElementById("photo-thumbs");

  const reportState = {
    position: null,
    photos: [],
    pinMarker: null,
    picking: false,
  };

  // Show existing reports layer based on toggle
  if (reportShow.checked) reportLayer.addTo(map);
  reportShow.addEventListener("change", () => {
    if (reportShow.checked) reportLayer.addTo(map);
    else map.removeLayer(reportLayer);
  });

  reloadReports();

  // ---- Toggle the reporting flow ----
  reportEnabled.addEventListener("change", () => {
    reportFlow.hidden = !reportEnabled.checked;
    if (!reportEnabled.checked) cancelFlow();
  });

  // ---- Pick position from map ----
  posMap.addEventListener("click", () => {
    reportState.picking = true;
    posMap.classList.add("active");
    setFeedback("Clicca sulla mappa nel punto del problema.", "");
  });

  map.on("click", (e) => {
    if (!reportState.picking) return;
    const { lat, lng } = e.latlng;
    setReportPosition(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    reportState.picking = false;
    posMap.classList.remove("active");
    setFeedback("", "");
  });

  // ---- GPS ----
  posGps.addEventListener("click", () => {
    if (!navigator.geolocation) { setFeedback("Geolocalizzazione non supportata da questo browser.", "error"); return; }
    setFeedback("Cercando la tua posizione…", "");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setReportPosition(latitude, longitude, "La mia posizione");
        setFeedback("", "");
      },
      (err) => setFeedback(`Errore GPS: ${err.message}`, "error"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });

  // ---- Nominatim search (debounced) ----
  let nominatimTimer = null;
  posInput.addEventListener("input", () => {
    clearTimeout(nominatimTimer);
    const q = posInput.value.trim();
    if (q.length < 3) { posResults.hidden = true; posResults.innerHTML = ""; return; }
    nominatimTimer = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + " Torino")}&format=json&countrycodes=it&viewbox=7.55,45.15,7.78,45.0&bounded=1&limit=8&addressdetails=1`;
        const resp = await fetch(url, { headers: { "Accept-Language": "it" } });
        const data = await resp.json();
        renderNominatim(data);
      } catch (e) {
        console.warn("nominatim error", e);
      }
    }, 350);
  });

  const renderNominatim = (results) => {
    if (!results.length) {
      posResults.innerHTML = '<li class="placeholder">Nessun risultato</li>';
      posResults.hidden = false;
      return;
    }
    posResults.innerHTML = results.map((r, i) => {
      const parts = r.display_name.split(",").map((s) => s.trim());
      const main = parts[0];
      const rest = parts.slice(1, 3).join(", ");
      return `<li data-idx="${i}">${escapeHtml(main)}<small>${escapeHtml(rest)}</small></li>`;
    }).join("");
    posResults.hidden = false;
    posResults.querySelectorAll("li[data-idx]").forEach((li) => {
      li.addEventListener("click", () => {
        const r = results[parseInt(li.dataset.idx, 10)];
        setReportPosition(parseFloat(r.lat), parseFloat(r.lon), r.display_name.split(",").slice(0, 2).join(","));
        posInput.value = "";
        posResults.hidden = true;
      });
    });
  };

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pos-search")) posResults.hidden = true;
  });

  // ---- Set/clear position ----
  const setReportPosition = (lat, lon, label) => {
    reportState.position = { lat, lon, label };
    positionTextEl.textContent = label;
    positionCurrent.hidden = false;
    if (reportState.pinMarker) map.removeLayer(reportState.pinMarker);
    reportState.pinMarker = L.circleMarker([lat, lon], {
      radius: 11,
      color: "#fff",
      fillColor: getCssVar("--warn") || "#ff3d6b",
      fillOpacity: 0.95,
      weight: 2,
    }).addTo(map);
    map.panTo([lat, lon]);
    showSimilarOrForm();
  };

  positionClear.addEventListener("click", () => {
    resetReportPosition();
    stepSimilar.hidden = true;
    stepForm.hidden = true;
  });

  const resetReportPosition = () => {
    reportState.position = null;
    positionCurrent.hidden = true;
    if (reportState.pinMarker) { map.removeLayer(reportState.pinMarker); reportState.pinMarker = null; }
  };

  // ---- Pre-check: similar reports nearby ----
  const showSimilarOrForm = async () => {
    const all = await reportApi.list();
    const near = all
      .map((r) => ({ r, d: distMeters({ lat: r.lat, lon: r.lon }, reportState.position) }))
      .filter((x) => x.d <= NEARBY_RADIUS_M)
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    if (!near.length) {
      stepSimilar.hidden = true;
      stepForm.hidden = false;
      validateReport();
      return;
    }
    similarList.innerHTML = near.map(({ r, d }) => `
      <li data-id="${escapeHtml(r.id)}">
        <span class="similar-cat">${CAT_LABELS[r.category]} &middot; ${Math.round(d)} m</span>
        <span class="similar-desc">${escapeHtml(r.description.slice(0, 90))}${r.description.length > 90 ? "…" : ""}</span>
        <span class="similar-meta">${new Date(r.createdAt).toLocaleDateString("it-IT")}</span>
      </li>
    `).join("");
    similarList.querySelectorAll("li[data-id]").forEach((li) => {
      li.addEventListener("click", () => {
        const id = li.dataset.id;
        const m = reportMarkers.get(id);
        if (m) { map.setView(m.getLatLng(), 17, { animate: true }); m.openPopup(); }
        cancelFlow();
      });
    });
    stepSimilar.hidden = false;
    stepForm.hidden = true;
  };

  similarSkip.addEventListener("click", () => {
    stepSimilar.hidden = true;
    stepForm.hidden = false;
    validateReport();
  });

  // ---- Form ----
  reportDesc.addEventListener("input", () => {
    reportCount.textContent = reportDesc.value.length;
    validateReport();
  });

  const validateReport = () => {
    const ok = reportState.position && reportDesc.value.trim().length >= 20;
    reportSubmitBtn.disabled = !ok;
  };

  // ---- Photo handling ----
  photoAdd.addEventListener("click", () => photoInput.click());

  const resizePhoto = async (file) => {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(MAX_PHOTO_DIM / bitmap.width, MAX_PHOTO_DIM / bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * ratio));
    const h = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();
    return canvas.toDataURL("image/jpeg", PHOTO_QUALITY);
  };

  photoInput.addEventListener("change", async () => {
    const files = Array.from(photoInput.files || []);
    for (const f of files) {
      if (reportState.photos.length >= MAX_PHOTOS) break;
      if (!f.type.startsWith("image/")) continue;
      try {
        const dataUrl = await resizePhoto(f);
        reportState.photos.push({ dataUrl });
      } catch (e) {
        console.warn("resize failed", e);
        setFeedback(`Foto non leggibile: ${f.name}`, "error");
      }
    }
    photoInput.value = "";
    renderThumbs();
  });

  const renderThumbs = () => {
    photoThumbs.innerHTML = reportState.photos.map((p, i) => `
      <div class="photo-thumb">
        <img src="${p.dataUrl}" alt="" />
        <button class="photo-rm" data-idx="${i}" aria-label="Rimuovi foto">&times;</button>
      </div>
    `).join("");
    photoThumbs.querySelectorAll(".photo-rm").forEach((b) => {
      b.addEventListener("click", () => {
        reportState.photos.splice(parseInt(b.dataset.idx, 10), 1);
        renderThumbs();
      });
    });
    photoAdd.disabled = reportState.photos.length >= MAX_PHOTOS;
  };

  // ---- Cancel & submit ----
  reportCancel.addEventListener("click", () => cancelFlow());

  const cancelFlow = () => {
    resetReportPosition();
    reportState.photos = [];
    renderThumbs();
    reportDesc.value = "";
    reportCount.textContent = "0";
    reportCat.value = "interruzione";
    setFeedback("", "");
    stepSimilar.hidden = true;
    stepForm.hidden = true;
    reportState.picking = false;
    posMap.classList.remove("active");
    validateReport();
  };

  reportSubmitBtn.addEventListener("click", async () => {
    if (!reportState.position) return;
    reportSubmitBtn.disabled = true;
    reportSubmitBtn.textContent = "Invio…";
    try {
      const report = {
        id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        lat: reportState.position.lat,
        lon: reportState.position.lon,
        label: reportState.position.label,
        category: reportCat.value,
        description: reportDesc.value.trim(),
        photos: reportState.photos.map((p) => p.dataUrl),
        createdAt: new Date().toISOString(),
        source: "local",
      };
      await reportApi.create(report);
      await reloadReports();
      setFeedback("Segnalazione salvata localmente. Grazie!", "success");
      setTimeout(() => cancelFlow(), 1600);
    } catch (e) {
      setFeedback(`Errore: ${e.message}`, "error");
    } finally {
      reportSubmitBtn.textContent = "Invia segnalazione";
      validateReport();
    }
  });

  const setFeedback = (text, kind) => {
    reportFeedback.textContent = text;
    reportFeedback.classList.remove("success", "error");
    if (kind) reportFeedback.classList.add(kind);
  };

  validateReport();

  loadPaths();
  loadCounters();
})();
