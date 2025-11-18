document.addEventListener("DOMContentLoaded", () => {
  const isMapPage = document.getElementById("map") !== null;
  const isTablePage = document.getElementById("ipTable") !== null;

  // 🌗 Dark Mode Toggle
  const darkToggle = document.getElementById("toggleDark") || document.getElementById("toggleDarkTable");
  if (darkToggle) {
    darkToggle.addEventListener("change", () => {
      document.body.classList.toggle("dark", darkToggle.checked);
    });
  }

  // 🗺️ Map Page Logic
  if (isMapPage) {
    const map = L.map("map").setView([20, 0], 2);
    const lightTiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png");
    const darkTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png");

    lightTiles.addTo(map);

    const traceToggle = document.getElementById("toggleTrace");
    const heatToggle = document.getElementById("toggleHeat");
    const dotsToggle = document.getElementById("toggleDots");

    let traceLines = [];
    let heatPoints = [];
    let dotMarkers = [];

    fetch("/api/map")
      .then(res => res.json())
      .then(data => {
        data.forEach(entry => {
          const lat = entry.latitude;
          const lon = entry.longitude;

          if (dotsToggle.checked) {
            const marker = L.circleMarker([lat, lon], {
              radius: 4,
              color: "#00ffcc",
              fillOpacity: 0.7
            }).addTo(map);
            dotMarkers.push(marker);
          }

          if (traceToggle.checked && entry.trace_path) {
            const hops = entry.trace_path.split(",").map(h => h.trim()).filter(h => h);
            const latlngs = hops.map(ip => [lat, lon]); // placeholder — could be enriched later
            const polyline = L.polyline(latlngs, { color: "#ff6600", weight: 1 }).addTo(map);
            traceLines.push(polyline);
          }

          if (heatToggle.checked) {
            heatPoints.push([lat, lon, 1]);
          }
        });

        // Optional: add heatmap layer if needed
        // Requires leaflet-heat plugin
      });

    // 🏆 Rankings
    fetch("/api/rankings")
      .then(res => res.json())
      .then(data => {
        const list = document.getElementById("rankingList");
        data.forEach(entry => {
          const li = document.createElement("li");
          li.textContent = `${entry.country_code}: ${entry.count}`;
          list.appendChild(li);
        });
      });
  }

  // 📊 Table Page Logic
  if (isTablePage) {
    fetch("/api/table")
      .then(res => res.json())
      .then(data => {
        const tbody = document.querySelector("#ipTable tbody");
        data.forEach(row => {
          const tr = document.createElement("tr");
          [
            "ip", "reverse_dns", "direction", "port", "service",
            "timestamp", "city", "state", "country", "country_code"
          ].forEach(key => {
            const td = document.createElement("td");
            td.textContent = row[key] || "";
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
      });
  }
});
