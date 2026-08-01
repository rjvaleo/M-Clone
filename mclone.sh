#!/usr/bin/env bash
#
# M-Clone control script — start/stop the dev server and open the app.
#
#   ./mclone.sh start     start the server (installs deps if needed) + open browser
#   ./mclone.sh stop      stop the server
#   ./mclone.sh restart   stop then start
#   ./mclone.sh status    show whether it's running
#
# Override the port with:  MCLONE_PORT=5200 ./mclone.sh start
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${MCLONE_PORT:-5173}"
URL="http://localhost:${PORT}/"
PIDFILE="$DIR/.mclone-dev.pid"
LOG="$DIR/.mclone-dev.log"

open_url() {
  if command -v open >/dev/null 2>&1; then open "$URL"            # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"  # Linux
  elif command -v start >/dev/null 2>&1; then start "" "$URL"     # Windows (Git Bash)
  else echo "Open this in your browser: $URL"; fi
}

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

start() {
  if is_running; then
    echo "M-Clone already running (pid $(cat "$PIDFILE")) at $URL"
    open_url
    return 0
  fi

  if [ ! -d node_modules ]; then
    echo "Installing dependencies (first run)…"
    npm install
  fi

  echo "Starting M-Clone dev server on port ${PORT}…"
  nohup npx vite --port "$PORT" --strictPort --no-open >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"

  # Wait for the server to answer (up to ~30s).
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$URL"; then
      echo "M-Clone is running at $URL (pid $(cat "$PIDFILE"))"
      open_url
      return 0
    fi
    if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Server failed to start. Recent log:"
      tail -n 20 "$LOG" || true
      rm -f "$PIDFILE"
      return 1
    fi
    sleep 0.5
  done

  echo "Timed out waiting for $URL. Recent log:"
  tail -n 20 "$LOG" || true
  return 1
}

stop() {
  local stopped=0

  if [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE")"
    if kill "$pid" 2>/dev/null; then stopped=1; fi
    pkill -P "$pid" 2>/dev/null || true
    rm -f "$PIDFILE"
  fi

  # Fallbacks: anything still holding the port, or a stray vite for this port.
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
    if [ -n "$pids" ]; then echo "$pids" | xargs kill 2>/dev/null || true; stopped=1; fi
  fi
  pkill -f "vite --port ${PORT}" 2>/dev/null || true

  if [ "$stopped" = 1 ]; then echo "M-Clone stopped."; else echo "M-Clone was not running."; fi
}

status() {
  if is_running; then
    echo "Running (pid $(cat "$PIDFILE")) at $URL"
  else
    echo "Stopped."
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  status) status ;;
  *) echo "usage: $0 {start|stop|restart|status}   (port via MCLONE_PORT)"; exit 1 ;;
esac
