-- Net Sentinel 2: SQLite schema for enriched IP events

CREATE TABLE IF NOT EXISTS ip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    reverse_dns TEXT,
    direction TEXT CHECK(direction IN ('RX', 'TX')),
    port INTEGER,
    service TEXT,
    timestamp TEXT NOT NULL,
    city TEXT,
    state TEXT,
    country TEXT,
    country_code TEXT,
    latitude REAL,
    longitude REAL,
    trace_path TEXT  -- optional: comma-separated hops or JSON array
);

-- Optional index for faster country-based queries
CREATE INDEX IF NOT EXISTS idx_country_code ON ip_events(country_code);

-- Optional index for timestamp filtering
CREATE INDEX IF NOT EXISTS idx_timestamp ON ip_events(timestamp);
