-- Net Sentinel: SQLite schema for enriched IP events

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
    trace_path TEXT,  -- optional: comma-separated hops or JSON array
    verdict TEXT CHECK(verdict IN ('DROP', 'ACCEPT')),  -- packet status
    hit_count INTEGER DEFAULT 1  -- new: frequency counter
);

-- Deduplication: ensure only one row per ip/port/verdict/direction
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_event
ON ip_events(ip, port, verdict, direction);

-- Optional index for faster country-based queries
CREATE INDEX IF NOT EXISTS idx_country_code ON ip_events(country_code);

-- Optional index for timestamp filtering
CREATE INDEX IF NOT EXISTS idx_timestamp ON ip_events(timestamp);

-- Helpful composite indexes for common dashboard filters
CREATE INDEX IF NOT EXISTS idx_verdict_timestamp ON ip_events(verdict, timestamp);
CREATE INDEX IF NOT EXISTS idx_port_timestamp ON ip_events(port, timestamp);
CREATE INDEX IF NOT EXISTS idx_direction_timestamp ON ip_events(direction, timestamp);
