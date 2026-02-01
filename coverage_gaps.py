#!/usr/bin/env python3
"""
coverage_gaps.py - Detect WiFi coverage gaps and dead zones

Analyzes AP visibility and signal strength data from probe locations
to identify areas with poor coverage and suggest improvements.

Usage:
  python3 coverage_gaps.py              # Full coverage analysis
  python3 coverage_gaps.py --summary    # Quick summary only
  python3 coverage_gaps.py --json       # Output as JSON

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

# Signal strength thresholds (dBm)
EXCELLENT_SIGNAL = -50
GOOD_SIGNAL = -60
FAIR_SIGNAL = -70
WEAK_SIGNAL = -75
DEAD_ZONE_THRESHOLD = -80


def find_all_hosts() -> list[str]:
    """Find all host directories in the log directory."""
    log_path = Path(LOG_DIR)
    if not log_path.exists():
        return []
    # Exclude common non-host directories
    exclude = {"failures", "snapshots", "archive"}
    return [d.name for d in log_path.iterdir() if d.is_dir() and d.name not in exclude]


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
    
    rows.sort(key=lambda r: r.get("ts", ""))
    return rows


def calculate_coverage_score(signals: list[int]) -> dict:
    """
    Calculate a coverage score (0-100) based on signal measurements.
    
    Returns dict with score and breakdown.
    """
    if not signals:
        return {"score": 0, "rating": "No Data", "breakdown": {}}
    
    avg_signal = mean(signals)
    min_signal = min(signals)
    
    # Count samples in each category
    excellent = sum(1 for s in signals if s >= EXCELLENT_SIGNAL)
    good = sum(1 for s in signals if GOOD_SIGNAL <= s < EXCELLENT_SIGNAL)
    fair = sum(1 for s in signals if FAIR_SIGNAL <= s < GOOD_SIGNAL)
    weak = sum(1 for s in signals if WEAK_SIGNAL <= s < FAIR_SIGNAL)
    dead = sum(1 for s in signals if s < WEAK_SIGNAL)
    
    total = len(signals)
    
    # Calculate weighted score
    score = (
        (excellent / total * 100) +
        (good / total * 80) +
        (fair / total * 60) +
        (weak / total * 30) +
        (dead / total * 0)
    )
    
    # Penalize for dead zone occurrences
    dead_zone_pct = dead / total * 100
    if dead_zone_pct > 0:
        score -= dead_zone_pct  # Direct penalty for dead zones
    
    score = max(0, min(100, score))
    
    # Determine rating
    if score >= 90:
        rating = "Excellent"
    elif score >= 75:
        rating = "Good"
    elif score >= 50:
        rating = "Fair"
    elif score >= 25:
        rating = "Poor"
    else:
        rating = "Critical"
    
    return {
        "score": round(score, 1),
        "rating": rating,
        "avg_signal": round(avg_signal, 1),
        "min_signal": min_signal,
        "breakdown": {
            "excellent": excellent,
            "good": good,
            "fair": fair,
            "weak": weak,
            "dead_zone": dead
        }
    }


def analyze_coverage_gaps() -> dict:
    """
    Analyze coverage data across all probes to find gaps.
    
    Returns comprehensive coverage analysis.
    """
    hosts = find_all_hosts()
    if not hosts:
        return {"error": f"No hosts found in {LOG_DIR}"}
    
    # Read WiFi probe data
    wifi_logs = read_csv_logs("wifi_probe.csv")
    ap_scans = read_csv_logs("ap_scan.csv")
    
    results = {
        "hosts": {},
        "overall_score": 0,
        "dead_zones": [],
        "weak_areas": [],
        "coverage_recommendations": [],
        "ap_coverage": {},
    }
    
    host_scores = []
    all_dead_zone_events = []
    
    for h in hosts:
        host_wifi = [w for w in wifi_logs if w.get("_host") == h]
        host_scans = [s for s in ap_scans if s.get("_host") == h]
        
        if not host_wifi:
            continue
        
        # Extract signal measurements
        signals = [int(w["signal_dbm"]) for w in host_wifi if w.get("signal_dbm")]
        
        if not signals:
            continue
        
        # Calculate coverage score for this location
        coverage = calculate_coverage_score(signals)
        
        # Track SNR if available
        snr_values = [int(w["snr_db"]) for w in host_wifi if w.get("snr_db")]
        if snr_values:
            coverage["avg_snr"] = round(mean(snr_values), 1)
            coverage["min_snr"] = min(snr_values)
        
        # Band usage analysis
        bands = [w.get("band") for w in host_wifi if w.get("band")]
        if bands:
            band_counts = defaultdict(int)
            for b in bands:
                band_counts[b] += 1
            coverage["band_usage"] = dict(band_counts)
        
        # Identify dead zone events
        dead_events = []
        for w in host_wifi:
            signal = int(w.get("signal_dbm") or -100)
            if signal < DEAD_ZONE_THRESHOLD:
                dead_events.append({
                    "ts": w.get("ts"),
                    "signal": signal,
                    "ap": w.get("ap_name") or w.get("bssid"),
                    "band": w.get("band", "")
                })
                all_dead_zone_events.append({
                    "host": h,
                    "ts": w.get("ts"),
                    "signal": signal
                })
        
        coverage["dead_zone_events"] = len(dead_events)
        
        # AP visibility from this location
        if host_scans:
            visible_aps = defaultdict(list)
            for s in host_scans:
                ap = s.get("ap_name") or s.get("bssid")
                signal = int(s.get("signal_dbm") or -100)
                if ap:
                    visible_aps[ap].append(signal)
            
            ap_summary = {}
            for ap, sigs in visible_aps.items():
                ap_summary[ap] = {
                    "avg_signal": round(mean(sigs), 1),
                    "max_signal": max(sigs),
                    "min_signal": min(sigs)
                }
            coverage["visible_aps"] = ap_summary
            
            # Identify best potential AP for this location
            best_ap = max(ap_summary.items(), key=lambda x: x[1]["avg_signal"]) if ap_summary else None
            if best_ap:
                coverage["best_ap"] = {"name": best_ap[0], **best_ap[1]}
        
        results["hosts"][h] = coverage
        host_scores.append(coverage["score"])
    
    # Calculate overall score
    if host_scores:
        results["overall_score"] = round(mean(host_scores), 1)
    
    # Identify problematic areas
    for h, data in results["hosts"].items():
        if data["score"] < 25:
            results["dead_zones"].append({
                "host": h,
                "score": data["score"],
                "avg_signal": data["avg_signal"],
                "dead_zone_events": data.get("dead_zone_events", 0)
            })
        elif data["score"] < 50:
            results["weak_areas"].append({
                "host": h,
                "score": data["score"],
                "avg_signal": data["avg_signal"]
            })
    
    # Generate recommendations
    recommendations = []
    
    # Dead zone recommendations
    if results["dead_zones"]:
        dead_hosts = [d["host"] for d in results["dead_zones"]]
        recommendations.append({
            "priority": "high",
            "issue": f"Dead zones detected at: {', '.join(dead_hosts)}",
            "suggestion": "Consider adding a mesh node between these locations and the nearest AP."
        })
    
    # Weak coverage recommendations
    if results["weak_areas"]:
        weak_hosts = [w["host"] for w in results["weak_areas"]]
        recommendations.append({
            "priority": "medium",
            "issue": f"Weak coverage at: {', '.join(weak_hosts)}",
            "suggestion": "Reposition existing APs or adjust transmit power settings."
        })
    
    # Band usage recommendations
    for h, data in results["hosts"].items():
        band_usage = data.get("band_usage", {})
        if band_usage:
            total = sum(band_usage.values())
            pct_24 = band_usage.get("2.4GHz", 0) / total * 100 if total else 0
            if pct_24 > 60 and data["score"] < 70:
                recommendations.append({
                    "priority": "medium",
                    "issue": f"{h} is on 2.4GHz {pct_24:.0f}% of the time",
                    "suggestion": "Check 5GHz coverage or enable band steering on your mesh."
                })
    
    # SNR-based recommendations
    for h, data in results["hosts"].items():
        if "min_snr" in data and data["min_snr"] < 15:
            recommendations.append({
                "priority": "medium",
                "issue": f"{h} has low SNR (minimum {data['min_snr']} dB)",
                "suggestion": "High interference detected. Check for conflicting WiFi networks or reduce 2.4GHz usage."
            })
    
    results["coverage_recommendations"] = recommendations
    
    return results


def print_report(results: dict):
    """Print human-readable coverage report."""
    print("=" * 70)
    print("WIFI COVERAGE GAP ANALYSIS")
    print("=" * 70)
    print()
    
    if "error" in results:
        print(f"Error: {results['error']}")
        return
    
    # Overall summary
    overall = results["overall_score"]
    if overall >= 75:
        status = "✅ Good"
    elif overall >= 50:
        status = "⚠️  Fair"
    else:
        status = "❌ Poor"
    
    print(f"Overall Coverage Score: {overall}/100 ({status})")
    print()
    
    # Per-location breakdown
    print("Coverage by Location:")
    print("-" * 70)
    print(f"{'Location':<20} {'Score':>8} {'Rating':<12} {'Avg Signal':>12} {'Dead Zones':>10}")
    print("-" * 70)
    
    for host, data in sorted(results["hosts"].items(), key=lambda x: x[1]["score"]):
        score = data["score"]
        rating = data["rating"]
        avg_sig = data.get("avg_signal", "N/A")
        dead = data.get("dead_zone_events", 0)
        
        # Color-code based on score
        if score >= 75:
            indicator = "✓"
        elif score >= 50:
            indicator = "!"
        else:
            indicator = "✗"
        
        print(f"{indicator} {host:<18} {score:>7.1f} {rating:<12} {avg_sig:>10.0f} dBm {dead:>10}")
    
    print()
    
    # Dead zones
    if results["dead_zones"]:
        print("🚨 DEAD ZONES DETECTED:")
        for dz in results["dead_zones"]:
            print(f"   - {dz['host']}: Score {dz['score']}, avg signal {dz['avg_signal']:.0f} dBm")
        print()
    
    # Weak areas
    if results["weak_areas"]:
        print("⚠️  WEAK COVERAGE AREAS:")
        for wa in results["weak_areas"]:
            print(f"   - {wa['host']}: Score {wa['score']}, avg signal {wa['avg_signal']:.0f} dBm")
        print()
    
    # Recommendations
    if results["coverage_recommendations"]:
        print("📋 RECOMMENDATIONS:")
        for rec in results["coverage_recommendations"]:
            priority = rec["priority"].upper()
            print(f"\n   [{priority}] {rec['issue']}")
            print(f"   → {rec['suggestion']}")
        print()
    
    # Band usage summary
    print("\nBand Usage by Location:")
    for host, data in results["hosts"].items():
        band = data.get("band_usage", {})
        if band:
            total = sum(band.values())
            parts = [f"{b}: {c/total*100:.0f}%" for b, c in band.items()]
            print(f"   {host}: {', '.join(parts)}")
    
    # Visible APs summary
    print("\nAP Visibility Summary:")
    all_aps = set()
    for host, data in results["hosts"].items():
        visible = data.get("visible_aps", {})
        all_aps.update(visible.keys())
    
    if all_aps:
        print(f"   Total APs visible across network: {len(all_aps)}")
        
        # Find APs with best/worst coverage
        ap_coverage = defaultdict(list)
        for host, data in results["hosts"].items():
            visible = data.get("visible_aps", {})
            for ap, stats in visible.items():
                ap_coverage[ap].append(stats["avg_signal"])
        
        if ap_coverage:
            print("\n   AP Signal Strength (avg across locations):")
            for ap, signals in sorted(ap_coverage.items(), key=lambda x: mean(x[1]), reverse=True):
                avg = mean(signals)
                hosts_visible = len(signals)
                print(f"      {ap}: {avg:.0f} dBm (visible at {hosts_visible} location(s))")


def main():
    summary_only = "--summary" in sys.argv
    as_json = "--json" in sys.argv
    
    results = analyze_coverage_gaps()
    
    if as_json:
        # Clean up for JSON output
        output = {
            "overall_score": results.get("overall_score", 0),
            "hosts": results.get("hosts", {}),
            "dead_zones": results.get("dead_zones", []),
            "weak_areas": results.get("weak_areas", []),
            "recommendations": results.get("coverage_recommendations", [])
        }
        print(json.dumps(output, indent=2))
    elif summary_only:
        print(f"Overall Coverage Score: {results.get('overall_score', 0)}/100")
        print(f"Dead Zones: {len(results.get('dead_zones', []))}")
        print(f"Weak Areas: {len(results.get('weak_areas', []))}")
        print(f"Recommendations: {len(results.get('coverage_recommendations', []))}")
    else:
        print_report(results)


if __name__ == "__main__":
    main()
