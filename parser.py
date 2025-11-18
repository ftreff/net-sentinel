import os
import re
import sqlite3
import socket
import datetime
import geoip2.database

LOG_DIR = "data/logs"
DB_FILE = "net_sentinel.db"
GEOIP_DB = "data/geoip/GeoLite2-City.mmdb"

PORT_MAP = {
    22: "SSH", 80: "HTTP", 443: "HTTPS", 21: "FTP", 25: "SMTP",
    53: "DNS", 3306: "MySQL", 3389: "RDP", 6881: "BitTorrent"
}

def parse_log_line(line):
    match = re.search(r"(RX|TX)\s+(\d{1,3}(?:\.\d{1,3}){3}):(\d+)", line)
    if match:
        direction = match.group(1)
        ip = match.group(2)
        port = int(match.group(3))
        return direction, ip, port
    return None

def enrich_ip(ip, port, direction):
    try:
        reverse_dns = socket.gethostbyaddr(ip)[0]
    except socket.herror:
        reverse_dns = None

    service = PORT_MAP.get(port, "Unknown")
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    try:
        reader = geoip2.database.Reader(GEOIP_DB)
        response = reader.city(ip)
        city = response.city.name
        state = response.subdivisions.most_specific.name
        country = response.country.name
        country_code = response.country.iso_code
        latitude = response.location.latitude
        longitude = response.location.longitude
        reader.close()
    except Exception:
        city = state = country = country_code = None
        latitude = longitude = None

    return {
        "ip": ip,
        "reverse_dns": reverse_dns,
        "direction": direction,
        "port": port,
        "service": service,
        "timestamp": timestamp,
        "city": city,
        "state": state,
        "country": country,
        "country_code": country_code,
        "latitude": latitude,
        "longitude": longitude,
        "trace_path": None  # to be filled later
    }

def insert_event(event):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("""
        INSERT INTO ip_events (
            ip, reverse_dns, direction, port, service, timestamp,
            city, state, country, country_code, latitude, longitude, trace_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event["ip"], event["reverse_dns"], event["direction"], event["port"],
        event["service"], event["timestamp"], event["city"], event["state"],
        event["country"], event["country_code"], event["latitude"],
        event["longitude"], event["trace_path"]
    ))
    conn.commit()
    conn.close()

def process_logs():
    for filename in os.listdir(LOG_DIR):
        filepath = os.path.join(LOG_DIR, filename)
        if not filename.endswith(".log"):
            continue
        with open(filepath, "r") as f:
            for line in f:
                parsed = parse_log_line(line)
                if parsed:
                    direction, ip, port = parsed
                    event = enrich_ip(ip, port, direction)
                    insert_event(event)
        print(f"✅ Processed {filename}")

if __name__ == "__main__":
    process_logs()
