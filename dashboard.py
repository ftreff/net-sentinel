import os
import sqlite3
import subprocess
import re
import socket
import geoip2.database
from flask import Flask, jsonify, request, send_from_directory

DB_PATH = "net_sentinel.db"
GEOIP_PATH = "data/geoip/GeoLite2-City.mmdb"

ALBANY_COORDS = (42.6526, -73.7562)  # Albany, NY

IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

app = Flask(__name__)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# Root route: serve map.html
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "map.html")

@app.route("/api/events")
def get_events():
    db = get_db()
    since = request.args.get("since")
    verdict = request.args.get("verdict")

    query = "SELECT * FROM ip_events WHERE 1=1"
    params = []

    if since:
        query += " AND timestamp >= ?"
        params.append(since)
    if verdict:
        query += " AND verdict = ?"
        params.append(verdict)

    rows = db.execute(query, params).fetchall()
    return jsonify([dict(row) for row in rows])

@app.route("/api/stats")
def get_stats():
    db = get_db()
    stats = {}

    stats["drop_count"] = db.execute(
        "SELECT SUM(hit_count) FROM ip_events WHERE verdict='DROP'"
    ).fetchone()[0] or 0
    stats["accept_count"] = db.execute(
        "SELECT SUM(hit_count) FROM ip_events WHERE verdict='ACCEPT'"
    ).fetchone()[0] or 0

    stats["top_countries"] = [
        {"country": row["country"], "count": row["count"]}
        for row in db.execute("""
            SELECT country, SUM(hit_count) as count
            FROM ip_events
            WHERE country IS NOT NULL
            GROUP BY country
            ORDER BY count DESC
            LIMIT 15
        """)
    ]

    stats["top_ports"] = [
        {"port": row["port"], "count": row["count"]}
        for row in db.execute("""
            SELECT port, SUM(hit_count) as count
            FROM ip_events
            GROUP BY port
            ORDER BY count DESC
            LIMIT 15
        """)
    ]

    return jsonify(stats)

@app.route("/api/reverse_dns", methods=["POST"])
def reverse_dns():
    data = request.get_json()
    ip = data.get("ip")
    reverse_dns = None
    try:
        import socket
        reverse_dns = socket.gethostbyaddr(ip)[0]
    except Exception:
        pass

    db = get_db()
    db.execute("UPDATE ip_events SET reverse_dns=? WHERE ip=?", (reverse_dns, ip))
    db.commit()
    return jsonify({"ip": ip, "reverse_dns": reverse_dns})

@app.route("/api/trace/<ip>")
def trace(ip):
    hops = []
    reader = None
    try:
        result = subprocess.run(["traceroute", "-n", ip], capture_output=True, text=True)
        lines = result.stdout.splitlines()
        # Fallback: if traceroute without -n is preferred, remove -n above.
        if not lines or len(lines) < 2:
            return jsonify(hops)

        try:
            reader = geoip2.database.Reader(GEOIP_PATH)
        except Exception:
            reader = None

        for idx, raw in enumerate(lines[1:], start=1):
            # Extract first IPv4 on the line (handles: "8 host (1.2.3.4)" or "8 1.2.3.4")
            m = IPV4_RE.search(raw)
            hop_ip = m.group(0) if m else None

            hop_info = {
                "hop": idx,
                "ip": hop_ip,
                "reverse_dns": None,
                "lat": None,
                "lon": None,
                "city": None,
                "region": None,
                "country": None,
            }

            if hop_ip:
                # Reverse DNS (best-effort)
                try:
                    hop_info["reverse_dns"] = socket.gethostbyaddr(hop_ip)[0]
                except Exception:
                    pass

                # GeoIP (best-effort)
                if reader:
                    try:
                        resp = reader.city(hop_ip)
                        hop_info["lat"] = resp.location.latitude
                        hop_info["lon"] = resp.location.longitude
                        hop_info["city"] = resp.city.name
                        hop_info["region"] = resp.subdivisions.most_specific.name
                        hop_info["country"] = resp.country.name
                    except Exception:
                        pass

            # Force hop 1 to Albany
            if idx == 1:
                hop_info["lat"], hop_info["lon"] = ALBANY_COORDS
                hop_info["city"] = hop_info["city"] or "Albany"
                hop_info["region"] = hop_info["region"] or "New York"
                hop_info["country"] = hop_info["country"] or "United States"

            hops.append(hop_info)
    except Exception as e:
        print(f"Trace failed: {e}")
    finally:
        if reader:
            try:
                reader.close()
            except Exception:
                pass

    return jsonify(hops)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

