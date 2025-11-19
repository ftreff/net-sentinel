let map;
let markers = [];
let polylines = [];
let currentVerdict = "ALL";
let currentService = "ALL";
let showTraces = false;
let darkMode = true;
let currentTileLayer = null;

function initMap() {
  map = L.map("map").setView([20, 0], 2);
  setTileLayer();
  loadEvents();

  // Start polling every 10 seconds
  setInterval(refreshMap, 10000);
}

function setTileLayer() {
  const url = darkMode
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  const tileLayer = L.tileLayer(url, {
    attribution: '&copy; OpenStreetMap & CartoDB',
    subdomains: "abcd",
    maxZoom: 19,
  });

  if (currentTileLayer && map.hasLayer(currentTileLayer)) {
    map.removeLayer(currentTileLayer);
  }

  tileLayer.addTo(map);
  currentTileLayer = tileLayer;
}

function loadEvents() {
  fetch("/api/events")
    .then((res) => res.json())
    .then((data) => {
      clearMap();

      data.forEach((event) => {
        if (event.latitude == null || event.longitude == null) return;

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
      });

      updateVisibility();
      if (showTraces) drawTracesToAlbany();
    });
}

function clearMap() {
  markers.forEach((m) => map.removeLayer(m));
  polylines.forEach((p) => map.removeLayer(p));
  markers = [];
  polylines = [];
}

function refreshMap() {
  loadEvents();
}

function filterMarkers(verdict) {
  currentVerdict = verdict;
  updateVisibility();
  if (showTraces) drawTracesToAlbany();
}

function filterByService(service) {
  currentService = service;
  updateVisibility();
  if (showTraces) drawTracesToAlbany();
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

  polylines.forEach((line) => map.removeLayer(line));
  polylines = [];
}

function drawTracesToAlbany() {
  const albanyLatLng = [42.6526, -73.7562];

  markers.forEach((marker) => {
    const verdictMatch = currentVerdict === "ALL" || marker.verdict === currentVerdict;
    const serviceMatch = currentService === "ALL" || marker.service === currentService;
    if (verdictMatch && serviceMatch) {
      const line = L.polyline([marker.getLatLng(), albanyLatLng], {
        color: "#00ffcc",
        weight: 2,
        opacity: 0.6,
      });
      line.addTo(map);
      polylines.push(line);
    }
  });
}

function toggleTraces() {
  showTraces = !showTraces;
  updateVisibility();
  if (showTraces) drawTracesToAlbany();
}

function toggleDarkMode() {
  darkMode = !darkMode;
  document.body.classList.toggle("dark");
  setTileLayer();
}
