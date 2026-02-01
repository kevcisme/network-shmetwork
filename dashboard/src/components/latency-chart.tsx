"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { HostHistory } from "@/lib/log-parser";

interface LatencyChartProps {
  host: string;
}

type MetricType = "latency" | "loss" | "signal";
type TimeRange = 60 | 360 | 1440;

const chartConfigs: Record<MetricType, ChartConfig> = {
  latency: {
    wanLatency: {
      label: "WAN Latency",
      color: "var(--chart-1)",
    },
    gwLatency: {
      label: "Gateway Latency",
      color: "var(--chart-2)",
    },
  },
  loss: {
    wanLoss: {
      label: "WAN Loss",
      color: "var(--chart-3)",
    },
    gwLoss: {
      label: "Gateway Loss",
      color: "var(--chart-4)",
    },
  },
  signal: {
    signal: {
      label: "WiFi Signal",
      color: "var(--chart-1)",
    },
  },
};

const timeRangeLabels: Record<TimeRange, string> = {
  60: "1h",
  360: "6h",
  1440: "24h",
};

export function LatencyChart({ host }: LatencyChartProps) {
  const [data, setData] = useState<HostHistory | null>(null);
  const [metric, setMetric] = useState<MetricType>("latency");
  const [range, setRange] = useState<TimeRange>(60);
  const [loading, setLoading] = useState(true);
  const [hasWifi, setHasWifi] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/history/${host}?minutes=${range}`);
      const history: HostHistory = await res.json();
      setData(history);
      setHasWifi(history.wifiProbe.some((p) => p.signal !== null));
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoading(false);
    }
  }, [host, range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
        Loading chart...
      </div>
    );
  }

  if (!data || data.netProbe.length === 0) {
    return (
      <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">
        No data available
      </div>
    );
  }

  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const chartData =
    metric === "signal"
      ? data.wifiProbe.map((p) => ({
          time: formatTime(p.ts),
          signal: p.signal,
        }))
      : data.netProbe.map((p) => ({
          time: formatTime(p.ts),
          wanLatency: p.wanLatency,
          gwLatency: p.gwLatency,
          wanLoss: p.wanLoss,
          gwLoss: p.gwLoss,
        }));

  const config = chartConfigs[metric];

  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <Tabs value={metric} onValueChange={(v) => setMetric(v as MetricType)}>
          <TabsList className="h-7">
            <TabsTrigger value="latency" className="text-xs px-2 h-5">
              Latency
            </TabsTrigger>
            <TabsTrigger value="loss" className="text-xs px-2 h-5">
              Loss
            </TabsTrigger>
            {hasWifi && (
              <TabsTrigger value="signal" className="text-xs px-2 h-5">
                Signal
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <div className="flex gap-1">
          {(Object.keys(timeRangeLabels) as unknown as TimeRange[]).map((r) => (
            <Button
              key={r}
              variant={range === Number(r) ? "default" : "outline"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => setRange(Number(r) as TimeRange)}
            >
              {timeRangeLabels[r as TimeRange]}
            </Button>
          ))}
        </div>
      </div>
      <ChartContainer config={config} className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
            <defs>
              {Object.entries(config).map(([key, value]) => (
                <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={value.color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={value.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
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
              domain={metric === "signal" ? [-90, -30] : metric === "loss" ? [0, 100] : [0, "auto"]}
              reversed={metric === "signal"}
            />
            <ChartTooltip
              content={<ChartTooltipContent />}
              cursor={{ stroke: "var(--border)" }}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {Object.keys(config).map((key) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={config[key as keyof typeof config].color}
                fill={`url(#fill-${key})`}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
