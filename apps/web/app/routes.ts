import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("sign-in", "routes/sign-in.tsx"),
  route("dashboard", "routes/dashboard.tsx"),
  route("desktop/authorize", "routes/desktop-authorize.tsx"),
  route("api/auth/*", "routes/api-auth.ts"),
  route("api/desktop/auth/init", "routes/api-desktop-auth-init.ts"),
  route("api/desktop/token", "routes/api-desktop-token.ts"),
  route("api/desktop/entitlement", "routes/api-desktop-entitlement.ts"),
  route("api/desktop/activations", "routes/api-desktop-activations.ts"),
  route("api/crashes", "routes/api-crashes.ts"),
  route("privacy", "routes/privacy.tsx"),
  route("terms", "routes/terms.tsx"),
] satisfies RouteConfig;
