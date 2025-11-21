import os
import sqlite3
import subprocess
import socket
import requests
from flask import Flask, jsonify, request, send_from_directory

DB_PATH = "net_sentinel.db"
ALBANY_COORDS = (42.6526, -73.7562)  # Albany, NY

app = Flask(__name__, static_folder="static")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "map.html")

@app.route("/dashboard.js")
def dashboard_js():
    return send_from_directory(app.static_folder, "dashboard.js")

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
        reverse_dns = socket.gethostbyaddr(ip)[0]
    except Exception:
        pass
    db = get_db()
    db.execute("UPDATE ip_events SET reverse_dns=? WHERE ip=?", (reverse_dns, ip))
    db.commit()
    return jsonify({"ip": ip, "reverse_dns": reverse_dns})

def run_traceroute(ip):
    try:
        output = subprocess.check_output(
            ["traceroute", "-n", ip],
            stderr=subprocess.STDOUT,
            timeout=10
        )
        lines = output.decode().splitlines()[1:]  # skip header
        hops = []
        for line in lines:
            parts = line.split()
            if len(parts) < 2:
                continue
            hop_ip = None
            rtt_values = []
            for part in parts[1:]:
                if part.count('.') == 3 and not hop_ip:
                    hop_ip = part
                elif "ms" in part:
                    try:
                        rtt_values.append(float(part.replace("ms", "")))
                    except:
                        pass
            rtt = round(sum(rtt_values) / len(rtt_values), 2) if rtt_values else None
            hops.append({"ip": hop_ip, "rtt": rtt})
        return hops
    except Exception as e:
        print(f"Traceroute failed: {e}")
        return []

def enrich_hop(hop, hop_number):
    ip = hop.get("ip")
    hop["hop"] = hop_number
    hop.update({
        "reverse_dns": None,
        "latitude": None,
        "longitude": None,
        "city": None,
        "region": None,
        "country": None
    })
    if ip:
        try:
            hop["reverse_dns"] = socket.gethostbyaddr(ip)[0]
        except:
            pass
        try:
            geo = requests.get(f"http://ip-api.com/json/{ip}").json()
            if geo.get("status") == "success":
                hop["latitude"] = geo.get("lat")
                hop["longitude"] = geo.get("lon")
                hop["city"] = geo.get("city")
                hop["region"] = geo.get("regionName")
                hop["country"] = geo.get("country")
        except Exception as e:
            print(f"GeoIP failed for {ip}: {e}")
    if hop_number == 1:
        hop["latitude"], hop["longitude"] = ALBANY_COORDS
        hop["city"] = hop["city"] or "Albany"
        hop["region"] = hop["region"] or "New York"
        hop["country"] = hop["country"] or "United States"
    return hop

@app.route("/api/trace")
def api_trace():
    ip = request.args.get("ip")
    if not ip:
        return jsonify({"error": "Missing IP"}), 400
    raw_hops = run_traceroute(ip)
    enriched = [enrich_hop(hop, idx+1) for idx, hop in enumerate(raw_hops)]
    return jsonify(enriched)

if __name__ == "__main__":
    print(f"Serving static from: {os.path.abspath(app.static_folder)}")
    app.run(debug=True, host="0.0.0.0", port=5000)

