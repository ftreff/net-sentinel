#!/bin/bash
# Net Sentinel ingestion orchestrator
# Location: [project-folder]/ingest.sh
# Runs scripts from ./scripts/
# Usage:
#   ./ingest.sh foreground   # run live_parser in foreground
#   ./ingest.sh background   # run live_parser in background (default)

PROJECT_ROOT="$(dirname "$(realpath "$0")")"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
LOG_DIR="$PROJECT_ROOT/logs"
MODE="${1:-background}"

# Ensure logs directory exists
mkdir -p "$LOG_DIR"

echo "🚀 Starting Net Sentinel ingestion pipeline..."
sleep 1

echo "[1/3] Trimming router.log..."
if sudo python3 "$SCRIPTS_DIR/trim_router_log.py"; then
    echo "✅ Trim complete"
else
    echo "⚠️ Trim failed"
fi

echo "[2/3] Batch parsing router.log..."
if sudo python3 "$SCRIPTS_DIR/batch_parser.py"; then
    echo "✅ Batch parse complete"
else
    echo "⚠️ Batch parse failed — skipping live parser"
    exit 1
fi

echo "[3/3] Launching live parser..."
if [ "$MODE" = "foreground" ]; then
    echo "📡 Live parser running in FOREGROUND (Ctrl+C to stop)..."
    sudo python3 "$SCRIPTS_DIR/live_parser.py"
else
    echo "📡 Live parser running in BACKGROUND..."
    nohup sudo python3 "$SCRIPTS_DIR/live_parser.py" > "$LOG_DIR/live_parser.log" 2>&1 &
    echo "✅ Live parser started (PID $!) — logs at $LOG_DIR/live_parser.log"
fi

echo "🎯 Ingestion pipeline initialized."
