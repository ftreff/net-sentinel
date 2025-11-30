#!/bin/bash
# --force-geoip option will force download of geoip db
# Install Python dependencies
echo "📦 Installing Python and sqlite3 packages..."
sudo apt install python3-pip python3-flask python3-requests python3-geoip2 python3-dnspython python3-tqdm sqlite3 -y

echo "🔧 Setting up Net Sentinel database..."

# Parse optional flags
FORCE_GEOIP=false
for arg in "$@"; do
  case "$arg" in
    --force-geoip) FORCE_GEOIP=true; shift ;;
    *) ;;
  esac
done

# Create folder
mkdir -p data/geoip

# Create or reset database
echo "🗃️ Ensuring database and schema..."
if [ ! -f net_sentinel.db ]; then
  sqlite3 net_sentinel.db < schema.sql
else
  echo "🔄 Database exists — applying schema to ensure it's up to date..."
  sqlite3 net_sentinel.db < schema.sql
fi

# Ensure WAL mode and sane synchronous setting (idempotent)
echo "🛠️ Configuring SQLite pragmas (WAL, synchronous=NORMAL)..."
sqlite3 net_sentinel.db "PRAGMA journal_mode=WAL;" >/dev/null 2>&1 || true
sqlite3 net_sentinel.db "PRAGMA synchronous=NORMAL;" >/dev/null 2>&1 || true

# Report current journal mode for visibility
CURRENT_JOURNAL=$(sqlite3 net_sentinel.db "PRAGMA journal_mode;")
echo "📘 SQLite journal_mode is: ${CURRENT_JOURNAL}"

# Download GeoLite2 if missing or if a newer release is available
GEOIP_DB="data/geoip/GeoLite2-City.mmdb"
GEOIP_META="data/geoip/GeoLite2-City.mmdb.meta"
GEOIP_URL="https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb"

echo "🌍 Checking GeoIP database..."

# Fetch remote headers (follow redirects)
headers=$(curl -sI -L "$GEOIP_URL" || true)

# Extract useful headers (case-insensitive)
remote_etag=$(printf "%s\n" "$headers" | awk 'BEGIN{IGNORECASE=1} /^etag:/{gsub(/\r/,""); print $0}' | sed -E 's/^[Ee][Tt][Aa][Gg]:[[:space:]]*//; s/"//g' | tail -n1)
remote_lastmod=$(printf "%s\n" "$headers" | awk 'BEGIN{IGNORECASE=1} /^last-modified:/{gsub(/\r/,""); $1=""; sub(/^ /,""); print $0}' | tail -n1)
remote_size=$(printf "%s\n" "$headers" | awk 'BEGIN{IGNORECASE=1} /^content-length:/{gsub(/\r/,""); print $2}' | tail -n1)

# Helper to write meta
write_meta() {
  cat > "$GEOIP_META" <<EOF
ETAG=${remote_etag}
LAST_MODIFIED=${remote_lastmod}
CONTENT_LENGTH=${remote_size}
EOF
}

# Decide whether to download
need_download=false

if [ "$FORCE_GEOIP" = true ]; then
  echo "⚡ --force-geoip specified: forcing GeoIP download/update."
  need_download=true
else
  if [ ! -f "$GEOIP_DB" ]; then
    echo "🌍 GeoIP database missing — will download."
    need_download=true
  else
    # If we have a saved meta file, compare ETag first
    if [ -f "$GEOIP_META" ] && [ -n "$remote_etag" ]; then
      saved_etag=$(awk -F= '/^ETAG=/{print substr($0,6)}' "$GEOIP_META" || true)
      if [ "$saved_etag" != "$remote_etag" ]; then
        echo "🌍 Remote ETag changed (saved: ${saved_etag:-none}, remote: ${remote_etag}) — will update."
        need_download=true
      else
        echo "🌍 ETag unchanged; skipping download."
      fi
    elif [ -n "$remote_lastmod" ]; then
      # Compare remote Last-Modified to local file mtime
      remote_epoch=$(date -d "$remote_lastmod" +%s 2>/dev/null || echo "")
      local_epoch=$(stat -c %Y "$GEOIP_DB" 2>/dev/null || echo 0)
      if [ -n "$remote_epoch" ] && [ "$remote_epoch" -gt "$local_epoch" ]; then
        echo "🌍 Remote file is newer (Last-Modified: $remote_lastmod) — will update."
        need_download=true
      else
        echo "🌍 Remote Last-Modified not newer; skipping download."
      fi
    elif [ -n "$remote_size" ]; then
      # Fallback: compare sizes
      local_size=$(stat -c %s "$GEOIP_DB" 2>/dev/null || echo 0)
      if [ "$remote_size" != "" ] && [ "$remote_size" -ne "$local_size" ]; then
        echo "🌍 Remote Content-Length differs (local: $local_size, remote: $remote_size) — will update."
        need_download=true
      else
        echo "🌍 Remote size matches local; skipping download."
      fi
    else
      echo "⚠️ Could not determine remote metadata; skipping automatic update to avoid unnecessary downloads."
    fi
  fi
fi

if [ "$need_download" = true ]; then
  tmpfile=$(mktemp "${GEOIP_DB}.tmp.XXXXXX")
  echo "⬇️ Downloading GeoLite2-City.mmdb to temporary file..."
  if curl -fL "$GEOIP_URL" -o "$tmpfile"; then
    if [ -s "$tmpfile" ]; then
      mv -f "$tmpfile" "$GEOIP_DB"
      echo "✅ GeoIP database updated at $GEOIP_DB"
      write_meta
    else
      echo "❌ Downloaded file is empty; aborting update."
      rm -f "$tmpfile"
    fi
  else
    echo "❌ Failed to download GeoIP database; leaving existing file in place."
    rm -f "$tmpfile"
  fi
else
  echo "ℹ️ No GeoIP update required."
fi

echo "✅ Setup complete."
