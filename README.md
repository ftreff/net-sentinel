# Net Sentinel
**Net Sentinel** is a real-time network event visualization and analysis tool. It ingests firewall/router logs, deduplicates and enriches them with geolocation, reverse DNS, and service mapping, then displays the results on an interactive map with filtering and statistics.

> Built for security analysts, network engineers, and curious tinkerers who want to see their network traffic come alive.

---

## 🔍 Features
🌍 Interactive Map — Visualize incoming/outgoing connections with geolocated markers and verdict-based color coding

- 🕵️ Reverse DNS Lookup — Click markers to resolve IPs on demand, or refresh via API

- ⏱️ Time Filtering — View events from the last 10 minutes up to 90 days

- ⚖️ Verdict Filtering — Toggle between ACCEPT, DROP, or all events

- 📊 Stats Bar — See top countries, ports, and verdict counts (aggregated by hit count)

- 🧠 Smart Parsing — Ingests structured logs, deduplicates older entries, and enriches them with GeoIP + reverse DNS

- 📦 Deduplication — Groups events older than 7 days into a summarized log with HITCOUNT and LASTTS markers

- 🧩 Modular Service Mapping — External data/services.json defines port→service mappings; unknown ports trigger CLI + log warnings

- ⚡ Efficient Storage — SQLite schema enforces uniqueness on (ip, port, verdict, direction) and increments hit counters

- 🔒 Resilient Design — Handles missing GeoIP DB gracefully, skips reverse DNS for private/bogon ranges, and logs warnings cleanly

## 🚀 Getting Started

### 1. ⚙️ Setup
Run the one-time setup script to install dependencies, download the GeoIP database, and initialize the SQLite schema:

```bash
bash setup.sh
```

### 2. 📡 Ingesting Logs
Use ingest.sh to deduplicate and parse logs, populate the database, geolocate IPs, and resolve services by port:

```bash
bash ingest.sh
```
This runs dedupe_router_log.py first (to archive >7d logs into logs/grouped-router.log), then parser.py to ingest both fresh and grouped logs.

### 3. 🛠 Start the backend
```bash
python dashboard.py
```
Then open http://localhost:5000 in your browser.

## 📁 Project Structure
```
net-sentinel/
├── setup-log-server.sh   # Configures rsyslog to receive logs from a router
├── setup.sh              # One-time setup script (deps, GeoIP, schema)
├── ingest.sh             # Runs dedupe + parser
├── dedupe_router_log.py  # Deduplicates >7d logs into grouped-router.log
├── parser.py             # Log parser and enrichment engine (GeoIP, reverse DNS, services)
├── dashboard.py          # Flask backend API
├── static/               # Frontend files
│   ├── map.html          # Map UI (Leaflet + dashboard.js)
│   ├── style.css         # Dark hacker theme
│   └── dashboard.js      # Map logic (filters, stats, reverse DNS refresh)
├── data/
│   ├── services.json     # External port→service mapping
│   └── geoip/            # GeoIP database (GeoLite2-City.mmdb)
├── schema.sql            # SQLite schema (unique constraints + indices)
├── net_sentinel.db       # SQLite database
└── README.md             # Project overview
```
---
## 🧪 Requirements
- A router that can send syslog to your server’s IP on UDP port 514
- Python 3.8+
- SQLite
- MaxMind GeoLite2 database (automatically downloaded by setup)
- Flask (installed via setup)

## ⚠️ Notes
Unknown ports not in services.json or defaults will print a warning in CLI and log to parser-warnings.log.

Reverse DNS lookups are cached and skipped for private/bogon ranges.

Deduplication merges grouped logs across runs, summing hit counts and keeping the latest timestamp.

Stats endpoints (/api/stats) aggregate by SUM(hit_count) for accuracy.
