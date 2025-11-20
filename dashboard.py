import os
import sqlite3
import socket
from flask import Flask, jsonify, request, send_from_directory

app = Flask(__name__)
DB_PATH = "net_sentinel.db"

# Global DB connection
conn = sqlite3.connect(DB_PATH, check_same_thread=False)
conn.row_factory = sqlite3.Row

@app.route("/")
def root():
    return send_from_directory("static", "map.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

@app.route("/api/events")
def get_events():
    since = request.args.get("since")
    query = "SELECT * FROM ip_events"
    params = []

    if since:
        query += " WHERE timestamp >= ?"
        params.append(since)

    rows = conn.execute(query, params).fetchall()
    return jsonify([dict(row) for row in rows])

@app.route("/api/reverse_dns", methods=["POST"])
def refresh_reverse_dns():
    ip = request.args.get("ip")
    if not ip:
        return jsonify({"error": "Missing IP"}), 400

    try:
        rdns = socket.gethostbyaddr(ip)[0]
        conn.execute("UPDATE ip_events SET reverse_dns=? WHERE ip=?", (rdns, ip))
        conn.commit()
        return jsonify({"reverse_dns": rdns})
    except Exception as e:
        print(f"⚠️ Reverse DNS failed for {ip}: {e}")
        return jsonify({"reverse_dns": None})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
