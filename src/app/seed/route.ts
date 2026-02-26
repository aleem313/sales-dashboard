import { seed } from "@/lib/seed";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const result = await seed();
    return NextResponse.json({
      message: "Database seeded successfully",
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
