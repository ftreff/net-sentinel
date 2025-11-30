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
    direction TEXT CHECK(direction IN ('INBOUND','OUTBOUND')),

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
    trace_path TEXT
);

-- Uniqueness constraint: same src/dst/proto/verdict/direction considered one event
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_events_unique
ON ip_events (src_ip, dst_ip, src_port, dst_port, proto, verdict, direction);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_src_ip ON ip_events(src_ip);
CREATE INDEX IF NOT EXISTS idx_dst_ip ON ip_events(dst_ip);
CREATE INDEX IF NOT EXISTS idx_country_code ON ip_events(country_code);
CREATE INDEX IF NOT EXISTS idx_timestamp ON ip_events(timestamp);

-- Composite indexes for common dashboard filters
CREATE INDEX IF NOT EXISTS idx_verdict_timestamp ON ip_events(verdict, timestamp);
CREATE INDEX IF NOT EXISTS idx_proto_timestamp ON ip_events(proto, timestamp);
CREATE INDEX IF NOT EXISTS idx_direction_timestamp ON ip_events(direction, timestamp);

-- 30-day archive table (same schema as ip_events)
CREATE TABLE IF NOT EXISTS ip_events_30 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    src_ip TEXT NOT NULL,
    src_rdns TEXT,
    src_port INTEGER,
    src_service TEXT,

    dst_ip TEXT NOT NULL,
    dst_rdns TEXT,
    dst_port INTEGER,
    dst_service TEXT,

    proto TEXT,
    in_if TEXT,
    out_if TEXT,

    verdict TEXT CHECK(verdict IN ('DROP', 'ACCEPT')),
    direction TEXT CHECK(direction IN ('INBOUND','OUTBOUND')),

    timestamp TEXT NOT NULL,
    hit_count INTEGER DEFAULT 1,

    city TEXT,
    state TEXT,
    country TEXT,
    country_code TEXT,
    latitude REAL,
    longitude REAL,

    trace_path TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_events_30_unique
ON ip_events_30 (src_ip, dst_ip, src_port, dst_port, proto, verdict, direction);

CREATE INDEX IF NOT EXISTS idx_src_ip_30 ON ip_events_30(src_ip);
CREATE INDEX IF NOT EXISTS idx_dst_ip_30 ON ip_events_30(dst_ip);
CREATE INDEX IF NOT EXISTS idx_country_code_30 ON ip_events_30(country_code);
CREATE INDEX IF NOT EXISTS idx_timestamp_30 ON ip_events_30(timestamp);

CREATE INDEX IF NOT EXISTS idx_verdict_timestamp_30 ON ip_events_30(verdict, timestamp);
CREATE INDEX IF NOT EXISTS idx_proto_timestamp_30 ON ip_events_30(proto, timestamp);
CREATE INDEX IF NOT EXISTS idx_direction_timestamp_30 ON ip_events_30(direction, timestamp);
