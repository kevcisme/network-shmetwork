#!/usr/bin/env bash
# sync_logs.sh - Sync local logs to central collector via rsync
# Run this on each probe Pi to ship logs to the central server
set -euo pipefail

# Configuration (override via environment)
CENTRAL_HOST="${CENTRAL_HOST:?Set CENTRAL_HOST to the collector IP, e.g. 192.168.x.x}"
CENTRAL_USER="${CENTRAL_USER:-pi}"
CENTRAL_PATH="${CENTRAL_PATH:-/var/log/netdiag}"
LOCAL_LOG_DIR="${LOCAL_LOG_DIR:-/var/log/netdiag}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
HOST="$(hostname)"

# Ensure local log directory exists
if [[ ! -d "$LOCAL_LOG_DIR" ]]; then
  echo "No local logs found at $LOCAL_LOG_DIR - nothing to sync"
  exit 0
fi

# Create remote directory structure: /var/log/netdiag/{hostname}/
REMOTE_DIR="$CENTRAL_PATH/$HOST"

# rsync options:
#   -a: archive mode (preserves permissions, timestamps)
#   -z: compress during transfer
#   -e: specify ssh with key
#   --partial: keep partially transferred files
#   --append: append to files (good for growing log files)
#   --timeout: connection timeout
RSYNC_OPTS=(-az --partial --timeout=30)

# Add SSH key if it exists
if [[ -f "$SSH_KEY" ]]; then
  RSYNC_OPTS+=(-e "ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10")
else
  RSYNC_OPTS+=(-e "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10")
fi

# Create remote directory if needed (via ssh)
ssh_cmd="ssh"
if [[ -f "$SSH_KEY" ]]; then
  ssh_cmd="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
fi
$ssh_cmd "$CENTRAL_USER@$CENTRAL_HOST" "mkdir -p '$REMOTE_DIR'" 2>/dev/null || {
  echo "Failed to create remote directory - is $CENTRAL_HOST reachable?"
  exit 1
}

# Sync logs
echo "Syncing logs from $HOST to $CENTRAL_HOST:$REMOTE_DIR"
rsync "${RSYNC_OPTS[@]}" "$LOCAL_LOG_DIR/" "$CENTRAL_USER@$CENTRAL_HOST:$REMOTE_DIR/"

# Log sync completion
SYNC_LOG="$LOCAL_LOG_DIR/sync.log"
echo "$(date -Is) synced to $CENTRAL_HOST" >> "$SYNC_LOG"

echo "Sync complete"
