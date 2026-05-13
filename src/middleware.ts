import { auth } from "@/lib/auth";

// Admin-only route prefixes — agents get redirected
const ADMIN_ROUTES = ["/dashboard", "/pipeline", "/connects", "/analytics", "/alerts", "/agents", "/profiles", "/jobs", "/settings", "/tasks", "/relevancy-audit", "/relevancy-evaluator"];

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return Response.redirect(loginUrl);
  }

  // Redirect agents away from admin routes
  const role = req.auth.user?.role;
  if (role === "agent") {
    const path = req.nextUrl.pathname;
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
  ],
};
