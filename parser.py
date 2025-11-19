import os
import re
import sqlite3
import socket
import datetime
import geoip2.database
from tqdm import tqdm

LOG_DIR = "/var/log"
DB_PATH = "net_sentinel.db"
GEOIP_PATH = "data/geoip/GeoLite2-City.mmdb"

geoip_cache = {}
dns_cache = {}

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
    if ip in dns_cache:
        return dns_cache[ip]
    try:
        result = socket.gethostbyaddr(ip)[0]
    except:
        result = None
    dns_cache[ip] = result
    return result

def guess_service(port):
    common = {
        22: "SSH", 23: "Telnet", 3389: "RDP", 5900: "VNC",
        500: "IPsec VPN", 1194: "OpenVPN", 1701: "L2TP", 1723: "PPTP", 4500: "IPsec NAT-T",
        25: "SMTP", 465: "SMTP SSL", 587: "SMTP Submission",
        110: "POP3", 995: "POP3 SSL", 143: "IMAP", 993: "IMAP SSL",
        5060: "SIP", 5061: "SIP TLS", 3478: "STUN", 5349: "TURN", 5222: "XMPP", 5223: "XMPP SSL",
        6881: "BitTorrent", 6882: "BitTorrent", 51413: "Transmission",
        27015: "Steam", 3074: "Xbox Live", 3480: "PSN",
        1935: "RTMP Streaming", 554: "RTSP", 8000: "Icecast/Streaming", 8080: "HTTP-alt", 8443: "HTTPS-alt",
        3333: "XMR Mining", 5555: "XMR Mining", 7777: "XMR Mining",
        9999: "XMR Mining", 14444: "XMR Mining", 16666: "XMR Mining",
        20: "FTP-Data", 21: "FTP", 445: "SMB/Samba",
        137: "NetBIOS Name", 138: "NetBIOS Datagram", 139: "NetBIOS Session",
        2049: "NFS", 873: "rsync", 161: "SNMP", 162: "SNMP Trap",
        53: "DNS", 80: "HTTP", 443: "HTTPS", 3306: "MySQL", 6379: "Redis"
    }
    return common.get(port, f"Unknown (port {port})")

def geoip_lookup(ip):
    if ip in geoip_cache:
        return geoip_cache[ip]
    try:
        reader = geoip2.database.Reader(GEOIP_PATH)
        response = reader.city(ip)
        result = {
            "city": response.city.name,
            "state": response.subdivisions.most_specific.name,
            "country": response.country.name,
            "country_code": response.country.iso_code,
            "latitude": response.location.latitude,
            "longitude": response.location.longitude
        }
    except:
        result = {}
    geoip_cache[ip] = result
    return result

def enrich_ip(ip, port, direction):
    info = geoip_lookup(ip)
    return {
        "ip": ip,
        "reverse_dns": reverse_dns(ip),
        "direction": direction,
        "port": port,
        "service": guess_service(port),
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "city": info.get("city"),
        "state": info.get("state"),
        "country": info.get("country"),
        "country_code": info.get("country_code"),
        "latitude": info.get("latitude"),
        "longitude": info.get("longitude"),
        "trace_path": None,
        "verdict": None
    }

def insert_events(events):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    c = conn.cursor()
    c.executemany("""
        INSERT INTO ip_events (
            ip, reverse_dns, direction, port, service, timestamp,
            city, state, country, country_code, latitude, longitude,
            trace_path, verdict
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [(
        e["ip"], e["reverse_dns"], e["direction"], e["port"], e["service"],
        e["timestamp"], e["city"], e["state"], e["country"], e["country_code"],
        e["latitude"], e["longitude"], e["trace_path"], e["verdict"]
    ) for e in events])
    conn.commit()
    conn.close()

def process_logs():
    for filename in os.listdir(LOG_DIR):
        if filename != "router.log":
            continue
        filepath = os.path.join(LOG_DIR, filename)
        with open(filepath, "r") as f:
            lines = f.readlines()

        batch = []
        inserted = 0

        for line in tqdm(lines, desc=f"Processing {filename}", unit="line"):
            parsed = parse_log_line(line)
            if parsed:
                direction, ip, port, verdict = parsed
                event = enrich_ip(ip, port, direction)
                event["verdict"] = verdict
                batch.append(event)
                if len(batch) >= 100:
                    insert_events(batch)
                    inserted += len(batch)
                    batch = []

        if batch:
            insert_events(batch)
            inserted += len(batch)

        print(f"\n✅ Finished {filename} — {inserted} new events added")

if __name__ == "__main__":
    process_logs()
