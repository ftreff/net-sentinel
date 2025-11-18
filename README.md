net-sentinel/
├── setup.sh              # One-time setup script (installs deps, sets up DB, downloads GeoIP)
├── schema.sql            # SQLite schema for enriched IP events
├── parser.py             # Parses router logs, enriches data, inserts into DB
├── dashboard.py          # Backend API (Flask or FastAPI) serving map/table data
├── trace.py              # Traceroute module (optional per-IP or batch)
├── static/
│   ├── map.html          # Interactive map UI (Leaflet.js + toggles)
│   ├── table.html        # Table view of IPs by country
│   ├── style.css         # Light/dark mode styles
│   └── script.js         # Frontend logic (toggles, map, table, traceroute)
├── data/
│   ├── logs/             # Raw router logs (input)
│   └── geoip/            # GeoLite2 database (downloaded by setup)
├── net_sentinel.db       # SQLite database (created by setup)
└── README.md             # Project overview and usage
