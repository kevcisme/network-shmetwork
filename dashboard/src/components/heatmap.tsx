"use client";

import { cn } from "@/lib/utils";
import type { HourlyPattern } from "@/lib/log-parser";

interface HeatmapProps {
  patterns: Record<number, HourlyPattern>;
}

export function Heatmap({ patterns }: HeatmapProps) {
  const getLevel = (hour: number): 0 | 1 | 2 | 3 => {
    const data = patterns[hour];
    if (!data || data.total === 0) return 0;
    const ratio = data.issues / data.total;
    if (ratio > 0.2) return 3;
    if (ratio > 0.1) return 2;
    if (ratio > 0.05) return 1;
    return 0;
  };

  const levelColors = {
    0: "bg-emerald-500/10",
    1: "bg-emerald-500/30",
    2: "bg-amber-500/40",
    3: "bg-red-500/60",
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-24 gap-0.5">
        {Array.from({ length: 24 }, (_, hour) => {
          const level = getLevel(hour);
          const data = patterns[hour];
          return (
            <div
              key={hour}
              className={cn(
                "aspect-square rounded-sm transition-colors",
                levelColors[level]
              )}
              title={`${hour}:00 - ${data?.issues ?? 0} issues / ${data?.total ?? 0} samples`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>
    </div>
  );
}
