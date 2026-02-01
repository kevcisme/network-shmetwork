import { NextResponse } from "next/server";
import { getHosts } from "@/lib/log-parser";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const hosts = await getHosts();
    return NextResponse.json(hosts);
  } catch (error) {
    console.error("Failed to get hosts:", error);
    return NextResponse.json(
      { error: "Failed to load hosts" },
      { status: 500 }
    );
  }
}
