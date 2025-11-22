let map;
let markers = [];
let services = {}; // will hold services.json mapping

function initMap() {
  map = L.map("map", {
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 60 // slower wheel zoom
  }).setView([20, 0], 2);

  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors & CartoDB",
  });

  const light = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  });

  const baseMaps = { Dark: dark, Light: light };

  dark.addTo(map);

  // Basemap toggle moved to top-left
  L.control.layers(baseMaps, null, { position: "topleft" }).addTo(map);

  // ✅ Do NOT add duplicate zoom controls — Leaflet adds them by default in top-left

  addTimeFilterControl();
  addStatsBar();
  addZoomButton(); // ✅ magnifying glass auto-zoom button

  // Ensure custom port toggle is wired after controls exist
  initCustomPortToggle();

  // Load services.json first, then events/stats
  // NOTE: use data path per project structure
  fetch("/data/services.json")
    .then(res => res.json())
    .then(data => {
      services = data;
      loadEvents();      // default: all time
      loadStats();       // initial stats
    })
    .catch(err => {
      console.error("Failed to load services.json:", err);
      loadEvents();
      loadStats();
    });
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
        <option value="10min">Last 10 min</option>
        <option value="1h">Last 1 hour</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
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
      <input id="customPort" type="text" placeholder="Port #" style="display:none;" onblur="onFilterChange()" />

      <!-- Source/Destination IP filters -->
      <input id="srcIpFilter" type="text" placeholder="Source IP" onblur="onFilterChange()" />
      <input id="dstIpFilter" type="text" placeholder="Destination IP" onblur="onFilterChange()" />
    `;
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
  const control = L.control({ position: "topleft" });
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
  const directionVal = document.getElementById("directionFilter").value;
  const serviceCategoryVal = document.getElementById("serviceCategoryFilter").value;
  const frequencyVal = document.getElementById("frequencyFilter").value;
  const countryVal = document.getElementById("countryFilter").value;
  const portVal = document.getElementById("portFilter").value;
  const customPortInput = document.getElementById("customPort");
  const portFinal = portVal === "custom" ? customPortInput.value : portVal;
  const srcIpVal = document.getElementById("srcIpFilter").value;
  const dstIpVal = document.getElementById("dstIpFilter").value;

  let since = null;
  if (timeVal) {
    const now = new Date();
    if (timeVal === "10min") now.setTime(now.getTime() - 10 * 60 * 1000);
    if (timeVal === "1h") now.setTime(now.getTime() - 60 * 60 * 1000);
    if (timeVal === "24h") now.setTime(now.getTime() - 24 * 60 * 60 * 1000);
    if (timeVal === "7d") now.setTime(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (timeVal === "30d") now.setTime(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (timeVal === "90d") now.setTime(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    since = now.toISOString();
  }

  // Normalize frequency (">10" -> 10)
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
      markers.forEach((m) => map.removeLayer(m));
      markers = [];

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

        const srcSvc = services[event.src_port] || event.src_service || "Unknown";
        const dstSvc = services[event.dst_port] || event.dst_service || "Unknown";

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
          <b>Timestamp:</b> ${event.timestamp}<br>
        `;

        marker.bindPopup(popup);
        marker.addTo(map);
        markers.push(marker);
      });

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
        const svc = services[p.port] || p.service || "";
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

window.onload = initMap;
