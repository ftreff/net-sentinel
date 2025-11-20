let map;
let markers = [];

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

  const baseMaps = {
    Dark: dark,
    Light: light,
  };

  dark.addTo(map);
  L.control.layers(baseMaps).addTo(map);

  addTimeFilterControl();
  addStatsBar();
  loadEvents(); // default: all time
  loadStats();  // initial stats
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

function onFilterChange() {
  const timeVal = document.getElementById("timeRange").value;
  const verdictVal = document.getElementById("verdictFilter").value;

  let since = null;
  if (timeVal) {
    const now = new Date();
    if (timeVal === "10min") now.setMinutes(now.getMinutes() - 10);
    if (timeVal === "1h") now.setHours(now.getHours() - 1);
    if (timeVal === "24h") now.setHours(now.getHours() - 24);
    if (timeVal === "7d") now.setDate(now.getDate() - 7);
    if (timeVal === "30d") now.setDate(now.getDate() - 30);
    if (timeVal === "90d") now.setDate(now.getDate() - 90);
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

        const popup = `
          <b>IP:</b> ${event.ip}<br>
          <b>Reverse DNS:</b> ${event.reverse_dns || "N/A"}<br>
          <b>Country:</b> ${event.country || "N/A"}<br>
          <b>City:</b> ${event.city || "N/A"}<br>
          <b>Port:</b> ${event.port}<br>
          <b>Service:</b> ${event.service}<br>
          <b>Verdict:</b> ${event.verdict}<br>
          <b>Timestamp:</b> ${event.timestamp}<br>
          <button onclick="refreshReverseDNS('${event.ip}')">🔄 Refresh DNS</button>
        `;

        marker.bindPopup(popup);
        marker.addTo(map);
        markers.push(marker);
      });
    });
}

function refreshReverseDNS(ip) {
  fetch(`/api/reverse_dns?ip=${ip}`, { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      alert(`Updated reverse DNS for ${ip}: ${data.reverse_dns || "N/A"}`);
      onFilterChange(); // reload with current filters
    })
    .catch((err) => {
      console.error("Reverse DNS update failed:", err);
      alert("Failed to update reverse DNS.");
    });
}

function loadStats() {
  fetch("/api/stats")
    .then((res) => res.json())
    .then((stats) => {
      const div = document.getElementById("statsBar");

      const portService = {
        21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http",
        110: "pop3", 123: "ntp", 143: "imap", 161: "snmp", 443: "https", 445: "smb",
        465: "smtps", 587: "submission", 993: "imaps", 995: "pop3s", 3306: "mysql",
        3389: "rdp", 5432: "postgres", 8080: "http-alt"
      };

      const formatPort = (p) => {
        const svc = portService[p.port] || "";
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
