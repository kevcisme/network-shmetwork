import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "csv-parse/sync";

/** Default log directory - can be overridden via LOG_DIR env var */
export const LOG_DIR = process.env.LOG_DIR || "/var/log/netdiag";

/** Safe number parser that handles empty strings and returns null */
export function safeParseFloat(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseFloat(String(val));
  return isNaN(num) ? null : num;
}

export function safeParseInt(val: unknown): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseInt(String(val), 10);
  return isNaN(num) ? null : num;
}

/** Parsed log data structure */
export interface ParsedLogs {
  hosts: string[];
  netProbe: Record<string, Record<string, unknown>[]>;
  wifiProbe: Record<string, Record<string, unknown>[]>;
  wanProbe: Record<string, Record<string, unknown>[]>;
  iperf: Record<string, Record<string, unknown>[]>;
  wifiEvents: Record<string, Record<string, unknown>[]>;
}

/** Network metrics for a single host */
export interface HostMetrics {
  lastUpdate: string | null;
  network: {
    gwLoss: number;
    gwLatency: number | null;
    wanLoss: number;
    wanLatency: number | null;
    dnsOk: boolean;
  } | null;
  wifi: {
    ssid: string | null;
    bssid: string | null;
    apName: string | null;
    signal: number | null;
    txBitrate: string | null;
    rxBitrate: string | null;
    channelBusy: number | null;
    freqMhz: number | null;
    band: string | null;
    channel: number | null;
    noise: number | null;
    snr: number | null;
  } | null;
  wan: {
    cfLoss: number;
    cfLatency: number | null;
    googleLoss: number;
    googleLatency: number | null;
    allDown: boolean;
  } | null;
  iperf: {
    mode: string;
    bitsPerSecond: number | null;
  } | null;
}

/** Read and parse CSV file, returning last N rows */
export async function parseCSV(
  filePath: string,
  limit = 100
): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
    }) as Record<string, unknown>[];
    return records.slice(-limit);
  } catch {
    // Silently fail for missing files
    return [];
  }
}

/** Read and parse JSONL file, returning last N rows */
export async function parseJSONL(
  filePath: string,
  limit = 100
): Promise<Record<string, unknown>[]> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

/** Directories to ignore (not actual hosts) */
const IGNORE_DIRS = new Set(["failures", "snapshots", "archive"]);

/** Get all host directories from the log directory */
export async function getHosts(): Promise<string[]> {
  try {
    const entries = await readdir(LOG_DIR, { withFileTypes: true });
    const hosts: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
        hosts.push(entry.name);
      }
    }

    // Also check if there are local logs (not in subdirectory)
    const localFiles = entries.filter(
      (e) => e.isFile() && e.name.endsWith(".csv")
    );
    if (localFiles.length > 0) {
      hosts.push("local");
    }

    return hosts.sort();
  } catch {
    return [];
  }
}

/** Load all logs for all hosts */
export async function loadAllLogs(): Promise<ParsedLogs> {
  const hosts = await getHosts();
  const result: ParsedLogs = {
    hosts,
    netProbe: {},
    wifiProbe: {},
    wanProbe: {},
    iperf: {},
    wifiEvents: {},
  };

  for (const host of hosts) {
    const hostDir = host === "local" ? LOG_DIR : join(LOG_DIR, host);

    result.netProbe[host] = await parseCSV(join(hostDir, "net_probe.csv"));
    result.wifiProbe[host] = await parseCSV(join(hostDir, "wifi_probe.csv"));
    result.wanProbe[host] = await parseCSV(join(hostDir, "wan_probe.csv"));
    result.iperf[host] = await parseJSONL(join(hostDir, "iperf.jsonl"));
    result.wifiEvents[host] = await parseJSONL(
      join(hostDir, "wifi_events.jsonl")
    );
  }

  return result;
}

/** Get latest metrics summary for dashboard */
export async function getLatestMetrics(): Promise<Record<string, HostMetrics>> {
  const logs = await loadAllLogs();
  const summary: Record<string, HostMetrics> = {};

  for (const host of logs.hosts) {
    const netProbe = logs.netProbe[host]?.slice(-1)[0];
    const wifiProbe = logs.wifiProbe[host]?.slice(-1)[0];
    const wanProbe = logs.wanProbe[host]?.slice(-1)[0];
    const lastIperf = logs.iperf[host]?.slice(-1)[0];

    // Check if wifi data has actual values (ssid or bssid present)
    const hasWifiData = wifiProbe && (wifiProbe.ssid || wifiProbe.bssid);

    summary[host] = {
      lastUpdate: (netProbe?.ts as string) || (wifiProbe?.ts as string) || null,
      network: netProbe
        ? {
            gwLoss: safeParseFloat(netProbe.gw_loss_pct) ?? 0,
            gwLatency: safeParseFloat(netProbe.gw_avg_ms),
            wanLoss: safeParseFloat(netProbe.wan_loss_pct) ?? 0,
            wanLatency: safeParseFloat(netProbe.wan_avg_ms),
            dnsOk: netProbe.dns_ok === "1",
          }
        : null,
      wifi: hasWifiData
        ? {
            ssid: (wifiProbe.ssid as string) || null,
            bssid: (wifiProbe.bssid as string) || null,
            apName: (wifiProbe.ap_name as string) || null,
            signal: safeParseInt(wifiProbe.signal_dbm),
            txBitrate: (wifiProbe.tx_bitrate as string) || null,
            rxBitrate: (wifiProbe.rx_bitrate as string) || null,
            channelBusy: safeParseInt(wifiProbe.chan_busy_pct),
            freqMhz: safeParseInt(wifiProbe.freq_mhz),
            band: (wifiProbe.band as string) || null,
            channel: safeParseInt(wifiProbe.channel),
            noise: safeParseInt(wifiProbe.noise_dbm),
            snr: safeParseInt(wifiProbe.snr_db),
          }
        : null,
      wan: wanProbe
        ? {
            cfLoss: safeParseFloat(wanProbe.cf_loss_pct) ?? 0,
            cfLatency: safeParseFloat(wanProbe.cf_avg_ms),
            googleLoss: safeParseFloat(wanProbe.google_loss_pct) ?? 0,
            googleLatency: safeParseFloat(wanProbe.google_avg_ms),
            allDown: wanProbe.all_down === "1",
          }
        : null,
      iperf:
        lastIperf && (lastIperf as Record<string, unknown>).ok
          ? {
              mode: lastIperf.mode as string,
              bitsPerSecond:
                ((
                  (lastIperf.iperf as Record<string, unknown>)
                    ?.end as Record<string, unknown>
                )?.sum_received as Record<string, unknown>)
                  ?.bits_per_second as number | null,
            }
          : null,
    };
  }

  return summary;
}

/** History data point for charts */
export interface HistoryDataPoint {
  ts: string;
  gwLoss: number | null;
  gwLatency: number | null;
  wanLoss: number | null;
  wanLatency: number | null;
}

export interface WifiHistoryPoint {
  ts: string;
  ssid: string | null;
  bssid: string | null;
  apName: string | null;
  signal: number | null;
  channelBusy: number | null;
  freqMhz: number | null;
  band: string | null;
  channel: number | null;
  noise: number | null;
  snr: number | null;
}

export interface WanHistoryPoint {
  ts: string;
  cfLoss: number | null;
  cfLatency: number | null;
  googleLoss: number | null;
  googleLatency: number | null;
  allDown: boolean;
}

export interface HostHistory {
  host: string;
  netProbe: HistoryDataPoint[];
  wifiProbe: WifiHistoryPoint[];
  wanProbe: WanHistoryPoint[];
}

/** Parse a timestamp string, handling formats with or without colon in tz offset */
function parseTimestamp(ts: unknown): Date {
  if (!ts) return new Date(NaN);
  const str = String(ts);
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  // Handle timezone offset without colon (e.g. +0000 or -1000 from some date implementations)
  const fixed = str.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(fixed);
}

/** Get history for a specific host (last N minutes of data) */
export async function getHostHistory(
  host: string,
  minutes = 60
): Promise<HostHistory> {
  const hostDir = host === "local" ? LOG_DIR : join(LOG_DIR, host);
  // Allow up to 2000 data points for 24h+ views
  const limit = Math.min(minutes + 100, 2000);

  const netProbe = await parseCSV(join(hostDir, "net_probe.csv"), limit);
  const wifiProbe = await parseCSV(join(hostDir, "wifi_probe.csv"), limit);
  const wanProbe = await parseCSV(join(hostDir, "wan_probe.csv"), limit);

  // Filter to requested time range
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const filterByTime = <T extends { ts?: unknown }>(rows: T[]) =>
    rows.filter((r) => {
      const d = parseTimestamp(r.ts);
      return !isNaN(d.getTime()) && d >= cutoff;
    });

  let filteredNet = filterByTime(netProbe);
  let filteredWifi = filterByTime(wifiProbe);
  let filteredWan = filterByTime(wanProbe);

  // If time filtering removed all data but raw data exists, fall back to
  // showing available data - this handles stale synced data or clock skew
  if (filteredNet.length === 0 && netProbe.length > 0) {
    filteredNet = netProbe;
  }
  if (filteredWifi.length === 0 && wifiProbe.length > 0) {
    filteredWifi = wifiProbe;
  }
  if (filteredWan.length === 0 && wanProbe.length > 0) {
    filteredWan = wanProbe;
  }

  return {
    host,
    netProbe: filteredNet.map((row) => ({
      ts: row.ts as string,
      gwLoss: safeParseFloat(row.gw_loss_pct),
      gwLatency: safeParseFloat(row.gw_avg_ms),
      wanLoss: safeParseFloat(row.wan_loss_pct),
      wanLatency: safeParseFloat(row.wan_avg_ms),
    })),
    wifiProbe: filteredWifi.map((row) => ({
      ts: row.ts as string,
      ssid: (row.ssid as string) || null,
      bssid: (row.bssid as string) || null,
      apName: (row.ap_name as string) || null,
      signal: safeParseInt(row.signal_dbm),
      channelBusy: safeParseInt(row.chan_busy_pct),
      freqMhz: safeParseInt(row.freq_mhz),
      band: (row.band as string) || null,
      channel: safeParseInt(row.channel),
      noise: safeParseInt(row.noise_dbm),
      snr: safeParseInt(row.snr_db),
    })),
    wanProbe: filteredWan.map((row) => ({
      ts: row.ts as string,
      cfLoss: safeParseFloat(row.cf_loss_pct),
      cfLatency: safeParseFloat(row.cf_avg_ms),
      googleLoss: safeParseFloat(row.google_loss_pct),
      googleLatency: safeParseFloat(row.google_avg_ms),
      allDown: row.all_down === "1",
    })),
  };
}

/** Thresholds for issue detection */
export const THRESHOLDS = {
  latencyWarning: 50,
  latencyCritical: 100,
  lossWarning: 5,
  lossCritical: 10,
  signalWeak: -70,
  signalCritical: -80,
} as const;

/** Incident record */
export interface Incident {
  ts: string;
  host: string;
  type: "packet_loss" | "high_latency" | "weak_signal";
  severity: "warning" | "critical";
  value: number;
  message: string;
}

/** Host daily statistics */
export interface HostStats {
  totalDataPoints: number;
  issueDataPoints: number;
  uptimePercent: string | null;
  avgLatency: string | null;
  p50Latency: string | null;
  p95Latency: string | null;
  p99Latency: string | null;
}

/** Hourly pattern data */
export interface HourlyPattern {
  issues: number;
  total: number;
}

/** Analytics data */
export interface AnalyticsData {
  dailyStats: Record<string, HostStats>;
  hourlyPatterns: Record<number, HourlyPattern>;
  incidents: Incident[];
  recommendations: string[];
}

/** Analyze data and generate incidents */
export async function getAnalytics(): Promise<AnalyticsData> {
  const logs = await loadAllLogs();
  const hosts = logs.hosts;

  const incidents: Incident[] = [];
  const dailyStats: Record<string, HostStats> = {};
  const hourlyPatterns: Record<number, HourlyPattern> = {};

  // Initialize hourly patterns
  for (let h = 0; h < 24; h++) {
    hourlyPatterns[h] = { issues: 0, total: 0 };
  }

  for (const host of hosts) {
    const netData = logs.netProbe[host] || [];
    const wifiData = logs.wifiProbe[host] || [];

    let totalPoints = 0;
    let issuePoints = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    const latencies: number[] = [];

    // Analyze net_probe data
    for (const row of netData) {
      totalPoints++;
      const ts = new Date(row.ts as string);
      const hour = ts.getHours();
      const wanLoss = safeParseFloat(row.wan_loss_pct) ?? 0;
      const wanLatency = safeParseFloat(row.wan_avg_ms);

      hourlyPatterns[hour].total++;

      let hasIssue = false;

      if (wanLoss >= THRESHOLDS.lossCritical) {
        hasIssue = true;
        incidents.push({
          ts: row.ts as string,
          host,
          type: "packet_loss",
          severity: "critical",
          value: wanLoss,
          message: `${wanLoss}% packet loss`,
        });
      } else if (wanLoss >= THRESHOLDS.lossWarning) {
        hasIssue = true;
      }

      if (wanLatency !== null) {
        latencies.push(wanLatency);
        totalLatency += wanLatency;
        latencyCount++;

        if (wanLatency >= THRESHOLDS.latencyCritical) {
          hasIssue = true;
          incidents.push({
            ts: row.ts as string,
            host,
            type: "high_latency",
            severity: "critical",
            value: wanLatency,
            message: `${wanLatency.toFixed(0)}ms WAN latency`,
          });
        } else if (wanLatency >= THRESHOLDS.latencyWarning) {
          hasIssue = true;
        }
      }

      if (hasIssue) {
        issuePoints++;
        hourlyPatterns[hour].issues++;
      }
    }

    // Analyze wifi data for signal issues
    for (const row of wifiData) {
      const signal = safeParseInt(row.signal_dbm);
      if (signal !== null && signal <= THRESHOLDS.signalCritical) {
        incidents.push({
          ts: row.ts as string,
          host,
          type: "weak_signal",
          severity: "critical",
          value: signal,
          message: `WiFi signal ${signal} dBm`,
        });
      }
    }

    // Calculate percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || null;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || null;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || null;

    dailyStats[host] = {
      totalDataPoints: totalPoints,
      issueDataPoints: issuePoints,
      uptimePercent:
        totalPoints > 0
          ? (((totalPoints - issuePoints) / totalPoints) * 100).toFixed(1)
          : null,
      avgLatency:
        latencyCount > 0 ? (totalLatency / latencyCount).toFixed(1) : null,
      p50Latency: p50?.toFixed(1) || null,
      p95Latency: p95?.toFixed(1) || null,
      p99Latency: p99?.toFixed(1) || null,
    };
  }

  // Generate recommendations
  const recommendations: string[] = [];

  // Find worst hours
  const worstHours = Object.entries(hourlyPatterns)
    .filter(([, data]) => data.total > 0 && data.issues / data.total > 0.1)
    .sort((a, b) => b[1].issues / b[1].total - a[1].issues / a[1].total)
    .slice(0, 3);

  if (worstHours.length > 0) {
    const hourStr = worstHours.map(([h]) => `${h}:00`).join(", ");
    recommendations.push(
      `Most issues occur around ${hourStr} - possible network congestion during these times`
    );
  }

  // Check for hosts with frequent issues
  for (const [host, stats] of Object.entries(dailyStats)) {
    if (stats.uptimePercent && parseFloat(stats.uptimePercent) < 95) {
      recommendations.push(
        `${host} has ${stats.uptimePercent}% uptime - investigate connectivity issues`
      );
    }
    if (stats.p95Latency && parseFloat(stats.p95Latency) > 100) {
      recommendations.push(
        `${host} has high P95 latency (${stats.p95Latency}ms) - may indicate intermittent congestion`
      );
    }
  }

  return {
    dailyStats,
    hourlyPatterns,
    incidents: incidents.slice(-100), // Last 100 incidents
    recommendations,
  };
}

/** Band usage statistics */
export interface BandUsage {
  band24: number;
  band5: number;
  band6: number;
  total: number;
}

/** Mesh health score data */
export interface MeshHealthScore {
  overall: number;
  signalScore: number;
  backhaulScore: number;
  roamingScore: number;
  interferenceScore: number;
  rating: "Excellent" | "Good" | "Fair" | "Poor" | "Critical";
  issues: string[];
}

/** Get band usage statistics for all hosts */
export async function getBandUsage(): Promise<Record<string, BandUsage>> {
  const logs = await loadAllLogs();
  const result: Record<string, BandUsage> = {};

  for (const host of logs.hosts) {
    const wifiData = logs.wifiProbe[host] || [];
    const usage: BandUsage = { band24: 0, band5: 0, band6: 0, total: 0 };

    for (const row of wifiData) {
      let band = row.band as string | undefined;
      const freq = safeParseInt(row.freq_mhz);

      // Infer band from frequency if not explicitly set
      if (!band && freq) {
        if (freq < 3000) band = "2.4GHz";
        else if (freq < 6000) band = "5GHz";
        else band = "6GHz";
      }

      if (band) {
        usage.total++;
        if (band === "2.4GHz") usage.band24++;
        else if (band === "5GHz") usage.band5++;
        else if (band === "6GHz") usage.band6++;
      }
    }

    result[host] = usage;
  }

  return result;
}

/** Calculate mesh health score */
export async function getMeshHealthScore(): Promise<MeshHealthScore> {
  const logs = await loadAllLogs();
  const issues: string[] = [];

  let signalScores: number[] = [];
  let backhaulScores: number[] = [];
  let bandUsageScores: number[] = [];

  for (const host of logs.hosts) {
    const wifiData = logs.wifiProbe[host] || [];
    const iperfData = logs.iperf[host] || [];

    // Signal score (0-100 based on average signal strength)
    const signals = wifiData
      .map((r) => safeParseInt(r.signal_dbm))
      .filter((s): s is number => s !== null);

    if (signals.length > 0) {
      const avgSignal = signals.reduce((a, b) => a + b, 0) / signals.length;
      // Map -90 to -40 dBm range to 0-100 score
      const signalScore = Math.max(0, Math.min(100, ((avgSignal + 90) / 50) * 100));
      signalScores.push(signalScore);

      if (avgSignal < -75) {
        issues.push(`${host}: Weak signal (avg ${avgSignal.toFixed(0)} dBm)`);
      }
    }

    // Backhaul score (based on iperf throughput)
    const throughputs = iperfData
      .filter((r) => r.ok)
      .map((r) => {
        const end = (r.iperf as Record<string, unknown>)?.end as Record<string, unknown>;
        const sumRecv = end?.sum_received as Record<string, unknown>;
        return (sumRecv?.bits_per_second as number) / 1_000_000; // Mbps
      })
      .filter((t): t is number => !isNaN(t) && t > 0);

    if (throughputs.length > 0) {
      const avgThroughput = throughputs.reduce((a, b) => a + b, 0) / throughputs.length;
      // Map 0-200 Mbps to 0-100 score (200+ is 100)
      const backhaulScore = Math.min(100, (avgThroughput / 200) * 100);
      backhaulScores.push(backhaulScore);

      if (avgThroughput < 50) {
        issues.push(`${host}: Slow backhaul (avg ${avgThroughput.toFixed(0)} Mbps)`);
      }
    }

    // Band usage score (prefer 5GHz over 2.4GHz)
    const bands = wifiData
      .map((r) => (r.band as string) || (safeParseInt(r.freq_mhz) && safeParseInt(r.freq_mhz)! < 3000 ? "2.4GHz" : "5GHz"))
      .filter(Boolean);

    if (bands.length > 0) {
      const band5Count = bands.filter((b) => b === "5GHz" || b === "6GHz").length;
      const bandScore = (band5Count / bands.length) * 100;
      bandUsageScores.push(bandScore);

      if (bandScore < 50) {
        issues.push(`${host}: Stuck on 2.4GHz ${(100 - bandScore).toFixed(0)}% of time`);
      }
    }
  }

  // Calculate component scores
  const signalScore = signalScores.length > 0
    ? signalScores.reduce((a, b) => a + b, 0) / signalScores.length
    : 50;
  const backhaulScore = backhaulScores.length > 0
    ? backhaulScores.reduce((a, b) => a + b, 0) / backhaulScores.length
    : 50;
  const roamingScore = bandUsageScores.length > 0
    ? bandUsageScores.reduce((a, b) => a + b, 0) / bandUsageScores.length
    : 50;
  const interferenceScore = 70; // Placeholder - would need interference data

  // Weighted overall score
  const overall = Math.round(
    signalScore * 0.35 +
    backhaulScore * 0.30 +
    roamingScore * 0.20 +
    interferenceScore * 0.15
  );

  // Determine rating
  let rating: MeshHealthScore["rating"];
  if (overall >= 85) rating = "Excellent";
  else if (overall >= 70) rating = "Good";
  else if (overall >= 50) rating = "Fair";
  else if (overall >= 30) rating = "Poor";
  else rating = "Critical";

  return {
    overall,
    signalScore: Math.round(signalScore),
    backhaulScore: Math.round(backhaulScore),
    roamingScore: Math.round(roamingScore),
    interferenceScore: Math.round(interferenceScore),
    rating,
    issues,
  };
}
