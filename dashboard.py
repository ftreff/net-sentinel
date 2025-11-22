import os
import sqlite3
import socket
from flask import Flask, jsonify, request, send_from_directory, g

app = Flask(__name__)
DB_PATH = "net_sentinel.db"

def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()

@app.route("/")
def root():
    return send_from_directory("static", "map.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

@app.route("/api/events")
def get_events():
    db = get_db()
    since = request.args.get("since")
    verdict = request.args.get("verdict")
    proto = request.args.get("proto")
    src_ip = request.args.get("src_ip")
    dst_ip = request.args.get("dst_ip")
    in_if = request.args.get("in_if")
    out_if = request.args.get("out_if")

    query = "SELECT * FROM ip_events WHERE 1=1"
    params = []

    if since:
        query += " AND timestamp >= ?"
        params.append(since)
    if verdict:
        query += " AND verdict = ?"
        params.append(verdict)
    if proto:
        query += " AND proto = ?"
        params.append(proto)
    if src_ip:
        query += " AND src_ip = ?"
        params.append(src_ip)
    if dst_ip:
        query += " AND dst_ip = ?"
        params.append(dst_ip)
    if in_if:
        query += " AND in_if = ?"
        params.append(in_if)
    if out_if:
        query += " AND out_if = ?"
        params.append(out_if)

    rows = db.execute(query, params).fetchall()

    # Convert rows to dicts for JSON
    events = []
    for row in rows:
        events.append({
            "src_ip": row["src_ip"],
            "src_rdns": row["src_rdns"],
            "src_port": row["src_port"],
            "src_service": row["src_service"],
            "dst_ip": row["dst_ip"],
            "dst_rdns": row["dst_rdns"],
            "dst_port": row["dst_port"],
            "dst_service": row["dst_service"],
            "proto": row["proto"],
            "in_if": row["in_if"],
            "out_if": row["out_if"],
            "verdict": row["verdict"],
            "direction": row["direction"],
            "timestamp": row["timestamp"],
            "hit_count": row["hit_count"],
            "city": row["city"],
            "state": row["state"],
            "country": row["country"],
            "country_code": row["country_code"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "trace_path": row["trace_path"]
        })

    return jsonify(events)

@app.route("/api/reverse_dns", methods=["POST"])
def refresh_reverse_dns():
    data = request.get_json(silent=True) or {}
    ip = data.get("ip") or request.form.get("ip") or request.args.get("ip")
    if not ip:
        return jsonify({"error": "Missing IP"}), 400

    try:
        rdns = socket.gethostbyaddr(ip)[0]
        get_db().execute("UPDATE ip_events SET reverse_dns=? WHERE ip=?", (rdns, ip))
        get_db().commit()
        return jsonify({"reverse_dns": rdns})
    except Exception as e:
        app.logger.warning(f"Reverse DNS failed for {ip}: {e}")
        return jsonify({"reverse_dns": None})

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
            LIMIT 20
        """)
    ]

    stats["top_ports"] = [
        {"port": row["port"], "count": row["count"]}
        for row in db.execute("""
            SELECT dst_port as port, SUM(hit_count) as count
            FROM ip_events
            WHERE dst_port IS NOT NULL
            GROUP BY dst_port
            ORDER BY count DESC
            LIMIT 20
        """)
    ]

    return jsonify(stats)

@app.route("/services.json")
def services_file():
    return send_from_directory("data", "services.json")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
