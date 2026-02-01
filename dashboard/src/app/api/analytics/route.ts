import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/log-parser";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const analytics = await getAnalytics();
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Failed to get analytics:", error);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 }
    );
  }
}
