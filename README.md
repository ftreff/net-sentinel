# Net Sentinel 2

Net Sentinel 2 is a real-time network intelligence dashboard that parses router logs, enriches IP data, and visualizes global intrusion attempts. It combines log analysis, GeoIP mapping, service detection, and traceroute diagnostics into a single interactive interface.

## 🌐 Features

- 🔍 **Log Parsing**: Extracts IPs, ports, RX/TX direction, timestamps from router logs
- 🧠 **Data Enrichment**:
  - Reverse DNS lookup
  - GeoIP location (city, state, country, lat/lon)
  - Port-based service guessing (e.g. SSH, HTTP, BitTorrent)
  - Traceroute path to source IPs
- 🗃️ **Database Logging**: Stores enriched events in SQLite for querying and visualization
- 🗺️ **Interactive Dashboard**:
  - World map with toggleable overlays:
    - Trace lines
    - Heat maps
    - Location dots
  - Country rankings by intrusion volume
  - Light/dark mode toggle
  - Built-in traceroute tool
  - Table view of IPs by country with full metadata

## ⚙️ Setup

Run the one-time setup script to install dependencies, download GeoIP database, and initialize the SQLite schema:

```bash
bash setup.sh
```

## 📁 Project Structure
```
net-sentinel-2/
├── setup.sh              # One-time setup script
├── schema.sql            # SQLite schema
├── parser.py             # Log parser and enrichment engine
├── dashboard.py          # Backend API
├── trace.py              # Traceroute module
├── static/               # Frontend files
│   ├── map.html          # Map UI (loads dashboard.js and style.css)
│   ├── table.html        # Table UI
│   ├── style.css         # Neon hacker theme
│   ├── script.js         # Legacy logic (can be deprecated or merged)
│   └── dashboard.js      # New modular map logic (toggles, filters, trace lines)
├── data/
│   ├── logs/             # Raw router logs
│   └── geoip/            # GeoIP database
├── net_sentinel.db       # SQLite database
└── README.md             # Project overview
```

## 🧪 Requirements

Python 3.8+

SQLite

MaxMind GeoLite2 database (automatically downloaded)

Flask or FastAPI (installed via setup)
