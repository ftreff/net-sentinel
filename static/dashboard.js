// dashboard.js
let map;
let markers = []; // array of L.Marker objects (for zoom-to-fit and individual mode)
let services = {}; // will hold services.json mapping
let currentClusterRadius = 40;
let useClusters = true;

// cluster groups for accepted and dropped markers
let acceptedClusters = null;
let droppedClusters = null;

/* Simple debounce helper */
function debounce(fn, wait) {
  let t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

/* Lazy popup marker factory: minimal DOM until clicked */
function createEventMarker(event) {
  const isDropped = String(event.verdict || '').toUpperCase() === 'DROP';
  const color = isDropped ? '#ff0000' : '#00ff00';

  const dotIcon = L.divIcon({
    className: 'event-dot-icon',
    html: `<span class="event-dot" style="background:${color};"></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8]
  });

  const marker = L.marker([event.latitude, event.longitude], { icon: dotIcon });

  // attach raw event data for lazy popup generation
  marker.eventData = event;

  // lazy popup: create popup content only when clicked
  marker.on('click', function () {
    const ev = this.eventData || {};
    const srcSvc = lookupService(Number(ev.src_port)) || ev.src_service || "Unknown";
    const dstSvc = lookupService(Number(ev.dst_port)) || ev.dst_service || "Unknown";

    const popupHtml = `
      <b>Source IP:</b> ${ev.src_ip || 'N/A'}<br>
      <b>Source Reverse DNS:</b> ${ev.src_rdns || "N/A"}<br>
      <b>Destination IP:</b> ${ev.dst_ip || 'N/A'}<br>
      <b>Destination Reverse DNS:</b> ${ev.dst_rdns || "N/A"}<br>
      <b>Source Port:</b> ${ev.src_port || "N/A"} (${srcSvc})<br>
      <b>Destination Port:</b> ${ev.dst_port || "N/A"} (${dstSvc})<br>
      <b>Direction:</b> ${ev.direction || 'N/A'}<br>
      <b>Protocol:</b> ${ev.proto || "N/A"}<br>
      <b>Interfaces:</b> IN=${ev.in_if || "?"} OUT=${ev.out_if || "?"}<br>
      <b>Verdict:</b> ${ev.verdict || 'N/A'}<br>
      <b>Country:</b> ${ev.country || "N/A"}<br>
      <b>Region:</b> ${ev.state || "N/A"}<br>
      <b>City:</b> ${ev.city || "N/A"}<br>
      <b>Hits:</b> ${ev.hit_count || 1}<br>
      <b>Timestamp:</b> ${ev.timestamp || 'N/A'}<br>
    `;
    this.bindPopup(popupHtml).openPopup();
  });

  return marker;
}

function initMap() {
  map = L.map("map", {
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 60,
    zoomControl: false
  }).setView([20, 0], 2);

  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors & CartoDB",
  });

  const light = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  });

  const baseMaps = { Dark: dark, Light: light };
  dark.addTo(map);

  L.control.layers(baseMaps, null, { position: "bottomright" }).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // create separate cluster groups for accepted and dropped events (chunked loading)
  acceptedClusters = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    maxClusterRadius: currentClusterRadius,
    chunkedLoading: true,
    chunkProgress: function(processed, total) {
      const statsBar = document.getElementById('statsBar');
      if (statsBar) {
        statsBar.dataset.loading = 'true';
        statsBar.textContent = `Loading markers: ${processed}/${total}`;
      }
      return false;
    },
    iconCreateFunction: function(cluster) {
      return L.divIcon({
        html: `<div><span>${cluster.getChildCount()}</span></div>`,
        className: 'marker-cluster-accepted',
        iconSize: L.point(40, 40)
      });
    }
  });

  droppedClusters = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    maxClusterRadius: currentClusterRadius,
    chunkedLoading: true,
    chunkProgress: function(processed, total) {
      const statsBar = document.getElementById('statsBar');
      if (statsBar) {
        statsBar.dataset.loading = 'true';
        statsBar.textContent = `Loading markers: ${processed}/${total}`;
      }
      return false;
    },
    iconCreateFunction: function(cluster) {
      return L.divIcon({
        html: `<div><span>${cluster.getChildCount()}</span></div>`,
        className: 'marker-cluster-dropped',
        iconSize: L.point(40, 40)
      });
    }
  });

  // add both groups to the map by default (they will be empty until loadEvents runs)
  acceptedClusters.addTo(map);
  droppedClusters.addTo(map);

  addTimeFilterControl();
  addStatsBar();       // no-op if #stats-box exists in map.html
  addZoomButton();
  initCustomPortToggle();
  addClusterRadiusControl();

  fetch("/data/services.json")
    .then(res => res.json())
    .then(data => {
      services = data || {};
      const timeSelect = document.getElementById("timeRange");
      if (timeSelect) timeSelect.value = "24h";
      // expose debounced filter handler
      window.onFilterChange = debounce(onFilterChange, 200);
      onFilterChange();
    })
    .catch(err => {
      console.error("Failed to load services.json:", err);
      const timeSelect = document.getElementById("timeRange");
      if (timeSelect) timeSelect.value = "24h";
      window.onFilterChange = debounce(onFilterChange, 200);
      onFilterChange();
    });

  // Listen for external refresh requests (e.g., stats refresh button)
  window.addEventListener("net_sentinel:refresh_stats", () => {
    loadStats();
  });
}

/* Stats bar control (compact fallback) */
function addStatsBar() {
  if (document.getElementById("stats-box")) {
    return;
  }

  const control = L.control({ position: "bottomleft" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "stats-bar");
    div.id = "statsBar";
    div.style.background = "rgba(0,0,0,0.7)";
    div.style.color = "white";
    div.style.padding = "6px";
    div.style.fontSize = "12px";
    div.style.maxHeight = "750px";
    div.style.overflowY = "auto";
    return div;
  };
  control.addTo(map);
}

function addTimeFilterControl() {
  const control = L.control({ position: "topright" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "filter-box");
    div.innerHTML = `
      <button id="resetFiltersBtn" onclick="resetFilters()">Reset Filters</button>

      <select id="timeRange" onchange="onFilterChange()">
        <option value="">All Time</option>
        <option value="1min">Last 1 min</option>
        <option value="5min">Last 5 min</option>
        <option value="10min">Last 10 min</option>
        <option value="30min">Last 30 min</option>
        <option value="1h">Last 1 hour</option>
        <option value="6h">Last 6 hours</option>
        <option value="12h">Last 12 hours</option>
        <option value="24h" selected>Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>

      <select id="verdictFilter" onchange="onFilterChange()">
        <option value="">All Verdicts</option>
        <option value="ACCEPT">Only ACCEPT</option>
        <option value="DROP">Only DROP</option>
      </select>

      <select id="protoFilter" onchange="onFilterChange()">
        <option value="">All Protocols</option>
        <option value="TCP">TCP</option>
        <option value="UDP">UDP</option>
        <option value="ICMP">ICMP</option>
      </select>

      <select id="directionFilter" onchange="onFilterChange()">
        <option value="">All Directions</option>
        <option value="INBOUND">Inbound</option>
        <option value="OUTBOUND">Outbound</option>
      </select>

      <select id="serviceCategoryFilter" onchange="onFilterChange()">
        <option value="">All Services</option>
        <option value="Web">Web (80,443,8080)</option>
        <option value="Mail">Mail (25,465,587)</option>
        <option value="Database">Database (3306,5432)</option>
        <option value="Remote">Remote (22,3389)</option>
        <option value="BitTorrent">BitTorrent (6881–6999, 51413, 16881, 63783, 6969, 7021)</option>
        <option value="Unknown">Unknown</option>
      </select>

      <select id="frequencyFilter" onchange="onFilterChange()">
        <option value="">All Frequencies</option>
        <option value=">1">>1</option>
        <option value=">5">>5</option>
        <option value=">10">>10</option>
        <option value=">25">>25</option>
        <option value=">50">>50</option>
        <option value=">100">>100</option>
        <option value=">500">>500</option>
        <option value=">1000">>1000</option>
      </select>

      <select id="countryFilter" onchange="onFilterChange()">
        <option value="">All Countries</option>
      </select>

      <select id="portFilter" onchange="onFilterChange()">
        <option value="">All Ports</option>
        <option value="custom">Enter Port #...</option>
      </select>
      <input id="customPort" type="text" placeholder="Port #"
             style="display:none;" onblur="onFilterChange()" />

      <input id="srcIpFilter" type="text" placeholder="Source IP" onblur="onFilterChange()" />
      <input id="dstIpFilter" type="text" placeholder="Destination IP" onblur="onFilterChange()" />
    `;
    return div;
  };
  control.addTo(map);
}

function addClusterRadiusControl() {
  const control = L.control({ position: "topright" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom");
    div.style.background = "black";
    div.style.color = "white";
    div.style.padding = "5px";

    const label = L.DomUtil.create("div", "", div);
    label.innerHTML = useClusters ?
      "Mode: Grouped (Radius " + currentClusterRadius + ")" :
      "Mode: Individual";

    const input = L.DomUtil.create("input", "", div);
    input.type = "range";
    input.min = 0;
    input.max = 100;
    input.value = currentClusterRadius;
    input.style.width = "100px";

    input.oninput = function () {
      const newRadius = parseInt(this.value);
      currentClusterRadius = newRadius;
      // update both cluster groups if they exist
      if (acceptedClusters) {
        acceptedClusters.options.maxClusterRadius = newRadius;
        if (typeof acceptedClusters.refreshClusters === 'function') acceptedClusters.refreshClusters();
      }
      if (droppedClusters) {
        droppedClusters.options.maxClusterRadius = newRadius;
        if (typeof droppedClusters.refreshClusters === 'function') droppedClusters.refreshClusters();
      }
      label.innerHTML = useClusters ?
        "Mode: Grouped (Radius " + newRadius + ")" :
        "Mode: Individual";
    };

    const button = L.DomUtil.create("button", "", div);
    button.innerHTML = "Toggle Grouped / Individual";
    button.style.marginTop = "5px";
    button.onclick = function () {
      useClusters = !useClusters;

      // remove cluster layers if present
      try {
        if (acceptedClusters && map.hasLayer(acceptedClusters)) map.removeLayer(acceptedClusters);
        if (droppedClusters && map.hasLayer(droppedClusters)) map.removeLayer(droppedClusters);
      } catch (e) {
        console.warn("Error removing cluster layers:", e);
      }

      // remove any individual markers from the map
      markers.forEach(m => {
        try { map.removeLayer(m); } catch (e) {}
      });

      // re-run filter to re-add markers in the chosen mode
      if (window.onFilterChange) window.onFilterChange();
      label.innerHTML = useClusters ?
        "Mode: Grouped (Radius " + currentClusterRadius + ")" :
        "Mode: Individual";
    };

    return div;
  };
  control.addTo(map);
}

function resetFilters() {
  const idsToReset = [
    "timeRange",
    "verdictFilter",
    "protoFilter",
    "directionFilter",
    "serviceCategoryFilter",
    "frequencyFilter",
    "countryFilter",
    "portFilter",
    "srcIpFilter",
    "dstIpFilter",
    "customPort"
  ];

  idsToReset.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === "SELECT") {
      if (id === "timeRange") {
        el.value = "24h";
      } else {
        el.value = "";
      }
    } else {
      el.value = "";
    }
  });

  const customPortInput = document.getElementById("customPort");
  if (customPortInput) customPortInput.style.display = "none";

  if (window.onFilterChange) window.onFilterChange();
  else onFilterChange();
}

function initCustomPortToggle() {
  const portSelect = document.getElementById("portFilter");
  const customPortInput = document.getElementById("customPort");
  if (!portSelect || !customPortInput) return;

  portSelect.addEventListener("change", () => {
    const useCustom = portSelect.value === "custom";
    customPortInput.style.display = useCustom ? "inline-block" : "none";
    if (!useCustom) customPortInput.value = "";
    if (window.onFilterChange) window.onFilterChange();
    else onFilterChange();
  });
}

function onFilterChange() {
  const timeEl = document.getElementById("timeRange");
  const timeVal = timeEl ? timeEl.value : "";
  const verdictEl = document.getElementById("verdictFilter");
  const verdictVal = verdictEl ? verdictEl.value : "";
  const protoEl = document.getElementById("protoFilter");
  const protoVal = protoEl ? protoEl.value : "";
  const directionEl = document.getElementById("directionFilter");
  let directionVal = directionEl ? directionEl.value : "";
  const serviceCategoryEl = document.getElementById("serviceCategoryFilter");
  let serviceCategoryVal = serviceCategoryEl ? serviceCategoryEl.value : "";
  const frequencyEl = document.getElementById("frequencyFilter");
  const frequencyVal = frequencyEl ? frequencyEl.value : "";
  const countryEl = document.getElementById("countryFilter");
  const countryVal = countryEl ? countryEl.value : "";
  const portEl = document.getElementById("portFilter");
  const portVal = portEl ? portEl.value : "";
  const customPortInput = document.getElementById("customPort");
  const portFinal = portVal === "custom" && customPortInput ? customPortInput.value : portVal;
  const srcIpEl = document.getElementById("srcIpFilter");
  const srcIpVal = srcIpEl ? srcIpEl.value : "";
  const dstIpEl = document.getElementById("dstIpFilter");
  const dstIpVal = dstIpEl ? dstIpEl.value : "";

  if (serviceCategoryVal) {
    serviceCategoryVal = serviceCategoryVal.toLowerCase();
  }
  if (directionVal) {
    directionVal = directionVal.toUpperCase();
  }

  let since = null;
  let use30 = false;
  if (timeVal) {
    const now = new Date();
    if (timeVal === "1min") now.setTime(now.getTime() - 1 * 60 * 1000);
    if (timeVal === "5min") now.setTime(now.getTime() - 5 * 60 * 1000);
    if (timeVal === "10min") now.setTime(now.getTime() - 10 * 60 * 1000);
    if (timeVal === "30min") now.setTime(now.getTime() - 30 * 60 * 1000);
    if (timeVal === "1h") now.setTime(now.getTime() - 1 * 60 * 60 * 1000);
    if (timeVal === "6h") now.setTime(now.getTime() - 6 * 60 * 60 * 1000);
    if (timeVal === "12h") now.setTime(now.getTime() - 12 * 60 * 60 * 1000);
    if (timeVal === "24h") now.setTime(now.getTime() - 24 * 60 * 60 * 1000);
    if (timeVal === "7d") now.setTime(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (timeVal === "30d") {
      now.setTime(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      use30 = true;
    }
    since = now.toISOString();
  }

  let frequencyThreshold = null;
  if (frequencyVal && frequencyVal.startsWith(">")) {
    const n = parseInt(frequencyVal.slice(1), 10);
    if (!isNaN(n)) frequencyThreshold = n;
  }

  loadEvents(
    since,
    verdictVal,
    protoVal,
    directionVal,
    serviceCategoryVal,
    frequencyThreshold,
    countryVal,
    portFinal,
    srcIpVal,
    dstIpVal,
    use30
  );
  loadStats();
}

function loadEvents(
  since = null,
  verdict = null,
  proto = null,
  direction = null,
  serviceCategory = null,
  frequencyThreshold = null,
  country = null,
  port = null,
  srcIp = null,
  dstIp = null,
  use30 = false
) {
  let url = "/api/events";
  const params = [];
  if (since) params.push(`since=${encodeURIComponent(since)}`);
  if (verdict) params.push(`verdict=${encodeURIComponent(verdict)}`);
  if (proto) params.push(`proto=${encodeURIComponent(proto)}`);
  if (direction) params.push(`direction=${encodeURIComponent(direction)}`);
  if (serviceCategory) params.push(`service_category=${encodeURIComponent(serviceCategory)}`);
  if (frequencyThreshold != null) params.push(`frequency=${frequencyThreshold}`);
  if (country) params.push(`country=${encodeURIComponent(country)}`);
  if (port) params.push(`port=${encodeURIComponent(port)}`);
  if (srcIp) params.push(`src_ip=${encodeURIComponent(srcIp)}`);
  if (dstIp) params.push(`dst_ip=${encodeURIComponent(dstIp)}`);
  if (use30) params.push("use_30=1");
  if (params.length) url += "?" + params.join("&");

  fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`Events API returned ${res.status}`);
      return res.json();
    })
    .then((data) => {
      // defensive: ensure data is an array
      if (!Array.isArray(data)) data = Array.isArray(data.events) ? data.events : [];

      // remove cluster layers from map first to avoid stale visuals
      try {
        if (acceptedClusters && map.hasLayer(acceptedClusters)) map.removeLayer(acceptedClusters);
        if (droppedClusters && map.hasLayer(droppedClusters)) map.removeLayer(droppedClusters);
      } catch (e) {
        console.warn("Error removing cluster layers:", e);
      }

      // clear previous clusters and markers
      try {
        if (acceptedClusters) acceptedClusters.clearLayers();
        if (droppedClusters) droppedClusters.clearLayers();
      } catch (e) {
        console.warn("Error clearing clusters:", e);
      }

      markers.forEach(m => {
        try { map.removeLayer(m); } catch (e) {}
      });
      markers = [];

      // Collect markers into arrays and add in bulk for performance
      const acceptedToAdd = [];
      const droppedToAdd = [];

      for (let i = 0; i < data.length; i++) {
        const event = data[i];
        if (!event || !event.latitude || !event.longitude) continue;

        // normalize verdict once
        const verdictNorm = String(event.verdict || '').toUpperCase();

        // create marker using helper (L.Marker with divIcon)
        let marker;
        try {
          marker = createEventMarker(event);
        } catch (e) {
          console.warn("Failed to create marker for event:", e, event);
          continue;
        }

        // keep markers array for zoom-to-fit and individual mode
        markers.push(marker);

        if (useClusters) {
          if (verdictNorm === 'DROP') {
            droppedToAdd.push(marker);
          } else {
            acceptedToAdd.push(marker);
          }
        } else {
          // individual mode: add marker directly to map
          try { marker.addTo(map); } catch (e) { console.warn("Failed to add marker to map:", e); }
        }
      }

      // Bulk-add to clusters (faster than adding one-by-one)
      if (useClusters) {
        try {
          if (acceptedToAdd.length && acceptedClusters) {
            if (typeof acceptedClusters.addLayers === 'function') acceptedClusters.addLayers(acceptedToAdd);
            else acceptedToAdd.forEach(m => acceptedClusters.addLayer(m));
          }
          if (droppedToAdd.length && droppedClusters) {
            if (typeof droppedClusters.addLayers === 'function') droppedClusters.addLayers(droppedToAdd);
            else droppedToAdd.forEach(m => droppedClusters.addLayer(m));
          }
        } catch (e) {
          console.warn("Bulk add to clusters failed, falling back to per-marker add:", e);
          try {
            acceptedToAdd.forEach(m => acceptedClusters.addLayer(m));
            droppedToAdd.forEach(m => droppedClusters.addLayer(m));
          } catch (err) {
            console.error("Fallback cluster add also failed:", err);
          }
        }
      }

      // ensure cluster groups are on the map when grouped mode is active
      if (useClusters) {
        try {
          if (acceptedClusters && !map.hasLayer(acceptedClusters)) acceptedClusters.addTo(map);
          if (droppedClusters && !map.hasLayer(droppedClusters)) droppedClusters.addTo(map);
        } catch (e) {
          console.warn("Error adding cluster layers to map:", e);
        }
      }

      // clear any temporary loading message and refresh stats
      const statsBar = document.getElementById('statsBar');
      if (statsBar && statsBar.dataset.loading) {
        delete statsBar.dataset.loading;
        loadStats();
      }

      // Fit bounds only when marker count is reasonable to avoid long blocking operations
      try {
        const MAX_FIT_MARKERS = 1500; // tune this threshold
        if (markers.length > 0 && markers.length <= MAX_FIT_MARKERS) {
          const group = L.featureGroup(markers);
          map.fitBounds(group.getBounds(), { padding: [20, 20] });
        } else if (useClusters) {
          const accBounds = acceptedClusters && acceptedClusters.getBounds && acceptedClusters.getBounds();
          const dropBounds = droppedClusters && droppedClusters.getBounds && droppedClusters.getBounds();
          const bounds = accBounds && dropBounds ? accBounds.extend(dropBounds) : (accBounds || dropBounds);
          if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
          }
        }
      } catch (e) {
        console.warn("fitBounds skipped due to error or size:", e);
      }
    })
    .catch((err) => {
      console.error("Failed to load events:", err);
    });
}

/* loadStats unchanged from previous robust implementation (keeps top 25) */
function loadStats() {
  fetch("/api/stats")
    .then((res) => {
      if (!res.ok) throw new Error(`Stats API returned ${res.status}`);
      return res.json();
    })
    .then((stats) => {
      if (!stats || typeof stats !== 'object') stats = {};
      stats.top_countries = Array.isArray(stats.top_countries) ? stats.top_countries : [];
      stats.top_ports = Array.isArray(stats.top_ports) ? stats.top_ports : [];
      stats.drop_count = typeof stats.drop_count === 'number' ? stats.drop_count : (Number(stats.drop_count) || 0);
      stats.accept_count = typeof stats.accept_count === 'number' ? stats.accept_count : (Number(stats.accept_count) || 0);

      const dropEl = document.getElementById("stat-drop-count");
      const acceptEl = document.getElementById("stat-accept-count");
      const topCountriesEl = document.getElementById("stat-top-countries");
      const topPortsEl = document.getElementById("stat-top-ports");
      const statsBody = document.getElementById("statsBar") || document.getElementById("stats-body") || document.getElementById("statsBar");

      const countrySelect = document.getElementById("countryFilter");
      const portSelect = document.getElementById("portFilter");
      const prevCountry = countrySelect ? countrySelect.value : "";
      const prevPort = portSelect ? portSelect.value : "";

      if (countrySelect) {
        const frag = document.createDocumentFragment();
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "All Countries";
        frag.appendChild(defaultOpt);
        stats.top_countries.slice(0, 25).forEach(c => {
          const opt = document.createElement("option");
          opt.value = c && c.country ? c.country : "";
          opt.textContent = c && c.country ? c.country : "N/A";
          frag.appendChild(opt);
        });
        countrySelect.innerHTML = "";
        countrySelect.appendChild(frag);
        countrySelect.value = prevCountry || "";
      }

      if (portSelect) {
        const frag = document.createDocumentFragment();
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "All Ports";
        frag.appendChild(defaultOpt);
        stats.top_ports.slice(0, 25).forEach(p => {
          const opt = document.createElement("option");
          opt.value = p && p.port != null ? String(p.port) : "";
          opt.textContent = p && p.port != null ? String(p.port) : "N/A";
          frag.appendChild(opt);
        });
        const customOpt = document.createElement("option");
        customOpt.value = "custom";
        customOpt.textContent = "Enter Port #...";
        frag.appendChild(customOpt);
        portSelect.innerHTML = "";
        portSelect.appendChild(frag);
        portSelect.value = prevPort || "";
      }

      if (dropEl) dropEl.textContent = stats.drop_count;
      if (acceptEl) acceptEl.textContent = stats.accept_count;

      if (topCountriesEl) {
        const frag = document.createDocumentFragment();
        stats.top_countries.slice(0, 25).forEach(c => {
          const li = document.createElement("li");
          li.innerHTML = `${c && c.country ? c.country : "N/A"} <span style="color: #00ffcc; float:right;">${c && c.count ? c.count : 0}</span>`;
          frag.appendChild(li);
        });
        topCountriesEl.innerHTML = "";
        topCountriesEl.appendChild(frag);
      }

      if (topPortsEl) {
        const frag = document.createDocumentFragment();
        stats.top_ports.slice(0, 25).forEach(p => {
          const svc = lookupService(Number(p && p.port)) || (p && p.service) || "";
          const li = document.createElement("li");
          li.innerHTML = `${p && p.port != null ? p.port : "N/A"}${svc ? " (" + svc + ")" : ""} <span style="color: #00ffcc; float:right;">${p && p.count ? p.count : 0}</span>`;
          frag.appendChild(li);
        });
        topPortsEl.innerHTML = "";
        topPortsEl.appendChild(frag);
      }

      if ((!dropEl || !acceptEl || !topCountriesEl || !topPortsEl) && statsBody) {
        const formatPort = (p) => {
          const svc = lookupService(Number(p && p.port)) || (p && p.service) || "";
          return `${p && p.port != null ? p.port : "N/A"}${svc ? " (" + svc + ")" : ""} (${p && p.count ? p.count : 0})`;
        };
        statsBody.innerHTML = `
          <div><b>DROP:</b> ${stats.drop_count} &nbsp; <b>ACCEPT:</b> ${stats.accept_count}</div>
          <hr style="border-color: rgba(0,255,204,0.08); margin:8px 0;">
          <div style="font-weight:700;">Top Countries (25)</div>
          ${stats.top_countries.slice(0,25).map(c => `&nbsp;&nbsp;${c && c.country ? c.country : "N/A"} (${c && c.count ? c.count : 0})`).join("<br>")}
          <hr style="border-color: rgba(0,255,204,0.08); margin:8px 0;">
          <div style="font-weight:700;">Top Ports (25)</div>
          ${stats.top_ports.slice(0,25).map(formatPort).join("<br>")}
        `;
      }

      const customPortInput = document.getElementById("customPort");
      if (customPortInput && portSelect) {
        customPortInput.style.display = portSelect.value === "custom" ? "inline-block" : "none";
      }
    })
    .catch((err) => {
      console.error("Failed to load stats:", err);
    });
}

function lookupService(port) {
  if (port == null || port === "") return "Unknown";
  const key = String(port);
  if (services && services[key]) return services[key];
  for (const rangeKey in services) {
    if (rangeKey.includes("-")) {
      const [min, max] = rangeKey.split("-").map(Number);
      if (port >= min && port <= max) {
        return services[rangeKey];
      }
    }
  }
  return "Unknown";
}

// expose minimal globals for inline handlers
window.initMap = initMap;
window.resetFilters = resetFilters;
window.addZoomButton = addZoomButton;
window.onFilterChange = debounce(onFilterChange, 200);

window.onload = initMap;
