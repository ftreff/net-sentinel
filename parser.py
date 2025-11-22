import os
import re
import sqlite3
import socket
import datetime
import sys
import logging
import json
from tqdm import tqdm

import geoip2.database

LOG_DIR = "/var/log"
GROUPED_LOG = "logs/grouped-router.log"  # deduped log in project folder
DB_PATH = "net_sentinel.db"
GEOIP_PATH = "data/geoip/GeoLite2-City.mmdb"

BATCH_SIZE = 1000

geoip_cache = {}
dns_cache = {}

# configure logging for warnings
logging.basicConfig(
    filename="parser-warnings.log",
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

# Load services map once
def load_services_map():
    try:
        with open("data/services.json", "r") as f:
            data = json.load(f)
            # Normalize keys (strings) -> values (strings)
            return {str(k): str(v) for k, v in data.items()}
    except Exception:
        return {}

SERVICES_MAP = load_services_map()

DEFAULT_SERVICES = {
    22: "SSH", 23: "Telnet", 3389: "RDP", 5900: "VNC",
    25: "SMTP", 465: "SMTP SSL", 587: "SMTP Submission",
    110: "POP3", 995: "POP3 SSL", 143: "IMAP", 993: "IMAP SSL",
    53: "DNS", 80: "HTTP", 443: "HTTPS", 3306: "MySQL", 6379: "Redis",
    445: "SMB/Samba", 20: "FTP-Data", 21: "FTP"
}

# Initialize a single GeoIP reader
try:
    GEOIP_READER = geoip2.database.Reader(GEOIP_PATH)
except Exception:
    GEOIP_READER = None
    tqdm.write("⚠️ GeoIP database not found or failed to open; proceeding without enrichment")

PRIVATE_NETS = [
    ("0.0.0.0", "8.255.255.255"),     # 0.0.0.0/8
    ("10.0.0.0", "10.255.255.255"),   # 10.0.0.0/8
    ("100.64.0.0", "100.127.255.255"),# CGNAT 100.64.0.0/10
    ("127.0.0.0", "127.255.255.255"), # Loopback
    ("169.254.0.0", "169.254.255.255"),# Link-local
    ("172.16.0.0", "172.31.255.255"), # 172.16.0.0/12
    ("192.0.0.0", "192.0.0.255"),     # IETF Protocol Assignments
    ("192.0.2.0", "192.0.2.255"),     # TEST-NET-1
    ("192.168.0.0", "192.168.255.255"),# 192.168.0.0/16
    ("198.18.0.0", "198.19.255.255"), # Benchmarking
    ("198.51.100.0", "198.51.100.255"),# TEST-NET-2
    ("203.0.113.0", "203.0.113.255"), # TEST-NET-3
]

def ip_to_int(ip):
    try:
        return int.from_bytes(socket.inet_aton(ip), "big")
    except OSError:
        return None

def is_private_or_bogon(ip):
    val = ip_to_int(ip)
    if val is None:
        return True  # treat invalid/non-IPv4 as non-routable for DNS
    for start, end in PRIVATE_NETS:
        s = ip_to_int(start)
        e = ip_to_int(end)
        if s <= val <= e:
            return True
    return False

def parse_log_line(line):
    # Extract fields
    src_match = re.search(r"SRC=([\d\.]+)", line)
    dst_match = re.search(r"DST=([\d\.]+)", line)
    spt_match = re.search(r"SPT=(\d+)", line)
    dpt_match = re.search(r"DPT=(\d+)", line)
    proto_match = re.search(r"PROTO=(\w+)", line)
    in_if_match = re.search(r"IN=(\w+)", line)
    out_if_match = re.search(r"OUT=(\w+)", line)

    verdict = "DROP" if "DROP" in line else "ACCEPT" if "ACCEPT" in line else None
    if not verdict or not src_match or not dst_match:
        return None

    src_ip = src_match.group(1)
    dst_ip = dst_match.group(1)
    src_port = int(spt_match.group(1)) if spt_match else None
    dst_port = int(dpt_match.group(1)) if dpt_match else None
    proto = proto_match.group(1) if proto_match else None
    in_if = in_if_match.group(1) if in_if_match else None
    out_if = out_if_match.group(1) if out_if_match else None

    # Direction: inbound if IN=wan/eth0, outbound if OUT=wan/eth0
    direction = "Inbound" if in_if else "Outbound"

    # HITCOUNT marker
    hit_match = re.search(r"HITCOUNT=(\d+)", line)
    hit_count = int(hit_match.group(1)) if hit_match else 1

    # Timestamp
    ts_match = re.search(r"LASTTS=([0-9T:\-\.]+Z?)", line)
    if ts_match:
        timestamp = ts_match.group(1)
    else:
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    return {
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "src_port": src_port,
        "dst_port": dst_port,
        "proto": proto,
        "in_if": in_if,
        "out_if": out_if,
        "verdict": verdict,
        "direction": direction,
        "hit_count": hit_count,
        "timestamp": timestamp
    }

def reverse_dns(ip):
    if ip in dns_cache:
        return dns_cache[ip]
    if is_private_or_bogon(ip):
        dns_cache[ip] = None
        return None
    try:
        result = socket.gethostbyaddr(ip)[0]
    except Exception:
        result = None
    dns_cache[ip] = result
    return result

def guess_service(port):
    # Try external map first (keys are strings)
    name = SERVICES_MAP.get(str(port))
    if not name:
        name = DEFAULT_SERVICES.get(port)

    if not name:
        warning_msg = f"Unknown port {port} — consider adding to data/services.json"
        #tqdm.write(f"⚠️ {warning_msg}")  # CLI warning without breaking progress bar
        logging.warning(warning_msg)      # log file warning
        name = "Unknown"

    return f"{name} ({port})"

def geoip_lookup(ip):
    if ip in geoip_cache:
        return geoip_cache[ip]
    if GEOIP_READER is None or is_private_or_bogon(ip):
        geoip_cache[ip] = {}
        return {}
    try:
        response = GEOIP_READER.city(ip)
        result = {
            "city": response.city.name,
            "state": response.subdivisions.most_specific.name,
            "country": response.country.name,
            "country_code": response.country.iso_code,
            "latitude": response.location.latitude,
            "longitude": response.location.longitude
        }
    except Exception:
        result = {}
    geoip_cache[ip] = result
    return result

def enrich_ip(ip, port, direction, timestamp):
    info = geoip_lookup(ip)
    return {
        "ip": ip,
        "reverse_dns": reverse_dns(ip),
        "direction": direction,
        "port": port,
        "service": guess_service(port),
        "timestamp": timestamp,
        "city": info.get("city"),
        "state": info.get("state"),
        "country": info.get("country"),
        "country_code": info.get("country_code"),
        "latitude": info.get("latitude"),
        "longitude": info.get("longitude"),
        "trace_path": None,
        "verdict": None,
        "hit_count": 1
    }

def enrich_event(event):
    # Reverse DNS
    event["src_rdns"] = reverse_dns(event["src_ip"])
    event["dst_rdns"] = reverse_dns(event["dst_ip"])

    # Services
    event["src_service"] = guess_service(event["src_port"]) if event["src_port"] else None
    event["dst_service"] = guess_service(event["dst_port"]) if event["dst_port"] else None

    # GeoIP (source IP only)
    info = geoip_lookup(event["src_ip"])
    event["city"] = info.get("city")
    event["state"] = info.get("state")
    event["country"] = info.get("country")
    event["country_code"] = info.get("country_code")
    event["latitude"] = info.get("latitude")
    event["longitude"] = info.get("longitude")

    return event

def insert_events(events):
    if not events:
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        c = conn.cursor()
        c.executemany("""
            INSERT INTO ip_events (
                src_ip, src_rdns, src_port, src_service,
                dst_ip, dst_rdns, dst_port, dst_service,
                proto, in_if, out_if,
                verdict, direction,
                timestamp, hit_count,
                city, state, country, country_code, latitude, longitude,
                trace_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(src_ip, dst_ip, src_port, dst_port, proto, verdict, direction)
            DO UPDATE SET
                src_rdns=excluded.src_rdns,
                dst_rdns=excluded.dst_rdns,
                src_service=excluded.src_service,
                dst_service=excluded.dst_service,
                timestamp=excluded.timestamp,
                city=excluded.city,
                state=excluded.state,
                country=excluded.country,
                country_code=excluded.country_code,
                latitude=excluded.latitude,
                longitude=excluded.longitude,
                trace_path=excluded.trace_path,
                hit_count=hit_count + excluded.hit_count
        """, [(
            e.get("src_ip"), e.get("src_rdns"), e.get("src_port"), e.get("src_service"),
            e.get("dst_ip"), e.get("dst_rdns"), e.get("dst_port"), e.get("dst_service"),
            e.get("proto"), e.get("in_if"), e.get("out_if"),
            e.get("verdict"), e.get("direction"),
            e.get("timestamp"), e.get("hit_count"),
            e.get("city"), e.get("state"), e.get("country"), e.get("country_code"),
            e.get("latitude"), e.get("longitude"),
            e.get("trace_path")
        ) for e in events])
        conn.commit()
    finally:
        conn.close()

def process_file(filepath):
    inserted = 0
    batch = []
    try:
        with open(filepath, "r") as f:
            for line in tqdm(f, desc=f"Processing {filepath}", unit="line"):
                parsed = parse_log_line(line)
                if not parsed:
                    continue

                # Enrich with reverse DNS, services, GeoIP
                event = enrich_event(parsed)

                batch.append(event)
                if len(batch) >= BATCH_SIZE:
                    insert_events(batch)
                    inserted += len(batch)
                    batch = []
    except FileNotFoundError:
        tqdm.write(f"⚠️ File not found: {filepath}")
        return
    except Exception as e:
        tqdm.write(f"⚠️ Error processing {filepath}: {e}")
        # continue after logging; batch may still flush below

    if batch:
        insert_events(batch)
        inserted += len(batch)

    tqdm.write(f"✅ Finished {filepath} — {inserted} events processed (deduplicated with hit counter)")

def process_logs():
    # process live router.log
    router_log = os.path.join(LOG_DIR, "router.log")
    if os.path.exists(router_log):
        process_file(router_log)
    else:
        tqdm.write(f"ℹ️ Skipping missing {router_log}")

    # process grouped-router.log if exists
    if os.path.exists(GROUPED_LOG):
        process_file(GROUPED_LOG)
    else:
        tqdm.write(f"ℹ️ Skipping missing {GROUPED_LOG}")

if __name__ == "__main__":
    process_logs()
