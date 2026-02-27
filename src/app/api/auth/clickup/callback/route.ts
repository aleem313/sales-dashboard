import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setCachedStats } from "@/lib/data";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/settings?clickup=error&reason=no_code", request.url));
  }

  const clientId = process.env.CLICKUP_CLIENT_ID;
  const clientSecret = process.env.CLICKUP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/settings?clickup=error&reason=not_configured", request.url));
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch("https://api.clickup.com/api/v2/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("ClickUp token exchange failed:", err);
      return NextResponse.redirect(new URL("/settings?clickup=error&reason=token_failed", request.url));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token as string;

    // Store access token in cache (long TTL)
    await setCachedStats("clickup_oauth_token", { access_token: accessToken }, 525600);

    // Get the authorized user's teams
    const teamsRes = await fetch("https://api.clickup.com/api/v2/team", {
      headers: { Authorization: accessToken },
    });

    if (!teamsRes.ok) {
      console.error("Failed to fetch ClickUp teams");
      return NextResponse.redirect(new URL("/settings?clickup=connected&webhook=failed", request.url));
    }

    const teamsData = await teamsRes.json();
    const teams = teamsData.teams as Array<{ id: string; name: string }>;

    if (teams.length === 0) {
      return NextResponse.redirect(new URL("/settings?clickup=connected&webhook=no_team", request.url));
    }

    const teamId = teams[0].id;

    // Store team ID
    await setCachedStats("clickup_team_id", { team_id: teamId }, 525600);

    // Check for existing webhooks to avoid duplicates
    const existingRes = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/webhook`, {
      headers: { Authorization: accessToken },
    });

    const baseUrl = process.env.NEXTAUTH_URL
      ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
    const webhookUrl = `${baseUrl}/api/webhook/clickup`;

    let webhookExists = false;
    if (existingRes.ok) {
      const existingData = await existingRes.json();
      const webhooks = existingData.webhooks as Array<{ endpoint: string }>;
      webhookExists = webhooks.some((w) => w.endpoint === webhookUrl);
    }

    if (!webhookExists) {
      // Create webhook for task status updates
      const webhookRes = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/webhook`, {
        method: "POST",
        headers: {
          Authorization: accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: webhookUrl,
          events: ["taskStatusUpdated"],
        }),
      });

      if (!webhookRes.ok) {
        const err = await webhookRes.text();
        console.error("Failed to create ClickUp webhook:", err);
        return NextResponse.redirect(new URL("/settings?clickup=connected&webhook=failed", request.url));
      }

      const webhookData = await webhookRes.json();
      await setCachedStats("clickup_webhook", {
        webhook_id: webhookData.id,
        endpoint: webhookUrl,
      }, 525600);
    }

    return NextResponse.redirect(new URL("/settings?clickup=connected&webhook=created", request.url));
  } catch (error) {
    console.error("ClickUp OAuth error:", error);
    return NextResponse.redirect(new URL("/settings?clickup=error&reason=unknown", request.url));
  }
}
