"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Heatmap } from "@/components/heatmap";
import { cn } from "@/lib/utils";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart";
import { AlertCircle, Lightbulb, TrendingUp } from "lucide-react";
import { BandUsageChart } from "@/components/band-usage-chart";
import { MeshHealthScore } from "@/components/mesh-health-score";
import type { AnalyticsData, HostHistory } from "@/lib/log-parser";

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[280px]" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[200px]" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-[300px]" />
        <Skeleton className="h-[300px]" />
      </div>
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string | null;
  highlight?: boolean;
}

function StatRow({ label, value, highlight }: StatRowProps) {
  return (
    <div className="flex justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-medium",
          highlight && "text-primary"
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [historyData, setHistoryData] = useState<Record<string, HostHistory>>(
    {}
  );
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [analyticsRes, hostsRes] = await Promise.all([
        fetch("/api/analytics"),
        fetch("/api/hosts"),
      ]);

      const analyticsData: AnalyticsData = await analyticsRes.json();
      const hosts: string[] = await hostsRes.json();

      setAnalytics(analyticsData);

      // Fetch 24h history for each host
      const historyPromises = hosts.map(async (host) => {
        const res = await fetch(`/api/history/${host}?minutes=1440`);
        const data: HostHistory = await res.json();
        return [host, data] as const;
      });

      const histories = await Promise.all(historyPromises);
      setHistoryData(Object.fromEntries(histories));
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Network performance insights and trends
          </p>
        </div>
        <LoadingSkeleton />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Network performance insights and trends
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Failed to load analytics data
          </CardContent>
        </Card>
      </div>
    );
  }

  const hosts = Object.keys(analytics.dailyStats);

  // Build chart data for 24h comparison
  const chartConfig: ChartConfig = {};
  hosts.forEach((host, i) => {
    chartConfig[host] = {
      label: host,
      color: chartColors[i % chartColors.length],
    };
  });

  // Merge all host data into single timeline
  const allTimestamps = new Set<string>();
  Object.values(historyData).forEach((history) => {
    history.netProbe.forEach((p) => {
      const time = new Date(p.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      allTimestamps.add(time);
    });
  });

  const sortedTimes = Array.from(allTimestamps).sort();
  const comparisonData = sortedTimes.map((time) => {
    const point: Record<string, string | number | null> = { time };
    hosts.forEach((host) => {
      const history = historyData[host];
      const match = history?.netProbe.find((p) => {
        const t = new Date(p.ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return t === time;
      });
      point[host] = match?.wanLatency ?? null;
    });
    return point;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Network performance insights and trends
        </p>
      </div>

      {/* 24h Latency Comparison Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">24-Hour Latency Comparison</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {comparisonData.length > 0 ? (
            <ChartContainer config={chartConfig} className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={comparisonData}
                  margin={{ top: 5, right: 5, bottom: 0, left: -20 }}
                >
                  <defs>
                    {hosts.map((host, i) => (
                      <linearGradient
                        key={host}
                        id={`fill-${host}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={chartColors[i % chartColors.length]}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={chartColors[i % chartColors.length]}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border/50"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    className="text-muted-foreground"
                    label={{
                      value: "ms",
                      angle: -90,
                      position: "insideLeft",
                      fontSize: 10,
                    }}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent />}
                    cursor={{ stroke: "var(--border)" }}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  {hosts.map((host, i) => (
                    <Area
                      key={host}
                      type="monotone"
                      dataKey={host}
                      stroke={chartColors[i % chartColors.length]}
                      fill={`url(#fill-${host})`}
                      strokeWidth={1.5}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Host Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hosts.map((host) => {
          const stats = analytics.dailyStats[host];
          const uptime = stats.uptimePercent
            ? parseFloat(stats.uptimePercent)
            : null;
          const uptimeColor =
            uptime === null
              ? "text-muted-foreground"
              : uptime >= 99
                ? "text-emerald-500"
                : uptime >= 95
                  ? "text-amber-500"
                  : "text-red-500";

          return (
            <Card key={host}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{host}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <StatRow
                  label="Uptime"
                  value={stats.uptimePercent ? `${stats.uptimePercent}%` : null}
                  highlight
                />
                <StatRow
                  label="Avg Latency"
                  value={stats.avgLatency ? `${stats.avgLatency} ms` : null}
                />
                <StatRow
                  label="P95 Latency"
                  value={stats.p95Latency ? `${stats.p95Latency} ms` : null}
                />
                <StatRow
                  label="P99 Latency"
                  value={stats.p99Latency ? `${stats.p99Latency} ms` : null}
                />
                <StatRow
                  label="Issue Events"
                  value={`${stats.issueDataPoints} / ${stats.totalDataPoints}`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Issues by Hour of Day</CardTitle>
          <p className="text-xs text-muted-foreground">
            Darker colors indicate more issues. Hover for details.
          </p>
        </CardHeader>
        <CardContent>
          <Heatmap patterns={analytics.hourlyPatterns} />
        </CardContent>
      </Card>

      {/* Mesh Health & Band Usage */}
      <div className="grid gap-4 md:grid-cols-2">
        <MeshHealthScore />
        <BandUsageChart />
      </div>

      {/* Incidents & Recommendations */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Recent Incidents</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {analytics.incidents.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                {analytics.incidents
                  .slice(-20)
                  .reverse()
                  .map((incident, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-lg bg-background/50 p-3 border-l-2",
                        incident.severity === "critical"
                          ? "border-l-red-500"
                          : "border-l-amber-500"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className="text-xs">
                          {incident.host}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(incident.ts).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm">{incident.message}</p>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No recent incidents
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Recommendations</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {analytics.recommendations.length > 0 ? (
              <ul className="space-y-2">
                {analytics.recommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-background/50 p-3 text-sm border-l-2 border-l-primary"
                  >
                    {rec}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No recommendations - network looks healthy!
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
