import os
import sqlite3
import subprocess
import geoip2.database
from flask import Flask, jsonify, request, send_from_directory

DB_PATH = "net_sentinel.db"
GEOIP_PATH = "data/geoip/GeoLite2-City.mmdb"

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
    try:
        result = subprocess.run(["traceroute", "-n", ip], capture_output=True, text=True)
        for line in result.stdout.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 2:
                hop_ip = parts[1]
                # geolocate hop_ip
                try:
                    reader = geoip2.database.Reader(GEOIP_PATH)
                    resp = reader.city(hop_ip)
                    if resp.location.latitude and resp.location.longitude:
                        hops.append({"lat": resp.location.latitude, "lon": resp.location.longitude})
                    reader.close()
                except Exception:
                    pass
    except Exception as e:
        print(f"Trace failed: {e}")
    return jsonify(hops)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)

