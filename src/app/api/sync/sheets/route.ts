import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Google Sheets integration not yet configured" },
    { status: 501 }
  );
}
