import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("docs", "routes/docs-layout.tsx", [
    index("routes/docs-index.tsx"),
    route(":slug", "routes/docs-page.tsx"),
  ]),
] satisfies RouteConfig;
