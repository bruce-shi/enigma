export type DesktopRoute = "workspace" | "settings";

export function desktopRouteFromHash(hash: string): DesktopRoute {
  const path = hash.replace(/^#/u, "").replace(/\/+$/u, "") || "/";
  return path === "/settings" ? "settings" : "workspace";
}

export function desktopRouteHash(route: DesktopRoute): string {
  return route === "settings" ? "#/settings" : "#/";
}
