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

- 🧠 Smart Parsing — Ingests structured logs, removes older entries, and enriches them with GeoIP + reverse DNS

- 🧩 Modular Service Mapping — External data/services.json defines port→service mappings; unknown ports trigger CLI + log warnings

- 🔒 Resilient Design — Handles missing GeoIP DB gracefully, skips reverse DNS for private/bogon ranges, and logs warnings cleanly

## 🚀 Getting Started

### 1. ⚙️ Setup
Run the one-time setup scripts to set up log server and install dependencies, download the GeoIP database, and initialize the SQLite schema:

```bash
bash setup-log-server.sh
bash setup.sh
```

### 2. 📡 Ingesting Logs
Use ingest.sh to parse logs, populate the database, geolocate IPs, and resolve services by port:
This runs the parser scripts in scripts/ (batch_parser.py, live_parser.py, parser_utils.py)
```bash
bash ingest.sh
```

### 3. 🛠 Start the backend
```bash
python dashboard.py
```
Then open http://localhost:5000 in your browser.

## 📁 Project Structure
```
net-sentinel/
├── dashboard.py                        # RUN THIS FOURTH! - And web app/site is functional! (Flask backend API)
├── data                                # stored data 
│   ├── geoip
│   │   ├── GeoLite2-City.mmdb          # GeoIP database (GeoLite2-City.mmdb)
│   │   └── GeoLite2-City.mmdb.meta     # GeoIP database (GeoLite2-City.mmdb) meta data to decide to update or skip download
│   ├── services.json                   # External port→service mapping
│   └── services_legend.txt             # External port→service emoji useage key
├── ingest.sh                           # RUN THIS THIRD! - Runs parser scripts in /scripts
├── logs                                # generated logs
│   ├── last30router.log                # generated log
│   ├── parser-warnings.log             # generated log
│   └── router.log                      # generated log
├── net_sentinel.db                     # SQLite database
├── net_sentinel.db-shm
├── net_sentinel.db-wal
├── README.md                           # Project overview
├── schema.sql                          # SQLite schema (unique constraints + indices)
├── scripts                             # parser scripts   
│   ├── batch_parser.py                 # Existing Log parser
│   ├── live_parser.py                  # Live Log parser
│   ├── parser_utils.py                 # Log parser and enrichment engine (GeoIP, reverse DNS, services)
│   ├── __pycache__
│   │   └── parser_utils.cpython-313.pyc
│   └── trim_router_log.py             # Trims logs to most recent 7 days and stores a log of the last 30 Days
├── setup-log-server.sh                # RUN THIS FIRST! - Configures rsyslog to receive logs from a router
├── setup.sh                           # RUN THIS SECOND! One-time setup script (deps, GeoIP, schema)
└── static                             # Frontend files
    ├── dashboard.js                   # Map logic (filters, stats, reverse DNS refresh)
    ├── map.html                       # Map UI (Leaflet + dashboard.js)
    └── style.css                      # UI theme
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
