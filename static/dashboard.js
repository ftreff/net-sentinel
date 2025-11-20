let map;
let markers = [];

function initMap() {
  map = L.map("map").setView([20, 0], 2);

  const dark = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap contributors",
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
      <select id="timeRange" onchange="onTimeRangeChange()">
        <option value="">All Time</option>
        <option value="10min">Last 10 min</option>
        <option value="1h">Last 1 hour</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
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

function onTimeRangeChange() {
  const val = document.getElementById("timeRange").value;
  let since = null;

  if (val) {
    const now = new Date();
    if (val === "10min") now.setMinutes(now.getMinutes() - 10);
    if (val === "1h") now.setHours(now.getHours() - 1);
    if (val === "24h") now.setHours(now.getHours() - 24);
    if (val === "7d") now.setDate(now.getDate() - 7);
    if (val === "30d") now.setDate(now.getDate() - 30);
    if (val === "90d") now.setDate(now.getDate() - 90);
    since = now.toISOString();
  }

  loadEvents(since);
  loadStats(); // refresh stats too
}

function loadEvents(since = null) {
  let url = "/api/events";
  if (since) url += `?since=${encodeURIComponent(since)}`;

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
      onTimeRangeChange(); // reload with current filter
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
      div.innerHTML = `
        <b>DROP:</b> ${stats.drop_count} &nbsp; <b>ACCEPT:</b> ${stats.accept_count}<br>
        <b>Top Countries:</b><br>
        ${stats.top_countries.map(c => `&nbsp;&nbsp;${c.country || "N/A"} (${c.count})`).join("<br>")}<br>
        <b>Top Ports:</b><br>
        ${stats.top_ports.map(p => `&nbsp;&nbsp;${p.port} (${p.count})`).join("<br>")}
      `;
    })
    .catch((err) => {
      console.error("Failed to load stats:", err);
    });
}

window.onload = initMap;
