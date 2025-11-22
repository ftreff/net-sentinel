-- Net Sentinel: SQLite schema for enriched IP events

CREATE TABLE IF NOT EXISTS ip_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Source side
    src_ip TEXT NOT NULL,
    src_rdns TEXT,
    src_port INTEGER,
    src_service TEXT,

    -- Destination side
    dst_ip TEXT NOT NULL,
    dst_rdns TEXT,
    dst_port INTEGER,
    dst_service TEXT,

    -- Protocol and interfaces
    proto TEXT,
    in_if TEXT,
    out_if TEXT,

    -- Verdict and direction
    verdict TEXT CHECK(verdict IN ('DROP', 'ACCEPT')),
    direction TEXT CHECK(direction IN ('Inbound', 'Outbound')),

    -- Timestamp and counters
    timestamp TEXT NOT NULL,  -- ISO 8601 UTC string
    hit_count INTEGER DEFAULT 1,

    -- GeoIP enrichment (source IP)
    city TEXT,
    state TEXT,
    country TEXT,
    country_code TEXT,
    latitude REAL,
    longitude REAL,

    -- Optional trace path
    trace_path TEXT,

    -- Deduplication: same src/dst/proto/verdict/direction considered one event
    UNIQUE(src_ip, dst_ip, src_port, dst_port, proto, verdict, direction)
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_src_ip ON ip_events(src_ip);
CREATE INDEX IF NOT EXISTS idx_dst_ip ON ip_events(dst_ip);
CREATE INDEX IF NOT EXISTS idx_country_code ON ip_events(country_code);
CREATE INDEX IF NOT EXISTS idx_timestamp ON ip_events(timestamp);

-- Composite indexes for common dashboard filters
CREATE INDEX IF NOT EXISTS idx_verdict_timestamp ON ip_events(verdict, timestamp);
CREATE INDEX IF NOT EXISTS idx_proto_timestamp ON ip_events(proto, timestamp);
CREATE INDEX IF NOT EXISTS idx_direction_timestamp ON ip_events(direction, timestamp);
