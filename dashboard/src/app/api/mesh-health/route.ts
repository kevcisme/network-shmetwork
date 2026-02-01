import { NextResponse } from "next/server";
import { getMeshHealthScore } from "@/lib/log-parser";

export async function GET() {
  const healthScore = await getMeshHealthScore();
  return NextResponse.json(healthScore);
}
