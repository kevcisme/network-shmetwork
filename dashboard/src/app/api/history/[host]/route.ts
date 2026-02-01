import { NextRequest, NextResponse } from "next/server";
import { getHostHistory } from "@/lib/log-parser";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ host: string }> }
) {
  try {
    const { host } = await params;
    const searchParams = request.nextUrl.searchParams;
    const minutes = parseInt(searchParams.get("minutes") || "60", 10);

    const history = await getHostHistory(host, minutes);
    return NextResponse.json(history);
  } catch (error) {
    console.error("Failed to get history:", error);
    return NextResponse.json(
      { error: "Failed to load history" },
      { status: 500 }
    );
  }
}
