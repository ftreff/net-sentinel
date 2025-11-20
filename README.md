# Net Sentinel

**Net Sentinel** is a real-time network event visualization and analysis tool. It ingests firewall logs, parses and enriches them with geolocation and reverse DNS data, and displays the results on an interactive map with filtering and statistics.

> Built for security analysts, network engineers, and curious tinkerers who want to see their network traffic come alive.

---

## 🔍 Features

- 🌍 **Interactive Map** — Visualize incoming connections with geolocated markers and verdict-based color coding
- 🕵️ **Reverse DNS Lookup** — Click to resolve IPs on demand
- ⏱️ **Time Filtering** — View events from the last 10 minutes to 90 days
- ⚖️ **Verdict Filtering** — Toggle between `ACCEPT`, `DROP`, or all events
- 📊 **Stats Bar** — See top countries, ports, and verdict counts
- 🧠 **Smart Parsing** — Ingests structured logs and enriches them with GeoIP + reverse DNS
- 🧩 **Modular Design** — Easily extendable for new data sources or visualizations

---

## 🚀 Getting Started

### 1. ⚙️ Setup

Run the one-time setup script to install dependencies, download GeoIP database, and initialize the SQLite schema:

```bash
bash setup.sh
```

### 2. 📡 Ingesting Logs

Use ingest.sh to parse logs and populate the database, automatically geolocates IPs and resolves services by port

```bash
bash ingest.sh
```

### 3. 🛠 Start the backend

```bash
python dashboard.py
```

Then open http://localhost:5000 in your browser.

---

## 📁 Project Structure
```
net-sentinel-2/
├── setup-log-server.sh   # Script configures rsyslog to receive logs from a router
├── setup.sh              # One-time setup script
├── ingest.sh             # Runs parser with priority
├── parser.py             # Log parser and enrichment engine
├── dashboard.py          # Backend API
├── static/               # Frontend files
│   ├── map.html          # Map UI (loads dashboard.js and style.css)
│   ├── style.css         # Hacker theme
│   └── dashboard.js      # Map logic
├── data/
│   └── geoip/            # GeoIP database
├── schema.sql            # SQLite schema
├── net_sentinel.db       # SQLite database
└── README.md             # Project overview
```

---

## 🧪 Requirements

A router that can send syslog to your server’s IP on UDP port 514.

Python 3.8+

SQLite

MaxMind GeoLite2 database (automatically downloaded)

Flask or FastAPI (installed via setup)
