import os
import re
import sqlite3
import socket
import datetime
import geoip2.database

LOG_DIR = "/var/log"
DB_PATH = "net_sentinel.db"
GEOIP_PATH = "data/geoip/GeoLite2-City.mmdb"

def parse_log_line(line):
    src_match = re.search(r"SRC=([\d\.]+)", line)
    dst_match = re.search(r"DST=([\d\.]+)", line)
    spt_match = re.search(r"SPT=(\d+)", line)
    dpt_match = re.search(r"DPT=(\d+)", line)

    if not (src_match and dst_match and spt_match and dpt_match):
        return None

    src_ip = src_match.group(1)
    dst_ip = dst_match.group(1)
    src_port = int(spt_match.group(1))
    dst_port = int(dpt_match.group(1))

    verdict = "DROP" if "DROP" in line else "ACCEPT" if "ACCEPT" in line else None
    if not verdict:
        return None

    if verdict == "DROP" and "IN=eth0" in line:
        return ("RX", src_ip, dst_port, verdict)
    elif verdict == "ACCEPT" and "OUT=eth0" in line:
        return ("TX", dst_ip, src_port, verdict)
    else:
        return None

def reverse_dns(ip):
    try:
        return socket.gethostbyaddr(ip)[0]
    except:
        return None

def guess_service(port):
    common = {
        22: "SSH", 80: "HTTP", 443: "HTTPS", 53: "DNS", 25: "SMTP",
        110: "POP3", 143: "IMAP", 3306: "MySQL", 6379: "Redis", 8080: "HTTP-alt"
    }
    return common.get(port, None)

def geoip_lookup(ip):
    try:
        reader = geoip2.database.Reader(GEOIP_PATH)
        response = reader.city(ip)
        return {
            "city": response.city.name,
            "state": response.subdivisions.most_specific.name,
            "country": response.country.name,
            "country_code": response.country.iso_code,
            "latitude": response.location.latitude,
            "longitude": response.location.longitude
        }
    except:
        return {}

def enrich_ip(ip, port, direction):
    info = geoip_lookup(ip)
    return {
        "ip": ip,
        "reverse_dns": reverse_dns(ip),
        "direction": direction,
        "port": port,
        "service": guess_service(port),
        "timestamp": datetime.datetime.utcnow().isoformat(),
        "city": info.get("city"),
        "state": info.get("state"),
        "country": info.get("country"),
        "country_code": info.get("country_code"),
        "latitude": info.get("latitude"),
        "longitude": info.get("longitude"),
        "trace_path": None,
        "verdict": None  # will be set later
    }

def insert_event(event):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO ip_events (
            ip, reverse_dns, direction, port, service, timestamp,
            city, state, country, country_code, latitude, longitude,
            trace_path, verdict
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event["ip"], event["reverse_dns"], event["direction"], event["port"],
        event["service"], event["timestamp"], event["city"], event["state"],
        event["country"], event["country_code"], event["latitude"],
        event["longitude"], event["trace_path"], event["verdict"]
    ))
    conn.commit()
    conn.close()

def process_logs():
    for filename in os.listdir(LOG_DIR):
        if filename != "router.log":
            continue
        filepath = os.path.join(LOG_DIR, filename)
        with open(filepath, "r") as f:
            for line in f:
                parsed = parse_log_line(line)
                if parsed:
                    direction, ip, port, verdict = parsed
                    event = enrich_ip(ip, port, direction)
                    event["verdict"] = verdict
                    insert_event(event)
        print(f"✅ Processed {filename}")

if __name__ == "__main__":
    process_logs()
