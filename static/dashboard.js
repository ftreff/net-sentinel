let map;
let markers = [];
let polylines = [];
let currentVerdict = "ALL";
let currentService = "ALL";
let showTraces = true;
let darkMode = true;
let currentTileLayer = null;

function initMap() {
  map = L.map("map").setView([20, 0], 2);
  setTileLayer();

  fetch("/api/events")
    .then((res) => res.json())
    .then((data) => {
      data.forEach((event) => {
        const latlng = [event.latitude, event.longitude];

        const marker = L.circleMarker(latlng, {
          radius: 6,
          fillColor: event.verdict === "DROP" ? "#ff3366" : "#00ffcc",
          color: "#000",
          weight: 1,
          opacity: 1,
          fillOpacity: 0.9,
        });

        marker.verdict = event.verdict;
        marker.service = event.service;

        const popup = `
          <div class="info-window">
            <strong>IP:</strong> ${event.ip}<br>
            <strong>Verdict:</strong> ${event.verdict}<br>
            <strong>Service:</strong> ${event.service}<br>
            <strong>Location:</strong> ${event.city}, ${event.country}<br>
            <strong>Time:</strong> ${event.timestamp}
          </div>
        `;
        marker.bindPopup(popup);
        marker.addTo(map);
        markers.push(marker);

        if (event.trace_path && event.trace_path.length > 1) {
          const path = event.trace_path.map((hop) => [hop.latitude, hop.longitude]);
          const polyline = L.polyline(path, {
            color: "#00ffcc",
            weight: 2,
            opacity: 0.6,
          });
          if (showTraces) polyline.addTo(map);
          polylines.push(polyline);
        }
      });
    });
}

function setTileLayer() {
  const url = darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  const tileLayer = L.tileLayer(url, {
    attribution: '&copy; OpenStreetMap & CartoDB',
    subdomains: "abcd",
    maxZoom: 19,
  });

  if (currentTileLayer && map && map.hasLayer(currentTileLayer)) {
    map.removeLayer(currentTileLayer);
  }

  tileLayer.addTo(map);
  currentTileLayer = tileLayer;
}

function filterMarkers(verdict) {
  currentVerdict = verdict;
  updateVisibility();
}

function filterByService(service) {
  currentService = service;
  updateVisibility();
}

function updateVisibility() {
  markers.forEach((marker) => {
    const verdictMatch = currentVerdict === "ALL" || marker.verdict === currentVerdict;
    const serviceMatch = currentService === "ALL" || marker.service === currentService;
    if (verdictMatch && serviceMatch) {
      marker.addTo(map);
    } else {
      map.removeLayer(marker);
    }
  });
}

function toggleTraces() {
  showTraces = !showTraces;
  polylines.forEach((line) => {
    if (showTraces) {
      line.addTo(map);
    } else {
      map.removeLayer(line);
    }
  });
}

function toggleDarkMode() {
  darkMode = !darkMode;
  document.body.classList.toggle("dark");
  setTileLayer();
}
