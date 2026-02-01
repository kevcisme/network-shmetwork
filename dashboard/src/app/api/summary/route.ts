import { NextResponse } from "next/server";
import { getLatestMetrics } from "@/lib/log-parser";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getLatestMetrics();
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Failed to get summary:", error);
    return NextResponse.json(
      { error: "Failed to load metrics" },
      { status: 500 }
    );
  }
}
