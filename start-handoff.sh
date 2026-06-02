#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/handoff-backend"
DASHBOARD_DIR="$ROOT_DIR/handoff-dashboard"
BACKEND_PORT="${BACKEND_PORT:-8080}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

require_cmd npm
require_cmd ngrok

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "Missing backend env file: $BACKEND_DIR/.env"
  exit 1
fi

if [ ! -f "$DASHBOARD_DIR/.env" ]; then
  echo "Missing dashboard env file: $DASHBOARD_DIR/.env"
  exit 1
fi

cleanup() {
  echo
  echo "Stopping services..."
  if [ -n "${NGROK_PID:-}" ] && kill -0 "$NGROK_PID" >/dev/null 2>&1; then
    kill "$NGROK_PID" || true
  fi
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" || true
  fi
  if [ -n "${DASHBOARD_PID:-}" ] && kill -0 "$DASHBOARD_PID" >/dev/null 2>&1; then
    kill "$DASHBOARD_PID" || true
  fi
  wait || true
}

trap cleanup EXIT INT TERM

echo "Starting backend..."
(
  cd "$BACKEND_DIR"
  npm run dev
) &
BACKEND_PID=$!

echo "Starting dashboard..."
(
  cd "$DASHBOARD_DIR"
  npm run dev
) &
DASHBOARD_PID=$!

sleep 2
echo "Starting ngrok tunnel on port $BACKEND_PORT..."
ngrok http "$BACKEND_PORT" &
NGROK_PID=$!

sleep 2
PUBLIC_URL="$(node - <<'NODE' || true
fetch('http://127.0.0.1:4040/api/tunnels')
  .then((res) => res.json())
  .then((data) => {
    const tunnel = (data.tunnels || []).find((item) => item.proto === 'https') || data.tunnels?.[0];
    if (tunnel?.public_url) console.log(tunnel.public_url);
  })
  .catch(() => {});
NODE
)"

echo
echo "System started."
echo "Backend:   http://localhost:$BACKEND_PORT"
echo "Dashboard: http://localhost:5173"
echo "Ngrok UI:  http://localhost:4040"
if [ -n "$PUBLIC_URL" ]; then
  echo
  echo "Twilio incoming webhook:"
  echo "  $PUBLIC_URL/webhooks/twilio/whatsapp"
  echo "Legacy-compatible webhook:"
  echo "  $PUBLIC_URL/webhook/whatsapp"
  echo "Twilio status callback:"
  echo "  $PUBLIC_URL/webhooks/twilio/status"
fi
echo
echo "Use Ctrl+C here to stop everything."

wait
