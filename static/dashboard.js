let map;
let markers = [];
let services = {}; // will hold services.json mapping
let currentClusterRadius = 40; // ✅ global radius state
let useClusters = true;          // ✅ new flag: start in clustered mode

function initMap() {
  map = L.map("map", {
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 60,
    zoomControl: false // disable default zoom control
  }).setView([20, 0], 2);

  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors & CartoDB",
  });

  const light = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  });

  const baseMaps = { Dark: dark, Light: light };
  dark.addTo(map);

  // ✅ Move basemap toggle to bottom-right
  L.control.layers(baseMaps, null, { position: "bottomright" }).addTo(map);

  // ✅ Add zoom control bottom-right
  L.control.zoom({ position: "bottomright" }).addTo(map);

  // ✅ These must be called in order:
  addTimeFilterControl();
  addStatsBar();       // stats window bottom-left
  addZoomButton();     // magnifying glass bottom-right
  initCustomPortToggle();

  // ✅ Add cluster radius slider + toggle
  addClusterRadiusControl();

  fetch("/data/services.json")
    .then(res => res.json())
    .then(data => {
      services = data;
      const timeSelect = document.getElementById("timeRange");
      if (timeSelect) timeSelect.value = "24h"; // enforce default
      onFilterChange(); // initial load using current filters
  })
    .catch(err => {
      console.error("Failed to load services.json:", err);
      const timeSelect = document.getElementById("timeRange");
      if (timeSelect) timeSelect.value = "24h"; // enforce default even if services fail
      onFilterChange(); // still load with Unknown services
    });
}

function addStatsBar() {
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

      <!-- Time filter -->
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
        <option value="15d">Last 15 days</option>
        <option value="30d">Last 30 days</option>
      </select>

      <!-- Verdict filter -->
      <select id="verdictFilter" onchange="onFilterChange()">
        <option value="">All Verdicts</option>
        <option value="ACCEPT">Only ACCEPT</option>
        <option value="DROP">Only DROP</option>
      </select>

      <!-- Protocol filter -->
      <select id="protoFilter" onchange="onFilterChange()">
        <option value="">All Protocols</option>
        <option value="TCP">TCP</option>
        <option value="UDP">UDP</option>
        <option value="ICMP">ICMP</option>
      </select>

      <!-- Direction filter -->
      <select id="directionFilter" onchange="onFilterChange()">
        <option value="">All Directions</option>
        <option value="INBOUND">Inbound</option>
        <option value="OUTBOUND">Outbound</option>
      </select>

      <!-- Service category filter -->
      <select id="serviceCategoryFilter" onchange="onFilterChange()">
        <option value="">All Services</option>
        <option value="Web">Web (80,443,8080)</option>
        <option value="Mail">Mail (25,465,587)</option>
        <option value="Database">Database (3306,5432)</option>
        <option value="Remote">Remote (22,3389)</option>
        <option value="BitTorrent">BitTorrent (6881–6999, 51413, 16881, 63783, 6969, 7021)</option>
        <option value="Unknown">Unknown</option>
      </select>

      <!-- Frequency filter -->
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

      <!-- Country filter -->
      <select id="countryFilter" onchange="onFilterChange()">
        <option value="">All Countries</option>
      </select>

      <!-- Port filter -->
      <select id="portFilter" onchange="onFilterChange()">
        <option value="">All Ports</option>
        <option value="custom">Enter Port #...</option>
      </select>
      <input id="customPort" type="text" placeholder="Port #"
             style="display:none;" onblur="onFilterChange()" />

      <!-- Source/Destination IP filters -->
      <input id="srcIpFilter" type="text" placeholder="Source IP" onblur="onFilterChange()" />
      <input id="dstIpFilter" type="text" placeholder="Destination IP" onblur="onFilterChange()" />
    `;
    return div;
  };
  control.addTo(map);
}

// ✅ New cluster radius slider + toggle control
function addClusterRadiusControl() {
  const control = L.control({ position: "topright" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-custom");
    div.style.background = "black";   // ✅ black background
    div.style.color = "white";        // ✅ white text for contrast
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
      if (window.markerCluster && useClusters) {
        window.markerCluster.options.maxClusterRadius = newRadius;
        window.markerCluster.refreshClusters();
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

      // Remove existing layers
      if (window.markerCluster) {
        map.removeLayer(window.markerCluster);
      }
      markers.forEach(m => map.removeLayer(m));

      // Reload events with new mode
      onFilterChange();

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
      el.value = "";
    } else {
      el.value = "";
    }
  });

  const customPortInput = document.getElementById("customPort");
  if (customPortInput) customPortInput.style.display = "none";

  onFilterChange();
}

function initCustomPortToggle() {
  const portSelect = document.getElementById("portFilter");
  const customPortInput = document.getElementById("customPort");
  if (!portSelect || !customPortInput) return;

  portSelect.addEventListener("change", () => {
    const useCustom = portSelect.value === "custom";
    customPortInput.style.display = useCustom ? "inline-block" : "none";
    if (!useCustom) customPortInput.value = "";
    onFilterChange();
  });
}

function addZoomButton() {
  // ✅ Moved to bottom-right
  const control = L.control({ position: "bottomright" });
  control.onAdd = function () {
    const div = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const btn = L.DomUtil.create("a", "", div);
    btn.innerHTML = "🔍";
    btn.href = "#";
    btn.title = "Zoom to fit all markers";

    L.DomEvent.on(btn, "click", function (e) {
      L.DomEvent.preventDefault(e);
      if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      }
    });

    return div;
  };
  control.addTo(map);
}

function onFilterChange() {
  const timeVal = document.getElementById("timeRange").value;
  const verdictVal = document.getElementById("verdictFilter").value;
  const protoVal = document.getElementById("protoFilter").value;
  let directionVal = document.getElementById("directionFilter").value;
  let serviceCategoryVal = document.getElementById("serviceCategoryFilter").value;
  const frequencyVal = document.getElementById("frequencyFilter").value;
  const countryVal = document.getElementById("countryFilter").value;
  const portVal = document.getElementById("portFilter").value;
  const customPortInput = document.getElementById("customPort");
  const portFinal = portVal === "custom" ? customPortInput.value : portVal;
  const srcIpVal = document.getElementById("srcIpFilter").value;
  const dstIpVal = document.getElementById("dstIpFilter").value;

  // Normalize values
  if (serviceCategoryVal) {
    serviceCategoryVal = serviceCategoryVal.toLowerCase(); // e.g. "BitTorrent" → "bittorrent"
  }
  if (directionVal) {
    directionVal = directionVal.toUpperCase(); // e.g. "Inbound" → "INBOUND"
  }

  let since = null;
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
    if (timeVal === "15d") now.setTime(now.getTime() - 15 * 24 * 60 * 60 * 1000);
    if (timeVal === "30d") now.setTime(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    since = now.toISOString();
  }

  // Normalize frequency (">10" -> 10)
  let frequencyThreshold = null;
  if (frequencyVal && frequencyVal.startsWith(">")) {
    const n = parseInt(frequencyVal.slice(1), 10);
    if (!isNaN(n)) frequencyThreshold = n;
  }

  // Call loaders with normalized values
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
    dstIpVal
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
  dstIp = null
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
  if (params.length) url += "?" + params.join("&");

  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      // Clear previous layers
      if (window.markerCluster) {
        map.removeLayer(window.markerCluster);
      }
      markers.forEach(m => map.removeLayer(m));
      markers = [];

      // Create cluster group only if useClusters is true
      if (useClusters) {
        window.markerCluster = L.markerClusterGroup({
          maxClusterRadius: currentClusterRadius
        });
      }

      data.forEach((event) => {
        if (!event.latitude || !event.longitude) return;

        const marker = L.circleMarker([event.latitude, event.longitude], {
          radius: 6,
          fillColor: event.verdict === "DROP" ? "red" : "lime",
          color: "#000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8,
        });

        const srcSvc = lookupService(Number(event.src_port)) || event.src_service || "Unknown";
        const dstSvc = lookupService(Number(event.dst_port)) || event.dst_service || "Unknown";

        const popup = `
          <b>Source IP:</b> ${event.src_ip}<br>
          <b>Source Reverse DNS:</b> ${event.src_rdns || "N/A"}<br>
          <b>Destination IP:</b> ${event.dst_ip}<br>
          <b>Destination Reverse DNS:</b> ${event.dst_rdns || "N/A"}<br>
          <b>Source Port:</b> ${event.src_port || "N/A"} (${srcSvc})<br>
          <b>Destination Port:</b> ${event.dst_port || "N/A"} (${dstSvc})<br>
          <b>Direction:</b> ${event.direction}<br>
          <b>Protocol:</b> ${event.proto || "N/A"}<br>
          <b>Interfaces:</b> IN=${event.in_if || "?"} OUT=${event.out_if || "?"}<br>
          <b>Verdict:</b> ${event.verdict}<br>
          <b>Country:</b> ${event.country || "N/A"}<br>
          <b>Region:</b> ${event.state || "N/A"}<br>
          <b>City:</b> ${event.city || "N/A"}<br>
          <b>Hits:</b> ${event.hit_count || 1}<br>
          <b>Timestamp:</b> ${event.timestamp}<br>
        `;

        marker.bindPopup(popup);
        markers.push(marker);

        if (useClusters) {
          window.markerCluster.addLayer(marker);
        } else {
          map.addLayer(marker);
        }
      });

      // Add cluster group if in clustered mode
      if (useClusters && window.markerCluster) {
        map.addLayer(window.markerCluster);
      }

      // Fit bounds to markers
      if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds(), { padding: [20, 20] });
      }
    })
    .catch((err) => {
      console.error("Failed to load events:", err);
    });
}

function loadStats() {
  fetch("/api/stats")
    .then((res) => res.json())
    .then((stats) => {
      const div = document.getElementById("statsBar");

      const countrySelect = document.getElementById("countryFilter");
      const portSelect = document.getElementById("portFilter");
      const prevCountry = countrySelect ? countrySelect.value : "";
      const prevPort = portSelect ? portSelect.value : "";

      if (countrySelect) {
        countrySelect.innerHTML = '<option value="">All Countries</option>';
        stats.top_countries.slice(0, 20).forEach(c => {
          const opt = document.createElement("option");
          opt.value = c.country;
          opt.textContent = c.country;
          countrySelect.appendChild(opt);
        });
        countrySelect.value = prevCountry || "";
      }

      if (portSelect) {
        portSelect.innerHTML = '<option value="">All Ports</option>';
        stats.top_ports.slice(0, 20).forEach(p => {
          const opt = document.createElement("option");
          opt.value = String(p.port);
          opt.textContent = String(p.port);
          portSelect.appendChild(opt);
        });
        const customOpt = document.createElement("option");
        customOpt.value = "custom";
        customOpt.textContent = "Enter Port #...";
        portSelect.appendChild(customOpt);
        portSelect.value = prevPort || "";
      }
      const formatPort = (p) => {
        const svc = lookupService(Number(p.port)) || p.service || "";
        return `&nbsp;&nbsp;${p.port}${svc ? " (" + svc + ")" : ""} (${p.count})`;
      };

      div.innerHTML = `
        <b>DROP:</b> ${stats.drop_count} &nbsp; <b>ACCEPT:</b> ${stats.accept_count}<br>
        <b>Top Countries:</b><br>
        ${stats.top_countries.map(c => `&nbsp;&nbsp;${c.country || "N/A"} (${c.count})`).join("<br>")}<br>
        <b>Top Ports:</b><br>
        ${stats.top_ports.map(formatPort).join("<br>")}
      `;

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
  if (!port) return "Unknown";
  const key = String(port);

  // Exact match
  if (services[key]) return services[key];

  // Range match: look for keys like "8000-8090"
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

window.onload = initMap;

      
