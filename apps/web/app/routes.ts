import { index, type RouteConfig, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/city-map.svg", "routes/city-map-svg.ts"),
  route("api/city-map.json", "routes/city-map-json.ts"),
  route("api/city-map.pack", "routes/city-map-pack.ts"),
  route("docs", "routes/docs-layout.tsx", [
    index("routes/docs-index.tsx"),
    route(":slug", "routes/docs-page.tsx"),
  ]),
] satisfies RouteConfig;
