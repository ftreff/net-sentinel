#!/bin/bash
# Net Sentinel ingestion orchestrator
# Location: [project-folder]/ingest.sh
# Runs scripts from ./scripts/
# Usage:
#   ./ingest.sh [foreground|background] [--preload-30] [--use-30]
#     foreground/background : run live_parser in foreground or background (default: background)
#     --preload-30          : run batch_parser against the 30-day archive to populate archive table
#     --use-30              : start live_parser reading the 30-day archive instead of the 7-day working log
#
# Notes:
#   - The live parser reads the system live log by default (/var/log/router.log).
#     That file is typically only readable by root, so this script launches the
#     live parser with sudo by default to ensure it can read the live router log.
#   - If you prefer not to use sudo, run the live parser manually with appropriate
#     permissions or set USE_30=1 / --use-30 to read the project archive instead.
#
# Examples:
#   ./ingest.sh background
#   ./ingest.sh foreground --use-30
#   ./ingest.sh background --preload-30

set -euo pipefail

PROJECT_ROOT="$(dirname "$(realpath "$0")")"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
LOG_DIR="$PROJECT_ROOT/logs"
MODE="${1:-background}"

# Parse optional flags
PRELOAD_30=false
USE_30=false

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preload-30) PRELOAD_30=true; shift ;;
    --use-30) USE_30=true; shift ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

# Ensure logs directory exists
mkdir -p "$LOG_DIR"

echo "🚀 Starting Net Sentinel ingestion pipeline..."
sleep 1

echo "[1/4] Trimming router.log (produces 7-day and 30-day files under $PROJECT_ROOT/logs)..."
if sudo python3 "$SCRIPTS_DIR/trim_router_log.py"; then
    echo "✅ Trim complete"
else
    echo "⚠️ Trim failed"
fi

# If requested, preload the 30-day archive into the DB (useful for initial population)
if [ "$PRELOAD_30" = true ]; then
  echo "[2/4] Preloading 30-day archive into DB (this may take a while)..."
  if sudo python3 "$SCRIPTS_DIR/batch_parser.py" --use-30; then
    echo "✅ 30-day preload complete"
  else
    echo "⚠️ 30-day preload failed — continuing with normal startup"
  fi
  BATCH_STEP_DONE=true
else
  BATCH_STEP_DONE=false
fi

# Run normal batch parse against the 7-day working log unless preload already did the work
if [ "$BATCH_STEP_DONE" = false ]; then
  echo "[2/4] Batch parsing 7-day working log..."
  if sudo python3 "$SCRIPTS_DIR/batch_parser.py"; then
      echo "✅ Batch parse complete"
  else
      echo "⚠️ Batch parse failed — skipping live parser"
      exit 1
  fi
fi

echo "[3/4] Launching live parser..."
# The live parser reads /var/log/router.log by default (unless --use-30 or --log-file is used).
# /var/log/router.log is typically only readable by root; we run the live parser with sudo by default.
LIVE_CMD=(sudo python3 "$SCRIPTS_DIR/live_parser.py")
if [ "$USE_30" = true ]; then
  LIVE_CMD+=(--use-30)
fi

# Inform the user about sudo usage when tailing the system log
if [ "$USE_30" = false ]; then
  echo "ℹ️ Live parser will attempt to read /var/log/router.log and is being launched with sudo to ensure access."
fi

if [ "$MODE" = "foreground" ]; then
    echo "📡 Live parser running in FOREGROUND (Ctrl+C to stop)..."
    "${LIVE_CMD[@]}"
else
    echo "📡 Live parser running in BACKGROUND..."
    nohup "${LIVE_CMD[@]}" > "$LOG_DIR/live_parser.log" 2>&1 &
    echo "✅ Live parser started (PID $!) — logs at $LOG_DIR/live_parser.log"
fi

echo "🎯 Ingestion pipeline initialized."
