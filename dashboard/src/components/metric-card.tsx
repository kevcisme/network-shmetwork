"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HostMetrics } from "@/lib/log-parser";

interface MetricCardProps {
  host: string;
  metrics: HostMetrics;
  children?: React.ReactNode;
}

type Status = "healthy" | "degraded" | "down";

function getStatus(metrics: HostMetrics): Status {
  if (metrics.wan?.allDown) return "down";
  const loss = metrics.network?.wanLoss ?? 0;
  const latency = metrics.network?.wanLatency ?? 0;
  if (loss >= 50) return "down";
  if (loss >= 10 || latency > 100) return "degraded";
  return "healthy";
}

function getSignalQuality(dbm: number | null): "good" | "neutral" | "warning" | "bad" {
  if (dbm === null) return "neutral";
  if (dbm >= -50) return "good";
  if (dbm >= -70) return "neutral";
  if (dbm >= -80) return "warning";
  return "bad";
}

function formatValue(val: number | null | undefined, decimals = 1): string {
  if (val === null || val === undefined) return "—";
  return typeof val === "number" ? val.toFixed(decimals) : String(val);
}

const statusConfig: Record<Status, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  healthy: { label: "Healthy", variant: "default" },
  degraded: { label: "Degraded", variant: "secondary" },
  down: { label: "Down", variant: "destructive" },
};

const qualityColors = {
  good: "text-emerald-500",
  neutral: "text-foreground",
  warning: "text-amber-500",
  bad: "text-red-500",
};

interface MetricItemProps {
  label: string;
  value: string;
  unit: string;
  quality?: "good" | "neutral" | "warning" | "bad";
}

function MetricItem({ label, value, unit, quality = "neutral" }: MetricItemProps) {
  return (
    <div className="rounded-lg bg-background/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </div>
      <div className={cn("text-xl font-semibold font-mono", qualityColors[quality])}>
        {value}
        <span className="text-xs text-muted-foreground ml-1">{unit}</span>
      </div>
    </div>
  );
}

export function MetricCard({ host, metrics, children }: MetricCardProps) {
  const status = getStatus(metrics);
  const { label, variant } = statusConfig[status];
  
  const network = metrics.network;
  const wifi = metrics.wifi;
  
  const signalQuality = getSignalQuality(wifi?.signal ?? null);
  const gwLatencyQuality = (network?.gwLatency ?? 0) > 50 ? "warning" : (network?.gwLatency ?? 0) > 20 ? "neutral" : "good";
  const wanLatencyQuality = (network?.wanLatency ?? 0) > 100 ? "bad" : (network?.wanLatency ?? 0) > 50 ? "warning" : "good";
  const lossQuality = (network?.wanLoss ?? 0) > 10 ? "bad" : (network?.wanLoss ?? 0) > 0 ? "warning" : "good";
  
  const subtitle = wifi?.ssid 
    ? `${wifi.ssid}${wifi.apName ? ` • ${wifi.apName}` : ""}`
    : "Ethernet";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{host}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">{subtitle}</p>
          </div>
          <Badge variant={variant}>{label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <MetricItem
            label="Signal"
            value={formatValue(wifi?.signal, 0)}
            unit="dBm"
            quality={signalQuality}
          />
          <MetricItem
            label="Gateway"
            value={formatValue(network?.gwLatency)}
            unit="ms"
            quality={gwLatencyQuality}
          />
          <MetricItem
            label="WAN Latency"
            value={formatValue(network?.wanLatency)}
            unit="ms"
            quality={wanLatencyQuality}
          />
          <MetricItem
            label="Packet Loss"
            value={formatValue(network?.wanLoss, 0)}
            unit="%"
            quality={lossQuality}
          />
        </div>
        
        {wifi?.bssid && (
          <div className="border-t pt-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">BSSID</span>
              <span className="font-mono">{wifi.bssid}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">TX Rate</span>
              <span className="font-mono">{wifi.txBitrate || "—"}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">RX Rate</span>
              <span className="font-mono">{wifi.rxBitrate || "—"}</span>
            </div>
            {wifi.channelBusy !== null && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Channel Busy</span>
                <span className="font-mono">{wifi.channelBusy}%</span>
              </div>
            )}
          </div>
        )}
        
        {children}
      </CardContent>
    </Card>
  );
}
