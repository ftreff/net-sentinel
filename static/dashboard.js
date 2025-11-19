let map;
let markers = [];
let polylines = [];
let currentVerdict = "ALL";
let currentService = "ALL";
let showTraces = true;

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    styles: darkMapStyle,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });

  fetch("/api/events")
    .then((response) => response.json())
    .then((data) => {
      data.forEach((event) => {
        const position = { lat: event.latitude, lng: event.longitude };

        const marker = new google.maps.Marker({
          position,
          map,
          icon: getMarkerIcon(event.verdict),
        });

        marker.verdict = event.verdict;
        marker.service = event.service;

        const content = `
          <div class="info-window">
            <strong>IP:</strong> ${event.ip}<br>
            <strong>Verdict:</strong> ${event.verdict}<br>
            <strong>Service:</strong> ${event.service}<br>
            <strong>Location:</strong> ${event.city}, ${event.country}<br>
            <strong>Time:</strong> ${event.timestamp}
          </div>
        `;
        const infowindow = new google.maps.InfoWindow({ content });
        marker.addListener("click", () => infowindow.open(map, marker));

        markers.push(marker);

        if (event.trace_path && event.trace_path.length > 1) {
          const path = event.trace_path.map((hop) => ({
            lat: hop.latitude,
            lng: hop.longitude,
          }));
          const line = new google.maps.Polyline({
            path,
            geodesic: true,
            strokeColor: "#00ffcc",
            strokeOpacity: 0.6,
            strokeWeight: 2,
          });
          line.setMap(showTraces ? map : null);
          polylines.push(line);
        }
      });
    });
}

function getMarkerIcon(verdict) {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 5,
    fillColor: verdict === "DROP" ? "#ff3366" : "#00ffcc",
    fillOpacity: 1,
    strokeWeight: 0,
  };
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
    marker.setMap(verdictMatch && serviceMatch ? map : null);
  });
}

function toggleTraces() {
  showTraces = !showTraces;
  polylines.forEach((line) => line.setMap(showTraces ? map : null));
}

function toggleDarkMode() {
  const isDark = document.body.classList.toggle("dark");
  map.setOptions({ styles: isDark ? darkMapStyle : null });
}

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#0d0d0d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#00ffcc" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#000000" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#333" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#00ffcc" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#222" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#00ffcc" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#444" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#001f1f" }] },
];
