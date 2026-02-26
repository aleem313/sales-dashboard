import { migrateSchema, seedTestData } from "@/lib/seed";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "all";

  try {
    if (action === "migrate" || action === "all") {
      await migrateSchema();
    }

    let seedResult = null;
    if (action === "seed" || action === "all") {
      seedResult = await seedTestData();
    }

    return NextResponse.json({
      message:
        action === "migrate"
          ? "Schema migrated successfully"
          : action === "seed"
            ? "Test data seeded successfully"
            : "Schema migrated and test data seeded",
      ...(seedResult ?? {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
