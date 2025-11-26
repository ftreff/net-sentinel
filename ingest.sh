#!/bin/bash
# Net Sentinel ingestion orchestrator
# Location: [project-folder]/ingest.sh
# Runs scripts from ./scripts/
# Usage:
#   ./ingest.sh foreground   # run live_parser in foreground
#   ./ingest.sh background   # run live_parser in background (default)

PROJECT_ROOT="$(dirname "$(realpath "$0")")"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
MODE="${1:-background}"

echo "🚀 Starting Net Sentinel ingestion pipeline..."
sleep 1

echo "[1/3] Trimming router.log..."
sudo python3 "$SCRIPTS_DIR/trim_router_log.py" && echo "✅ Trim complete" || echo "⚠️ Trim failed"

echo "[2/3] Batch parsing router.log..."
sudo python3 "$SCRIPTS_DIR/batch_parser.py" && echo "✅ Batch parse complete" || echo "⚠️ Batch parse failed"

echo "[3/3] Launching live parser..."
if [ "$MODE" = "foreground" ]; then
    echo "📡 Live parser running in FOREGROUND (Ctrl+C to stop)..."
    sudo python3 "$SCRIPTS_DIR/live_parser.py"
else
    echo "📡 Live parser running in BACKGROUND..."
    nohup sudo python3 "$SCRIPTS_DIR/live_parser.py" > "$PROJECT_ROOT/live_parser.log" 2>&1 &
    echo "✅ Live parser started (PID $!) — logs at $PROJECT_ROOT/live_parser.log"
fi

echo "🎯 Ingestion pipeline initialized."
