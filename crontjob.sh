# Network Diagnostics Cron Jobs
# Install on each probe Pi with: crontab crontjob.sh
# Or copy contents to crontab -e
#
# Prerequisites:
# 1. Copy scripts to /home/pi/netdiag/
# 2. Make scripts executable: chmod +x /home/pi/netdiag/*.sh
# 3. Copy ap_map.txt to /etc/netdiag/ap_map.txt
# 4. Set up SSH keys for log sync (see sync_logs.sh)
# 5. Create log directory: sudo mkdir -p /var/log/netdiag && sudo chown pi:pi /var/log/netdiag

# Environment variables (adjust as needed)
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
IFACE=wlan0
AP_MAP=/etc/netdiag/ap_map.txt

# === Core Probes (every minute) ===
# Network connectivity (gateway, WAN, DNS)
* * * * *  IFACE=$IFACE /home/pi/netdiag/net_probe.sh 2>/dev/null

# WiFi signal and AP tracking
* * * * *  IFACE=$IFACE AP_MAP=$AP_MAP /home/pi/netdiag/wifi_probe.sh 2>/dev/null

# Multi-target WAN health (ISP vs destination issues)
* * * * *  IFACE=$IFACE /home/pi/netdiag/wan_probe.sh 2>/dev/null

# === Failure Detection (every 5 minutes) ===
# Capture detailed snapshot on WAN failure
*/5 * * * * IFACE=$IFACE /home/pi/netdiag/on_failure_snapshot.sh 2>/dev/null

# === AP Visibility Scan (every 10 minutes) ===
# Scans all visible APs - helps detect sticky client issues
# Note: May require root; use sudo in the path if needed
*/10 * * * * IFACE=$IFACE AP_MAP=$AP_MAP /home/pi/netdiag/ap_scan.sh 2>/dev/null

# === Bandwidth Tests (every 15 minutes) ===
# NOTE: Set SERVER_IP to your iperf3 server (e.g., central Pi)
# Uncomment when you have an iperf3 server running
# */15 * * * * SERVER_IP=<iperf-server-ip> /home/pi/netdiag/iperf_probe.sh 2>/dev/null

# === Log Sync (every 5 minutes) ===
# Sync logs to central collector
# Set CENTRAL_HOST to your collector Pi IP
# */5 * * * * CENTRAL_HOST=<central-pi-ip> CENTRAL_USER=pi /home/pi/netdiag/sync_logs.sh 2>/dev/null

# === WiFi Event Watcher ===
# Note: event_watch.sh runs continuously and should be managed by systemd, not cron
# See netdiag-events.service for systemd setup
