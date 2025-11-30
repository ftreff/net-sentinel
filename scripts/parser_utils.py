#!/usr/bin/env python3
"""
Parser utilities for Net Sentinel.
Shared functions for parsing router.log lines, enriching events, and inserting into net_sentinel.db.
"""

import os, re, sqlite3, socket, datetime, logging, json, time
import geoip2.database

# Paths relative to project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(PROJECT_ROOT, "net_sentinel.db")
SCHEMA_FILE = os.path.join(PROJECT_ROOT, "schema.sql")
GEOIP_PATH = os.path.join(PROJECT_ROOT, "data/geoip/GeoLite2-City.mmdb")

# Ensure logs directory exists
LOG_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# Configure logging
logging.basicConfig(
    filename=os.path.join(LOG_DIR, "parser-warnings.log"),
    level=logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

# Load services.json
def load_services_map():
    try:
        with open(os.path.join(PROJECT_ROOT, "data/services.json"), "r") as f:
            return {str(k): str(v) for k,v in json.load(f).items()}
    except Exception:
        return {}

SERVICES_MAP = load_services_map()

DEFAULT_SERVICES = {
    22:"SSH",23:"Telnet",3389:"RDP",5900:"VNC",
    25:"SMTP",465:"SMTP SSL",587:"SMTP Submission",
    110:"POP3",995:"POP3 SSL",143:"IMAP",993:"IMAP SSL",
    53:"DNS",80:"HTTP",443:"HTTPS",3306:"MySQL",6379:"Redis",
    445:"SMB/Samba",20:"FTP-Data",21:"FTP"
}

# GeoIP reader
try:
    GEOIP_READER = geoip2.database.Reader(GEOIP_PATH)
except Exception:
    GEOIP_READER = None

geoip_cache, dns_cache = {}, {}

def parse_log_line(line):
    """Extract fields from a router.log line."""
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

    return {
        "src_ip": src_match.group(1),
        "dst_ip": dst_match.group(1),
        "src_port": int(spt_match.group(1)) if spt_match else None,
        "dst_port": int(dpt_match.group(1)) if dpt_match else None,
        "proto": proto_match.group(1) if proto_match else None,
        "in_if": in_if_match.group(1) if in_if_match else None,
        "out_if": out_if_match.group(1) if out_if_match else None,
        "verdict": verdict,
        "direction": "INBOUND" if not out_if_match or not out_if_match.group(1) else "OUTBOUND",
        "hit_count": int(re.search(r"HITCOUNT=(\d+)", line).group(1)) if re.search(r"HITCOUNT=(\d+)", line) else 1,
        "timestamp": re.search(r"LASTTS=([0-9T:\-\.]+Z?)", line).group(1) if re.search(r"LASTTS=([0-9T:\-\.]+Z?)", line) else datetime.datetime.now(datetime.timezone.utc).isoformat()
    }

def reverse_dns(ip):
    if ip in dns_cache: return dns_cache[ip]
    try: result = socket.gethostbyaddr(ip)[0]
    except Exception: result = None
    dns_cache[ip] = result
    return result

def guess_service(port):
    if port is None: return "Unknown"
    for key,name in SERVICES_MAP.items():
        if "-" in key:
            try:
                start,end=map(int,key.split("-"))
                if start<=port<=end: return name
            except: continue
        elif str(port)==key: return name
    return DEFAULT_SERVICES.get(port,"Unknown")
def geoip_lookup(ip):
    if ip in geoip_cache: return geoip_cache[ip]
    if GEOIP_READER is None: return {}
    try:
        r=GEOIP_READER.city(ip)
        result={"city":r.city.name,"state":r.subdivisions.most_specific.name,
                "country":r.country.name,"country_code":r.country.iso_code,
                "latitude":r.location.latitude,"longitude":r.location.longitude}
    except Exception: result={}
    geoip_cache[ip]=result
    return result

def enrich_event(event):
    event["src_rdns"]=reverse_dns(event["src_ip"])
    event["dst_rdns"]=reverse_dns(event["dst_ip"])
    event["src_service"]=guess_service(event["src_port"])
    event["dst_service"]=guess_service(event["dst_port"])
    target_ip=event["src_ip"] if event["verdict"]=="DROP" else event["dst_ip"]
    info=geoip_lookup(target_ip)
    event.update(info)
    return event

def _with_retry(fn, retries=5, backoff=0.5):
    """
    Helper to retry a DB operation on transient 'database is locked' errors.
    """
    for attempt in range(retries):
        try:
            return fn()
        except sqlite3.OperationalError as e:
            if "database is locked" in str(e).lower():
                if attempt < retries - 1:
                    sleep_time = backoff * (attempt + 1)
                    logging.warning(f"DB locked, retrying in {sleep_time:.1f}s (attempt {attempt+1}/{retries})")
                    time.sleep(sleep_time)
                    continue
            raise

def insert_events(events, table="ip_events", chunk_size=500):
    """
    Insert a list of event dicts into the DB table.
    Uses a dedicated connection with timeout and batched transactions.
    """
    if not events:
        return

    def _do_insert_batch(batch):
        conn = sqlite3.connect(DB_PATH, timeout=30)
        try:
            with conn:
                cur = conn.cursor()
                sql = f"""
                    INSERT INTO {table} (
                        src_ip,src_rdns,src_port,src_service,
                        dst_ip,dst_rdns,dst_port,dst_service,
                        proto,in_if,out_if,
                        verdict,direction,
                        timestamp,hit_count,
                        city,state,country,country_code,latitude,longitude
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    ON CONFLICT(src_ip,dst_ip,src_port,dst_port,proto,verdict,direction)
                    DO NOTHING
                """
                rows = [(
                    e.get("src_ip"), e.get("src_rdns"), e.get("src_port"), e.get("src_service"),
                    e.get("dst_ip"), e.get("dst_rdns"), e.get("dst_port"), e.get("dst_service"),
                    e.get("proto"), e.get("in_if"), e.get("out_if"),
                    e.get("verdict"), e.get("direction"),
                    e.get("timestamp"), e.get("hit_count"),
                    e.get("city"), e.get("state"), e.get("country"), e.get("country_code"),
                    e.get("latitude"), e.get("longitude")
                ) for e in batch]
                cur.executemany(sql, rows)
        finally:
            conn.close()

    # Break into chunks to avoid huge transactions
    for i in range(0, len(events), chunk_size):
        batch = events[i:i+chunk_size]
        _with_retry(lambda: _do_insert_batch(batch))
