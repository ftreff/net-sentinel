// dashboard.js (patched)
// Adds bucketed marker sizing and cluster icon sizing based on event counts.

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

/* --- Marker sizing helper (pixels) ---
   Buckets:
     1-9           -> smallest
     10-99         -> small
     100-999       -> medium
     1,000-9,999   -> large
     10,000-99,999 -> x-large
     100,000-999,999 -> xx-large
     1,000,000+    -> largest
*/
function getMarkerRadius(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 4;            // zero or invalid -> tiny
  if (n <= 9) return 6;            // 1-9
  if (n <= 99) return 9;           // 10-99
  if (n <= 999) return 12;         // 100-999
  if (n <= 9999) return 16;        // 1,000-9,999
  if (n <= 99999) return 20;       // 10,000-99,999
  if (n <= 999999) return 26;      // 100,000-999,999
  return 34;                       // 1,000,000+
}

/* Lazy popup marker factory: minimal DOM until clicked
   Now sizes the dot based on an event count field (tries event.count, event.frequency,
   event.events.length as fallbacks). Keeps the lazy popup behavior.
*/
function createEventMarker(event) {
  const isDropped = String(event.verdict || '').toUpperCase() === 'DROP';
  const color = isDropped ? '#ff4d4d' : '#2b9cff';

  // determine numeric count for sizing; adjust field names as needed
  const count = (event.count != null) ? event.count :
                (event.frequency != null) ? event.frequency :
                (event.events != null && Array.isArray(event.events)) ? event.events.length :
                1;

  const radius = getMarkerRadius(count);
  // iconSize expects width/height (diameter)
  const diameter = Math.max(6, Math.round(radius * 2));
  const half = Math.round(diameter / 2);

  // inline style ensures the dot size is applied even if CSS is overridden
  const dotHtml = `<span class="event-dot" style="
      background:${color};
      width:${diameter}px;
      height:${diameter}px;
      display:inline-block;
      border-radius:50%;
      box-shadow:0 1px 2px rgba(0,0,0,0.25);
      border:1px solid rgba(0,0,0,0.08);
    "></span>`;

  const dotIcon = L.divIcon({
    className: 'event-dot-icon',
    html: dotHtml,
    iconSize: [diameter, diameter],
    iconAnchor: [half, half],
    popupAnchor: [0, -half - 6]
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
      <b>Timestamp:</b> ${ev.timestamp || 'N/A'}<br>
      <b>Count:</b> ${count}
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
      // number of child markers in this cluster
      const c = cluster.getChildCount();

      // base radius from your helper
      const baseRadius = getMarkerRadius(c);

      // diameter derived from baseRadius; allow very small diameters for small buckets
      // clamp range: [10, 96] px (adjust 10 upward if you want a slightly larger minimum)
      const clusterDiameter = Math.min(96, Math.max(10, Math.round(baseRadius * 2)));

      // compute font size so the number fits; reduce padding effect by using smaller multiplier
      const fontSize = Math.max(8, Math.round(clusterDiameter * 0.45));

      // return divIcon with inline font-size so label scales with diameter
      return L.divIcon({
        html: `<div class="cluster-dot" style="font-size:${fontSize}px;"><span>${c}</span></div>`,
        className: 'marker-cluster-accepted',
        iconSize: L.point(clusterDiameter, clusterDiameter)
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
      // number of child markers in this cluster
      const c = cluster.getChildCount();

      // base radius from your helper
      const baseRadius = getMarkerRadius(c);

      // diameter derived from baseRadius; allow very small diameters for small buckets
      // clamp range: [10, 96] px (adjust 10 upward if you want a slightly larger minimum)
      const clusterDiameter = Math.min(96, Math.max(10, Math.round(baseRadius * 2)));

      // compute font size so the number fits; reduce padding effect by using smaller multiplier
      const fontSize = Math.max(8, Math.round(clusterDiameter * 0.45));

      // return divIcon with inline font-size so label scales with diameter
      return L.divIcon({
        html: `<div class="cluster-dot" style="font-size:${fontSize}px;"><span>${c}</span></div>`,
        className: 'marker-cluster-dropped',
        iconSize: L.point(clusterDiameter, clusterDiameter)
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
    refreshStatsAndMap();
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

// --- add: zoom button and other controls ---

function addZoomButton() {
  const control = L.control({ position: "bottomright" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const btn = L.DomUtil.create("a", "", div);
    btn.innerHTML = "🔍";
    btn.href = "#";
    btn.title = "Zoom to fit visible markers";

    L.DomEvent.on(btn, "click", function (e) {
      L.DomEvent.preventDefault(e);

      try {
        // prefer using currently visible markers (markers array)
        if (markers && markers.length > 0) {
          const group = L.featureGroup(markers);
          const bounds = group.getBounds();
          if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20] });
            return;
          }
        }

        // fallback: try cluster bounds if clusters are present
        const accBounds = acceptedClusters && typeof acceptedClusters.getBounds === 'function' ? acceptedClusters.getBounds() : null;
        const dropBounds = droppedClusters && typeof droppedClusters.getBounds === 'function' ? droppedClusters.getBounds() : null;
        const bounds = accBounds && dropBounds ? accBounds.extend(dropBounds) : (accBounds || dropBounds);
        if (bounds && bounds.isValid && bounds.isValid()) {
          map.fitBounds(bounds, { padding: [20, 20] });
        }
      } catch (err) {
        console.warn("Zoom-to-fit failed:", err);
      }
    });

    return div;
  };
  control.addTo(map);
}

// expose globally for any inline calls
window.addZoomButton = addZoomButton;

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

// Filtering and loading events (continued)

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
        stats.top_countries.slice(0, 50).forEach(c => {
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
        stats.top_ports.slice(0, 50).forEach(p => {
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
        stats.top_countries.slice(0, 50).forEach(c => {
          const li = document.createElement("li");
          li.innerHTML = `${c && c.country ? c.country : "N/A"} <span style="color: #00ffcc; float:right;">${c && c.count ? c.count : 0}</span>`;
          frag.appendChild(li);
        });
        topCountriesEl.innerHTML = "";
        topCountriesEl.appendChild(frag);
      }

      if (topPortsEl) {
        const frag = document.createDocumentFragment();
        stats.top_ports.slice(0, 50).forEach(p => {
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
          <div style="font-weight:700;">Top Countries (50)</div>
          ${stats.top_countries.slice(0,50).map(c => `&nbsp;&nbsp;${c && c.country ? c.country : "N/A"} (${c && c.count ? c.count : 0})`).join("<br>")}
          <hr style="border-color: rgba(0,255,204,0.08); margin:8px 0;">
          <div style="font-weight:700;">Top Ports (50)</div>
          ${stats.top_ports.slice(0,50).map(formatPort).join("<br>")}
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

// --- add: refresh button + combined refresh handler ---

/**
 * Refresh both stats and the map using current filters.
 * Uses the existing onFilterChange (debounced wrapper if present).
 */
function refreshStatsAndMap() {
  const btn = document.getElementById('stat-refresh');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }

  // Kick off stats and events refresh
  try { loadStats(); } catch (e) { console.warn('loadStats failed:', e); }
  try {
    // Prefer the debounced wrapper if present so we don't spam the server
    if (typeof window.onFilterChange === 'function') {
      window.onFilterChange();
    } else {
      onFilterChange();
    }
  } catch (e) {
    console.warn('onFilterChange failed:', e);
  }

  // Wait until chunked loading (if any) finishes, or timeout
  const statsBar = document.getElementById('statsBar');
  const MAX_WAIT_MS = 10000; // maximum wait before re-enabling button
  const POLL_INTERVAL = 200;
  const start = Date.now();

  function checkDone() {
    // If statsBar indicates loading (set by chunkProgress), keep waiting
    const stillLoading = statsBar && statsBar.dataset && statsBar.dataset.loading === 'true';

    // Also consider cluster groups: if chunkedLoading is used, chunkProgress sets statsBar.dataset.loading.
    // If no statsBar or no dataset flag, we still wait a short grace period to let fetches start.
    const elapsed = Date.now() - start;
    if (!stillLoading || elapsed >= MAX_WAIT_MS) {
      // done or timed out — re-enable button
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh';
      }
      return;
    }
    setTimeout(checkDone, POLL_INTERVAL);
  }

  setTimeout(checkDone, POLL_INTERVAL);
}

// Utility: lookup service name by port (uses services loaded from /data/services.json)
function lookupService(port) {
  try {
    if (!port) return null;
    const p = String(port);
    return services[p] || null;
  } catch (e) {
    return null;
  }
}

// Expose a few helpers globally for debugging or inline calls
window.ns = window.ns || {};
window.ns.getMarkerRadius = getMarkerRadius;
window.ns.createEventMarker = createEventMarker;
window.ns.refreshStatsAndMap = refreshStatsAndMap;

// Initialize map when DOM is ready
document.addEventListener("DOMContentLoaded", function () {
  try {
    initMap();
  } catch (e) {
    console.error("Failed to initialize map:", e);
  }
});
