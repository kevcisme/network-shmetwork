import { NextResponse } from "next/server";
import { getBandUsage } from "@/lib/log-parser";

export async function GET() {
  const bandUsage = await getBandUsage();
  return NextResponse.json(bandUsage);
}
