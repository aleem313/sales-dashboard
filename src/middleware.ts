import { auth } from "@/lib/auth";

// Admin-only route prefixes — agents get redirected
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks", "/relevancy-audit", "/relevancy-evaluator"];

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

  // Redirect agents away from admin routes
  const role = req.auth.user?.role;
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
