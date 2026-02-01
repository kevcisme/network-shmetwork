"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Radio } from "lucide-react";
import type { BandUsage } from "@/lib/log-parser";

const chartConfig: ChartConfig = {
  band24: {
    label: "2.4GHz",
    color: "var(--chart-3)",
  },
  band5: {
    label: "5GHz",
    color: "var(--chart-1)",
  },
  band6: {
    label: "6GHz",
    color: "var(--chart-2)",
  },
};

export function BandUsageChart() {
  const [bandUsage, setBandUsage] = useState<Record<string, BandUsage> | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/band-usage");
        const data = await res.json();
        setBandUsage(data);
      } catch (err) {
        console.error("Failed to fetch band usage:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Band Usage
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px]" />
        </CardContent>
      </Card>
    );
  }

  if (!bandUsage || Object.keys(bandUsage).length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Band Usage
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          No band usage data available
        </CardContent>
      </Card>
    );
  }

  // Transform data for the chart
  const chartData = Object.entries(bandUsage).map(([host, usage]) => {
    const total = usage.total || 1;
    return {
      host,
      band24: Math.round((usage.band24 / total) * 100),
      band5: Math.round((usage.band5 / total) * 100),
      band6: Math.round((usage.band6 / total) * 100),
    };
  });

  // Calculate overall stats
  const totalSamples = Object.values(bandUsage).reduce(
    (sum, u) => sum + u.total,
    0
  );
  const total24 = Object.values(bandUsage).reduce(
    (sum, u) => sum + u.band24,
    0
  );
  const total5 = Object.values(bandUsage).reduce((sum, u) => sum + u.band5, 0);
  const pct5 = totalSamples > 0 ? Math.round((total5 / totalSamples) * 100) : 0;
  const pct24 =
    totalSamples > 0 ? Math.round((total24 / totalSamples) * 100) : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-muted-foreground" />
            Band Usage
          </CardTitle>
          <div className="flex gap-2">
            <Badge
              variant={pct5 >= 70 ? "default" : "secondary"}
              className="text-xs"
            >
              5GHz: {pct5}%
            </Badge>
            <Badge
              variant={pct24 > 30 ? "destructive" : "secondary"}
              className="text-xs"
            >
              2.4GHz: {pct24}%
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          5GHz usage preferred for better performance
        </p>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 10, bottom: 0, left: 0 }}
            >
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis
                type="category"
                dataKey="host"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={80}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                content={<ChartTooltipContent />}
              />
              <Bar
                dataKey="band5"
                stackId="a"
                fill="var(--chart-1)"
                radius={[0, 0, 0, 0]}
                name="5GHz"
              />
              <Bar
                dataKey="band24"
                stackId="a"
                fill="var(--chart-3)"
                radius={[0, 0, 0, 0]}
                name="2.4GHz"
              />
              <Bar
                dataKey="band6"
                stackId="a"
                fill="var(--chart-2)"
                radius={[0, 4, 4, 0]}
                name="6GHz"
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
        {pct24 > 50 && (
          <p className="text-xs text-amber-500 mt-2">
            ⚠️ High 2.4GHz usage detected. Check band steering settings.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
