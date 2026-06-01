import { auth } from "@/lib/auth";

// Admin-only route prefixes — agents get redirected.
// NOTE: /relevancy-audit and /relevancy-evaluator are intentionally NOT here —
// they are shared admin+agent routes (see spec
// docs/superpowers/specs/2026-05-21-agent-relevancy-pages-design.md). Auth is
// still enforced via the matcher; only the admin-only redirect is dropped.
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks"];

// Paths under matcher-covered prefixes that n8n calls back into and that the
// route itself handles auth for (or intentionally exposes without auth, per the
// route's source comments). These bypass NextAuth so n8n's httpRequest nodes
// don't follow a 302 to /login and feed login HTML into the classifier.
//
// Each entry is matched against req.nextUrl.pathname with String.match; keep
// the regex anchored and narrow.
const PUBLIC_PATH_PATTERNS = [
  // /api/tasks/<uuid>/job-payload — read by n8n's J3 (manual evaluator).
  /^\/api\/tasks\/[0-9a-f-]{36}\/job-payload\/?$/i,
];

export default auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PATH_PATTERNS.some((re) => re.test(path))) {
    return; // let the route handler run unauthenticated
  }

  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", path);
    return Response.redirect(loginUrl);
  }

  const role = req.auth.user?.role;

  // Cross-role task-board deep-link normalization. A shared card URL carries
  // ?task=<uuid> (and sometimes ?board=). Without this an agent opening an
  // admin /tasks link bounces to /my-dashboard (losing the card), and an admin
  // opening an agent /my-tasks link hits the "Not logged in as an agent" page.
  // Map each role to its own task route, PRESERVING the query + any sub-path,
  // so a card link shared in either direction just opens.
  if (role === "agent" && (path === "/tasks" || path.startsWith("/tasks/"))) {
    const dest = req.nextUrl.clone();
    dest.pathname = "/my-tasks" + path.slice("/tasks".length);
    return Response.redirect(dest);
  }
  if (role !== "agent" && (path === "/my-tasks" || path.startsWith("/my-tasks/"))) {
    const dest = req.nextUrl.clone();
    dest.pathname = "/tasks" + path.slice("/my-tasks".length);
    return Response.redirect(dest);
  }

  // Redirect agents away from the remaining admin routes
  if (role === "agent") {
    const isAdminRoute = ADMIN_ROUTES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
    if (isAdminRoute) {
      return Response.redirect(new URL("/my-dashboard", req.url));
    }
  }
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/agents/:path*",
    "/profiles/:path*",
    "/jobs/:path*",
    "/settings/:path*",
    "/pipeline/:path*",
    "/connects/:path*",
    "/alerts/:path*",
    "/api/stats/:path*",
    "/api/sync/sheets",
    "/api/jobs/:path*",
    "/api/settings/:path*",
    "/analytics/:path*",
    "/my-dashboard/:path*",
    "/my-jobs/:path*",
    "/my-performance/:path*",
    "/my-pipeline/:path*",
    "/my-connects/:path*",
    "/my-analytics/:path*",
    "/tasks/:path*",
    "/my-tasks/:path*",
    "/my-profiles/:path*",
    "/api/projects/:path*",
    "/api/tasks/:path*",
    "/relevancy-audit/:path*",
    "/api/relevancy-audit/:path*",
    "/relevancy-evaluator/:path*",
    "/api/relevancy/:path*",
    "/api/admin/:path*",
  ],
};
