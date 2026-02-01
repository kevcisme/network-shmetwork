#!/usr/bin/env python3
"""
analyze.py - Query and analyze centralized network diagnostic logs

Usage:
  python3 analyze.py summary          # Overall health summary
  python3 analyze.py failures         # List all detected failures
  python3 analyze.py compare          # Compare metrics across Pis/locations
  python3 analyze.py timeline         # Show timeline of issues
  python3 analyze.py ap-stats         # AP connection statistics
  python3 analyze.py roaming          # Analyze roaming events and patterns
  python3 analyze.py visibility       # Show AP visibility from each location

Run from the central collector where logs are aggregated.
"""

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

# Default log directory (central collector)
LOG_DIR = os.environ.get("NETDIAG_LOG_DIR", "/var/log/netdiag")


def find_all_hosts() -> list[str]:
    """Find all host directories in the log directory."""
    log_path = Path(LOG_DIR)
    if not log_path.exists():
        return []
    return [d.name for d in log_path.iterdir() if d.is_dir()]


def read_csv_logs(filename: str, host: Optional[str] = None) -> list[dict]:
    """Read CSV logs from all hosts or a specific host."""
    rows = []
    hosts = [host] if host else find_all_hosts()
    
    for h in hosts:
        filepath = Path(LOG_DIR) / h / filename
        if not filepath.exists():
            continue
        with open(filepath, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row["_host"] = h
                rows.append(row)
    
    # Sort by timestamp
    rows.sort(key=lambda r: r.get("ts", ""))
    return rows


def read_jsonl_logs(filename: str, host: Optional[str] = None) -> list[dict]:
    """Read JSONL logs from all hosts or a specific host."""
    rows = []
    hosts = [host] if host else find_all_hosts()
    
    for h in hosts:
        filepath = Path(LOG_DIR) / h / filename
        if not filepath.exists():
            continue
        with open(filepath) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    obj["_host"] = h
                    rows.append(obj)
                except json.JSONDecodeError:
                    continue
    
    rows.sort(key=lambda r: r.get("ts", ""))
    return rows


def cmd_summary():
    """Show overall health summary across all Pis."""
    hosts = find_all_hosts()
    if not hosts:
        print(f"No logs found in {LOG_DIR}")
        print("Ensure probe Pis have synced their logs to this collector.")
        return
    
    print(f"=== Network Diagnostics Summary ===")
    print(f"Log directory: {LOG_DIR}")
    print(f"Hosts found: {', '.join(hosts)}\n")
    
    # Net probe summary
    net_logs = read_csv_logs("net_probe.csv")
    if net_logs:
        total = len(net_logs)
        wan_failures = sum(1 for r in net_logs if float(r.get("wan_loss_pct", 0) or 0) == 100)
        gw_failures = sum(1 for r in net_logs if float(r.get("gw_loss_pct", 0) or 0) == 100)
        dns_failures = sum(1 for r in net_logs if r.get("dns_ok") == "0")
        
        print(f"Network Probes: {total} total")
        print(f"  Gateway failures:  {gw_failures} ({100*gw_failures/total:.1f}%)")
        print(f"  WAN failures:      {wan_failures} ({100*wan_failures/total:.1f}%)")
        print(f"  DNS failures:      {dns_failures} ({100*dns_failures/total:.1f}%)")
        print()
    
    # WiFi probe summary
    wifi_logs = read_csv_logs("wifi_probe.csv")
    if wifi_logs:
        print(f"WiFi Probes: {len(wifi_logs)} total")
        
        # Signal strength stats per host
        for h in hosts:
            host_logs = [r for r in wifi_logs if r["_host"] == h]
            if not host_logs:
                continue
            signals = [int(r["signal_dbm"]) for r in host_logs if r.get("signal_dbm")]
            if signals:
                avg_signal = sum(signals) / len(signals)
                min_signal = min(signals)
                print(f"  {h}: avg signal {avg_signal:.0f} dBm, worst {min_signal} dBm")
        print()
    
    # WAN probe summary
    wan_logs = read_csv_logs("wan_probe.csv")
    if wan_logs:
        total = len(wan_logs)
        all_down = sum(1 for r in wan_logs if r.get("all_down") == "1")
        print(f"WAN Probes: {total} total")
        print(f"  Complete outages: {all_down} ({100*all_down/total:.1f}%)")
        print()


def cmd_failures():
    """List all detected failures with timestamps."""
    print("=== Detected Failures ===\n")
    
    failures = []
    
    # Net probe failures
    for row in read_csv_logs("net_probe.csv"):
        wan_loss = float(row.get("wan_loss_pct", 0) or 0)
        gw_loss = float(row.get("gw_loss_pct", 0) or 0)
        dns_ok = row.get("dns_ok", "1")
        
        if wan_loss == 100 or gw_loss == 100 or dns_ok == "0":
            failure_type = []
            if gw_loss == 100:
                failure_type.append("gateway")
            if wan_loss == 100:
                failure_type.append("WAN")
            if dns_ok == "0":
                failure_type.append("DNS")
            
            failures.append({
                "ts": row["ts"],
                "host": row["_host"],
                "type": ", ".join(failure_type),
                "source": "net_probe"
            })
    
    # WAN probe failures
    for row in read_csv_logs("wan_probe.csv"):
        if row.get("all_down") == "1":
            failures.append({
                "ts": row["ts"],
                "host": row["_host"],
                "type": "complete WAN outage",
                "source": "wan_probe"
            })
    
    # Sort by time
    failures.sort(key=lambda f: f["ts"])
    
    if not failures:
        print("No failures detected in logs.")
        return
    
    print(f"Found {len(failures)} failure events:\n")
    for f in failures[-50:]:  # Show last 50
        print(f"{f['ts']}  {f['host']:15}  {f['type']}")
    
    if len(failures) > 50:
        print(f"\n... and {len(failures) - 50} earlier failures")


def cmd_compare():
    """Compare metrics across different Pis/locations."""
    print("=== Location Comparison ===\n")
    
    hosts = find_all_hosts()
    if not hosts:
        print("No hosts found.")
        return
    
    wifi_logs = read_csv_logs("wifi_probe.csv")
    net_logs = read_csv_logs("net_probe.csv")
    
    for h in hosts:
        print(f"--- {h} ---")
        
        # WiFi stats
        host_wifi = [r for r in wifi_logs if r["_host"] == h]
        if host_wifi:
            signals = [int(r["signal_dbm"]) for r in host_wifi if r.get("signal_dbm")]
            retries = [int(r["tx_retries"]) for r in host_wifi if r.get("tx_retries")]
            ap_names = [r.get("ap_name", "unknown") for r in host_wifi if r.get("ap_name")]
            
            if signals:
                print(f"  Signal: avg {sum(signals)/len(signals):.0f} dBm, range [{min(signals)}, {max(signals)}]")
            if retries:
                print(f"  TX Retries: avg {sum(retries)/len(retries):.0f}")
            if ap_names:
                ap_counts = defaultdict(int)
                for ap in ap_names:
                    ap_counts[ap] += 1
                print(f"  Connected APs: {dict(ap_counts)}")
        
        # Network stats
        host_net = [r for r in net_logs if r["_host"] == h]
        if host_net:
            wan_losses = [float(r["wan_loss_pct"]) for r in host_net if r.get("wan_loss_pct")]
            gw_rtts = [float(r["gw_avg_ms"]) for r in host_net if r.get("gw_avg_ms")]
            
            if wan_losses:
                print(f"  WAN Loss: avg {sum(wan_losses)/len(wan_losses):.1f}%")
            if gw_rtts:
                print(f"  Gateway RTT: avg {sum(gw_rtts)/len(gw_rtts):.1f} ms")
        
        print()


def cmd_timeline():
    """Show timeline of issues over last 24 hours."""
    print("=== Issue Timeline (Last 24h) ===\n")
    
    cutoff = datetime.now() - timedelta(hours=24)
    cutoff_str = cutoff.isoformat()
    
    events = []
    
    # Collect significant events
    for row in read_csv_logs("net_probe.csv"):
        if row["ts"] < cutoff_str:
            continue
        wan_loss = float(row.get("wan_loss_pct", 0) or 0)
        if wan_loss > 50:
            events.append((row["ts"], row["_host"], f"High WAN loss: {wan_loss:.0f}%"))
    
    for row in read_csv_logs("wifi_probe.csv"):
        if row["ts"] < cutoff_str:
            continue
        signal = int(row.get("signal_dbm") or -100)
        if signal < -75:
            ap = row.get("ap_name", row.get("bssid", "unknown"))
            events.append((row["ts"], row["_host"], f"Weak signal: {signal} dBm on {ap}"))
    
    # Sort and display
    events.sort()
    
    if not events:
        print("No significant issues in the last 24 hours.")
        return
    
    for ts, host, desc in events[-30:]:
        # Format timestamp more readably
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            ts_fmt = dt.strftime("%m-%d %H:%M")
        except:
            ts_fmt = ts[:16]
        print(f"{ts_fmt}  {host:15}  {desc}")


def cmd_ap_stats():
    """Show AP connection statistics and roaming patterns."""
    print("=== AP Statistics ===\n")
    
    wifi_logs = read_csv_logs("wifi_probe.csv")
    if not wifi_logs:
        print("No WiFi probe logs found.")
        return
    
    # Group by AP
    ap_stats = defaultdict(lambda: {"count": 0, "signals": [], "hosts": set()})
    
    for row in wifi_logs:
        ap = row.get("ap_name") or row.get("bssid") or "unknown"
        signal = row.get("signal_dbm")
        
        ap_stats[ap]["count"] += 1
        ap_stats[ap]["hosts"].add(row["_host"])
        if signal:
            ap_stats[ap]["signals"].append(int(signal))
    
    print(f"{'AP Name':<25} {'Samples':>8} {'Avg Signal':>12} {'Hosts'}")
    print("-" * 65)
    
    for ap, stats in sorted(ap_stats.items(), key=lambda x: -x[1]["count"]):
        avg_signal = ""
        if stats["signals"]:
            avg_signal = f"{sum(stats['signals'])/len(stats['signals']):.0f} dBm"
        hosts = ", ".join(stats["hosts"])
        print(f"{ap:<25} {stats['count']:>8} {avg_signal:>12} {hosts}")


def cmd_roaming():
    """Analyze roaming events and detect problematic patterns."""
    print("=== Roaming Analysis ===\n")
    
    # Read structured event logs
    events = read_jsonl_logs("wifi_events.jsonl")
    if not events:
        print("No WiFi event logs found.")
        print("Ensure event_watch.sh is running (via systemd) and logs are synced.")
        return
    
    hosts = find_all_hosts()
    
    # Analyze per host
    for h in hosts:
        host_events = [e for e in events if e.get("_host") == h]
        if not host_events:
            continue
        
        print(f"--- {h} ---")
        
        # Count event types
        event_counts = defaultdict(int)
        roams = []
        disconnects = []
        
        for e in host_events:
            event_type = e.get("event", "unknown")
            event_counts[event_type] += 1
            
            if event_type == "roam":
                roams.append(e)
            elif event_type == "disconnect":
                disconnects.append(e)
        
        print(f"  Total events: {len(host_events)}")
        print(f"  Event breakdown: {dict(event_counts)}")
        
        # Roaming analysis
        if roams:
            print(f"\n  Roaming events: {len(roams)}")
            
            # Count roam paths (from -> to)
            roam_paths = defaultdict(int)
            for r in roams:
                from_ap = r.get("from_ap", r.get("from_bssid", "?"))
                to_ap = r.get("to_ap", r.get("to_bssid", "?"))
                roam_paths[f"{from_ap} -> {to_ap}"] += 1
            
            print("  Roaming patterns:")
            for path, count in sorted(roam_paths.items(), key=lambda x: -x[1])[:5]:
                print(f"    {path}: {count}x")
        
        # Disconnect analysis
        if disconnects:
            print(f"\n  Disconnects: {len(disconnects)}")
            
            # Disconnects by AP
            dc_by_ap = defaultdict(int)
            reason_codes = defaultdict(int)
            for d in disconnects:
                ap = d.get("ap_name", d.get("bssid", "unknown"))
                dc_by_ap[ap] += 1
                if "reason_code" in d:
                    reason_codes[d["reason_code"]] += 1
            
            if dc_by_ap:
                print("  Disconnects by AP:")
                for ap, count in sorted(dc_by_ap.items(), key=lambda x: -x[1])[:5]:
                    print(f"    {ap}: {count}x")
            
            if reason_codes:
                print("  Disconnect reason codes:")
                for code, count in sorted(reason_codes.items(), key=lambda x: -x[1]):
                    # Common reason codes: 3=deauth leaving, 4=inactivity, 7=class3 frame
                    reason_desc = {
                        "1": "unspecified",
                        "2": "prev auth invalid",
                        "3": "leaving BSS",
                        "4": "inactivity",
                        "6": "class2 frame from non-auth",
                        "7": "class3 frame from non-assoc",
                        "8": "disassoc leaving",
                    }.get(str(code), "")
                    print(f"    Code {code} ({reason_desc}): {count}x")
        
        # Calculate stability score
        if host_events:
            hours = 24  # Assume 24 hours of data
            disconnects_per_hour = len(disconnects) / hours if disconnects else 0
            roams_per_hour = len(roams) / hours if roams else 0
            
            if disconnects_per_hour < 0.5 and roams_per_hour < 1:
                stability = "Stable"
            elif disconnects_per_hour < 2 and roams_per_hour < 5:
                stability = "Moderate"
            else:
                stability = "Unstable (possible sticky client issue)"
            
            print(f"\n  Stability: {stability}")
            print(f"  ({disconnects_per_hour:.1f} disconnects/hr, {roams_per_hour:.1f} roams/hr)")
        
        print()


def cmd_visibility():
    """Show AP visibility from each probe location."""
    print("=== AP Visibility by Location ===\n")
    print("Shows which APs are visible from each probe Pi location,")
    print("helping identify potential roaming targets and coverage gaps.\n")
    
    # Read AP scan logs
    scan_logs = read_csv_logs("ap_scan.csv")
    if not scan_logs:
        print("No AP scan logs found.")
        print("Ensure ap_scan.sh is running and logs are synced.")
        return
    
    hosts = find_all_hosts()
    
    for h in hosts:
        host_scans = [s for s in scan_logs if s.get("_host") == h]
        if not host_scans:
            continue
        
        print(f"--- {h} ---")
        
        # Get most recent scan for each AP
        ap_visibility = {}
        for s in host_scans:
            ap = s.get("ap_name") or s.get("bssid") or "unknown"
            signal = s.get("signal_dbm", "")
            is_connected = s.get("is_connected") == "1"
            ssid = s.get("ssid", "")
            freq = s.get("frequency_mhz", "")
            
            # Keep strongest signal seen for each AP
            if ap not in ap_visibility or (signal and int(signal) > int(ap_visibility[ap].get("signal", -100) or -100)):
                ap_visibility[ap] = {
                    "signal": signal,
                    "connected": is_connected,
                    "ssid": ssid,
                    "freq": freq
                }
        
        # Sort by signal strength
        sorted_aps = sorted(
            ap_visibility.items(),
            key=lambda x: int(x[1].get("signal") or -100),
            reverse=True
        )
        
        print(f"  {'AP Name':<25} {'Signal':>10} {'Band':>8} {'Status'}")
        print("  " + "-" * 55)
        
        for ap, info in sorted_aps[:10]:
            signal = info.get("signal", "")
            freq = info.get("freq", "")
            band = "5GHz" if freq and int(freq) > 3000 else "2.4GHz" if freq else ""
            status = "* CONNECTED" if info.get("connected") else ""
            
            # Color code signal strength
            if signal:
                sig_int = int(signal)
                if sig_int >= -50:
                    quality = "(excellent)"
                elif sig_int >= -60:
                    quality = "(good)"
                elif sig_int >= -70:
                    quality = "(fair)"
                else:
                    quality = "(weak)"
                signal = f"{signal} {quality}"
            
            print(f"  {ap:<25} {signal:>18} {band:>8} {status}")
        
        # Identify potential better APs
        connected_ap = next((ap for ap, info in sorted_aps if info.get("connected")), None)
        if connected_ap:
            connected_signal = int(ap_visibility[connected_ap].get("signal") or -100)
            better_aps = [(ap, info) for ap, info in sorted_aps 
                         if not info.get("connected") and int(info.get("signal") or -100) > connected_signal + 5]
            
            if better_aps:
                print(f"\n  Note: {len(better_aps)} AP(s) have stronger signal than current connection!")
                print("  This may indicate sticky client behavior.")
        
        print()


def main():
    commands = {
        "summary": cmd_summary,
        "failures": cmd_failures,
        "compare": cmd_compare,
        "timeline": cmd_timeline,
        "ap-stats": cmd_ap_stats,
        "roaming": cmd_roaming,
        "visibility": cmd_visibility,
    }
    
    if len(sys.argv) < 2 or sys.argv[1] not in commands:
        print(__doc__)
        print("Available commands:")
        for cmd in commands:
            print(f"  {cmd}")
        sys.exit(1)
    
    commands[sys.argv[1]]()


if __name__ == "__main__":
    main()
