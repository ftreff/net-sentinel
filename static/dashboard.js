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

  loadEvents();
}

function loadEvents() {
  fetch("/api/events")
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
      loadEvents(); // reload map with updated data
    })
    .catch((err) => {
      console.error("Reverse DNS update failed:", err);
      alert("Failed to update reverse DNS.");
    });
}

window.onload = initMap;
