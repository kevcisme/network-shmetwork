#!/usr/bin/env python3
"""
backhaul_inference.py - Infer mesh backhaul quality from iperf and wifi probe data

This script correlates throughput measurements with connected APs to identify
which access points have degraded backhaul connections.

Usage:
  python3 backhaul_inference.py              # Show AP backhaul quality report
  python3 backhaul_inference.py --detailed   # Include individual measurements
  python3 backhaul_inference.py --json       # Output as JSON

Run from the central collector where logs are aggregated.
"""

import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import mean, stdev
from typing import Optional

# Default log directory (central collector)
LOG_DIR = os.environ.get("NETDIAG_LOG_DIR", "/var/log/netdiag")


def find_all_hosts() -> list[str]:
    """Find all host directories in the log directory."""
    log_path = Path(LOG_DIR)
    if not log_path.exists():
        return []
    return [d.name for d in log_path.iterdir() if d.is_dir()]


def read_iperf_logs(host: Optional[str] = None) -> list[dict]:
    """Read iperf JSONL logs from all hosts or a specific host."""
    rows = []
    hosts = [host] if host else find_all_hosts()
    
    for h in hosts:
        filepath = Path(LOG_DIR) / h / "iperf.jsonl"
        if not filepath.exists():
            continue
        with open(filepath) as f:
            for line in f:
                try:
                    obj = json.loads(line.strip())
                    obj["_host"] = h
                    
                    # Extract throughput from iperf results
                    if obj.get("ok") and "iperf" in obj:
                        iperf = obj["iperf"]
                        # Get bits_per_second from end summary
                        end = iperf.get("end", {})
                        sum_recv = end.get("sum_received", {})
                        sum_sent = end.get("sum_sent", {})
                        
                        # Use received for download, sent for upload
                        if obj.get("mode") == "download":
                            obj["throughput_mbps"] = sum_recv.get("bits_per_second", 0) / 1_000_000
                        else:
                            obj["throughput_mbps"] = sum_sent.get("bits_per_second", 0) / 1_000_000
                    else:
                        obj["throughput_mbps"] = 0
                    
                    rows.append(obj)
                except json.JSONDecodeError:
                    continue
    
    rows.sort(key=lambda r: r.get("ts", ""))
    return rows


def read_wifi_logs(host: Optional[str] = None) -> list[dict]:
    """Read WiFi probe CSV logs."""
    rows = []
    hosts = [host] if host else find_all_hosts()
    
    for h in hosts:
        filepath = Path(LOG_DIR) / h / "wifi_probe.csv"
        if not filepath.exists():
            continue
        with open(filepath, newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                row["_host"] = h
                rows.append(row)
    
    rows.sort(key=lambda r: r.get("ts", ""))
    return rows


def correlate_throughput_with_ap(iperf_logs: list[dict], wifi_logs: list[dict]) -> dict:
    """
    Correlate iperf measurements with the AP that was connected at that time.
    Returns a dict of ap_name -> list of throughput measurements.
    """
    ap_throughput = defaultdict(list)
    
    # Index wifi logs by host and timestamp for efficient lookup
    wifi_by_host = defaultdict(list)
    for w in wifi_logs:
        wifi_by_host[w["_host"]].append(w)
    
    for iperf in iperf_logs:
        if not iperf.get("ok") or iperf.get("throughput_mbps", 0) == 0:
            continue
        
        host = iperf["_host"]
        ts = iperf["ts"]
        
        # Find the closest wifi probe to this iperf measurement
        host_wifi = wifi_by_host.get(host, [])
        closest_wifi = None
        min_diff = float("inf")
        
        for w in host_wifi:
            try:
                iperf_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                wifi_dt = datetime.fromisoformat(w["ts"].replace("Z", "+00:00"))
                diff = abs((iperf_dt - wifi_dt).total_seconds())
                if diff < min_diff:
                    min_diff = diff
                    closest_wifi = w
            except (ValueError, KeyError):
                continue
        
        # Only correlate if wifi measurement is within 5 minutes
        if closest_wifi and min_diff < 300:
            ap_name = closest_wifi.get("ap_name") or closest_wifi.get("bssid") or "unknown"
            signal = closest_wifi.get("signal_dbm", "")
            
            ap_throughput[ap_name].append({
                "throughput_mbps": iperf["throughput_mbps"],
                "mode": iperf.get("mode", "unknown"),
                "host": host,
                "ts": ts,
                "signal_dbm": int(signal) if signal else None
            })
    
    return ap_throughput


def analyze_backhaul_quality(ap_throughput: dict) -> list[dict]:
    """
    Analyze throughput measurements per AP to infer backhaul quality.
    Returns list of APs sorted by average throughput (worst first).
    """
    results = []
    
    for ap_name, measurements in ap_throughput.items():
        throughputs = [m["throughput_mbps"] for m in measurements]
        signals = [m["signal_dbm"] for m in measurements if m["signal_dbm"] is not None]
        hosts = set(m["host"] for m in measurements)
        
        if not throughputs:
            continue
        
        avg_throughput = mean(throughputs)
        std_throughput = stdev(throughputs) if len(throughputs) > 1 else 0
        avg_signal = mean(signals) if signals else None
        
        # Infer backhaul quality based on throughput
        # These thresholds are rough estimates - adjust based on your ISP speed
        if avg_throughput < 20:
            quality = "Poor"
        elif avg_throughput < 50:
            quality = "Fair"
        elif avg_throughput < 100:
            quality = "Good"
        else:
            quality = "Excellent"
        
        results.append({
            "ap_name": ap_name,
            "avg_throughput_mbps": avg_throughput,
            "std_throughput_mbps": std_throughput,
            "min_throughput_mbps": min(throughputs),
            "max_throughput_mbps": max(throughputs),
            "avg_signal_dbm": avg_signal,
            "sample_count": len(measurements),
            "hosts": list(hosts),
            "quality": quality,
            "measurements": measurements
        })
    
    # Sort by average throughput (worst first to highlight problems)
    results.sort(key=lambda r: r["avg_throughput_mbps"])
    
    return results


def print_report(results: list[dict], detailed: bool = False):
    """Print a human-readable backhaul quality report."""
    print("=" * 70)
    print("MESH BACKHAUL QUALITY INFERENCE REPORT")
    print("=" * 70)
    print()
    print("This report infers mesh backhaul quality by correlating iperf")
    print("throughput measurements with the AP each probe was connected to.")
    print()
    
    if not results:
        print("No data available. Ensure iperf_probe.sh and wifi_probe.sh are running")
        print("and logs have been synced to the central collector.")
        return
    
    # Summary table
    print(f"{'AP Name':<25} {'Quality':<10} {'Avg Mbps':>10} {'Samples':>8} {'Hosts'}")
    print("-" * 70)
    
    for r in results:
        hosts = ", ".join(r["hosts"])
        print(f"{r['ap_name']:<25} {r['quality']:<10} {r['avg_throughput_mbps']:>10.1f} {r['sample_count']:>8} {hosts}")
    
    print()
    
    # Highlight problematic APs
    poor_aps = [r for r in results if r["quality"] in ("Poor", "Fair")]
    if poor_aps:
        print("⚠️  POTENTIALLY DEGRADED BACKHAUL:")
        for r in poor_aps:
            print(f"   - {r['ap_name']}: avg {r['avg_throughput_mbps']:.1f} Mbps")
            if r["avg_signal_dbm"]:
                print(f"     (avg signal: {r['avg_signal_dbm']:.0f} dBm)")
        print()
    
    # Detailed measurements
    if detailed:
        print("\n" + "=" * 70)
        print("DETAILED MEASUREMENTS")
        print("=" * 70)
        
        for r in results:
            print(f"\n{r['ap_name']}:")
            print(f"  Throughput: {r['avg_throughput_mbps']:.1f} ± {r['std_throughput_mbps']:.1f} Mbps")
            print(f"  Range: {r['min_throughput_mbps']:.1f} - {r['max_throughput_mbps']:.1f} Mbps")
            if r["avg_signal_dbm"]:
                print(f"  Avg Signal: {r['avg_signal_dbm']:.0f} dBm")
            print(f"  Samples: {r['sample_count']}")
            print("  Recent measurements:")
            for m in r["measurements"][-5:]:
                print(f"    {m['ts'][:16]} | {m['host']:15} | {m['mode']:8} | {m['throughput_mbps']:.1f} Mbps")


def main():
    detailed = "--detailed" in sys.argv
    as_json = "--json" in sys.argv
    
    # Load data
    iperf_logs = read_iperf_logs()
    wifi_logs = read_wifi_logs()
    
    if not iperf_logs:
        print(f"No iperf logs found in {LOG_DIR}")
        print("Make sure iperf_probe.sh is running and logs are synced.")
        sys.exit(1)
    
    # Correlate and analyze
    ap_throughput = correlate_throughput_with_ap(iperf_logs, wifi_logs)
    results = analyze_backhaul_quality(ap_throughput)
    
    if as_json:
        # Remove measurements from JSON output unless detailed
        if not detailed:
            for r in results:
                del r["measurements"]
        print(json.dumps(results, indent=2))
    else:
        print_report(results, detailed)


if __name__ == "__main__":
    main()
