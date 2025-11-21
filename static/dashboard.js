let map;
let markers = [];

let traceOverlays = [];
let traceBoxControl;

function initMap() {
  map = L.map("map", {
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 60
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
  loadEvents();
  loadStats();
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
          <button onclick="tracePath('${event.ip}')">🛤️ Trace Path</button>
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

function refreshReverseDNS(ip) {
  fetch(`/api/reverse_dns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ip })
  })
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

function tracePath(ip) {
  // Clear previous overlays and box
  traceOverlays.forEach(layer => map.removeLayer(layer));
  traceOverlays = [];
  if (traceBoxControl) {
    map.removeControl(traceBoxControl);
    traceBoxControl = null;
  }

  fetch(`/api/trace/${ip}`)
    .then(res => res.json())
    .then(hops => {
      const latlngs = [];

      // Create trace box
      traceBoxControl = L.control({ position: "bottomright" });
      traceBoxControl.onAdd = function () {
        const div = L.DomUtil.create("div", "stats-bar");
        div.id = "traceBox";
        div.innerHTML = `<b>Trace Path to ${ip}</b><br>`;
        div.innerHTML += `<button onclick="clearTrace()">Clear Trace</button><br>`;
        hops.forEach(h => {
          div.innerHTML += `Hop ${h.hop}: ${h.ip} ${h.reverse_dns || ""} (${h.city || "?"}, ${h.region || "?"}, ${h.country || "?"})<br>`;
        });
        return div;
      };
      traceBoxControl.addTo(map);

      // Plot hops
      hops.forEach(h => {
        if (h.lat && h.lon) {
          latlngs.push([h.lat, h.lon]);
          const marker = L.circleMarker([h.lat, h.lon], {
            radius: 5,
            fillColor: "cyan",
            color: "cyan",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8,
          }).addTo(map);

          marker.bindPopup(`
            <b>Hop ${h.hop}</b><br>
            IP: ${h.ip}<br>
            Reverse DNS: ${h.reverse_dns || "N/A"}<br>
            Lat/Lon: ${h.lat}, ${h.lon}<br>
            City: ${h.city || "N/A"}<br>
            Region: ${h.region || "N/A"}<br>
            Country: ${h.country || "N/A"}
          `);

          traceOverlays.push(marker);
        }
      });

      if (latlngs.length > 1) {
        const line = L.polyline(latlngs, { color: "cyan", weight: 2 }).addTo(map);
        traceOverlays.push(line);
        map.fitBounds(latlngs, { padding: [20, 20] });
      }
    })
    .catch(err => {
      console.error("Trace path failed:", err);
      alert("Failed to fetch trace path.");
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

function clearTrace() {
  traceOverlays.forEach(layer => map.removeLayer(layer));
  traceOverlays = [];
  if (traceBoxControl) {
    map.removeControl(traceBoxControl);
    traceBoxControl = null;
  }
}

window.onload = initMap;
