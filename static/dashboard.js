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
  L.control.layers(baseMaps).addTo(map);

  addTimeFilterControl();
  addStatsBar();
  addZoomButton();

  // Load services.json first, then events/stats
  fetch("/services.json")
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
    const div = L.DomUtil.create("div", "time-filter");
    div.innerHTML = `
      <select id="timeRange" onchange="onFilterChange()">
        <option value="">All Time</option>
        <option value="10min">Last 10 min</option>
        <option value="1h">Last 1 hour</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
      <select id="verdictFilter" onchange="onFilterChange()">
        <option value="">All Verdicts</option>
        <option value="ACCEPT">Only ACCEPT</option>
        <option value="DROP">Only DROP</option>
      </select>
    `;
    return div;
  };
  control.addTo(map);
}

function addStatsBar() {
  const stats = L.control({ position: "bottomleft" });
  stats.onAdd = function () {
    const div = L.DomUtil.create("div", "stats-bar");
    div.id = "statsBar";
    div.style.background = "rgba(0,0,0,0.7)";
    div.style.color = "#fff";
    div.style.padding = "8px";
    div.style.fontSize = "12px";
    div.style.maxWidth = "300px";
    div.innerHTML = "Loading stats...";
    return div;
  };
  stats.addTo(map);
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

  loadEvents(since, verdictVal);
  loadStats();
}

function loadEvents(since = null, verdict = null) {
  let url = "/api/events";
  const params = [];
  if (since) params.push(`since=${encodeURIComponent(since)}`);
  if (verdict && verdict !== "") params.push(`verdict=${encodeURIComponent(verdict)}`);
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
          <button onclick="refreshDNS('${event.src_ip}', '${event.dst_ip}')">🔄 Refresh DNS</button>
        `;

        marker.bindPopup(popup);
        marker.addTo(map);
        markers.push(marker);
      });
    })
    .catch((err) => {
      console.error("Failed to load events:", err);
    });
}

function refreshDNS(srcIp, dstIp) {
  Promise.all([
    fetch(`/api/rdns?ip=${encodeURIComponent(srcIp)}`).then(r => r.json()),
    fetch(`/api/rdns?ip=${encodeURIComponent(dstIp)}`).then(r => r.json())
  ]).then(([src, dst]) => {
    alert(`Source: ${src.hostname || "N/A"}\nDestination: ${dst.hostname || "N/A"}`);
    onFilterChange(); // reload with current filters
  }).catch(err => {
    console.error("DNS refresh failed", err);
    alert("Failed to refresh DNS.");
  });
}

function loadStats() {
  fetch("/api/stats")
    .then((res) => res.json())
    .then((stats) => {
      const div = document.getElementById("statsBar");

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
    })
    .catch((err) => {
      console.error("Failed to load stats:", err);
    });
}

window.onload = initMap;
