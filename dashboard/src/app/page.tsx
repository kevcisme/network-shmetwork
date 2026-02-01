"use client";

import { useEffect, useState, useCallback } from "react";
import { MetricCard } from "@/components/metric-card";
import { LatencyChart } from "@/components/latency-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HostMetrics } from "@/lib/log-parser";

const REFRESH_INTERVAL = 10000;

interface Alert {
  host: string;
  message: string;
}

function checkAlerts(data: Record<string, HostMetrics>): Alert[] {
  const alerts: Alert[] = [];

  for (const [host, metrics] of Object.entries(data)) {
    const network = metrics.network;
    const wifi = metrics.wifi;
    const wan = metrics.wan;

    if (wan?.allDown) {
      alerts.push({ host, message: "WAN is down" });
    } else if ((network?.wanLoss ?? 0) > 10) {
      alerts.push({ host, message: `High packet loss (${network?.wanLoss}%)` });
    }

    if ((network?.wanLatency ?? 0) > 100) {
      alerts.push({
        host,
        message: `High latency (${network?.wanLatency?.toFixed(0)}ms)`,
      });
    }

    if (wifi?.signal !== null && wifi?.signal !== undefined && wifi.signal < -80) {
      alerts.push({ host, message: `Weak WiFi signal (${wifi.signal} dBm)` });
    }
  }

  return alerts;
}

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4].map((j) => (
                <Skeleton key={j} className="h-16 rounded-lg" />
              ))}
            </div>
            <Skeleton className="h-[180px]" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Record<string, HostMetrics> | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/summary");
      const summary: Record<string, HostMetrics> = await res.json();
      setData(summary);
      setAlerts(checkAlerts(summary));
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  const hosts = data ? Object.keys(data).sort() : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Real-time network monitoring across all hosts
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdate && (
            <span className="text-xs text-muted-foreground">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 text-destructive mb-2">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium text-sm">Active Alerts</span>
          </div>
          <div className="space-y-1">
            {alerts.map((alert, i) => (
              <div key={i} className="text-sm">
                <span className="font-medium">{alert.host}:</span>{" "}
                <span className="text-muted-foreground">{alert.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : hosts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No data yet. Waiting for logs...
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hosts.map((host) => (
            <MetricCard key={host} host={host} metrics={data![host]}>
              <LatencyChart host={host} />
            </MetricCard>
          ))}
        </div>
      )}
    </div>
  );
}
