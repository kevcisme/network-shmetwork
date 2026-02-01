"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity, Wifi, Gauge, Radio, Waves } from "lucide-react";
import type { MeshHealthScore as MeshHealthScoreType } from "@/lib/log-parser";

interface ScoreBarProps {
  label: string;
  score: number;
  icon: React.ReactNode;
}

function ScoreBar({ label, score, icon }: ScoreBarProps) {
  const getColor = (s: number) => {
    if (s >= 80) return "bg-emerald-500";
    if (s >= 60) return "bg-amber-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className="font-mono font-medium">{score}</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", getColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

export function MeshHealthScore() {
  const [health, setHealth] = useState<MeshHealthScoreType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/mesh-health");
        const data = await res.json();
        setHealth(data);
      } catch (err) {
        console.error("Failed to fetch mesh health:", err);
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
            <Activity className="h-4 w-4" />
            Mesh Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px]" />
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Mesh Health
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Unable to calculate health score
        </CardContent>
      </Card>
    );
  }

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "Excellent":
        return "text-emerald-500 bg-emerald-500/10";
      case "Good":
        return "text-green-500 bg-green-500/10";
      case "Fair":
        return "text-amber-500 bg-amber-500/10";
      case "Poor":
        return "text-orange-500 bg-orange-500/10";
      case "Critical":
        return "text-red-500 bg-red-500/10";
      default:
        return "text-muted-foreground bg-muted";
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 60) return "text-amber-500";
    return "text-red-500";
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Mesh Health Score
          </CardTitle>
          <Badge variant="outline" className={cn("text-xs", getRatingColor(health.rating))}>
            {health.rating}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Score */}
        <div className="flex items-center justify-center py-4">
          <div className="relative">
            <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                className="text-muted"
              />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${health.overall * 2.83} 283`}
                className={getScoreColor(health.overall)}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-3xl font-bold", getScoreColor(health.overall))}>
                {health.overall}
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Score
              </span>
            </div>
          </div>
        </div>

        {/* Component Scores */}
        <div className="space-y-3">
          <ScoreBar
            label="Signal Coverage"
            score={health.signalScore}
            icon={<Wifi className="h-3 w-3" />}
          />
          <ScoreBar
            label="Backhaul Quality"
            score={health.backhaulScore}
            icon={<Gauge className="h-3 w-3" />}
          />
          <ScoreBar
            label="Band Steering"
            score={health.roamingScore}
            icon={<Radio className="h-3 w-3" />}
          />
          <ScoreBar
            label="Interference"
            score={health.interferenceScore}
            icon={<Waves className="h-3 w-3" />}
          />
        </div>

        {/* Issues */}
        {health.issues.length > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
              Issues Detected
            </p>
            <div className="space-y-1 max-h-[100px] overflow-y-auto">
              {health.issues.slice(0, 5).map((issue, i) => (
                <p key={i} className="text-xs text-amber-500">
                  • {issue}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
