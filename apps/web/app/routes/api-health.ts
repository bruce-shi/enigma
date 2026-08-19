import type { LoaderFunctionArgs } from "react-router";
import { envFrom, json } from "../server/http.server";
import { getPublicReleaseConfig } from "../server/public-config.server";
import { buildHealthPayload } from "../server/public-health.server";

export function loader({ request, context }: LoaderFunctionArgs) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const config = getPublicReleaseConfig(envFrom(context));
  const payload = buildHealthPayload(config);
  if (request.method === "HEAD") {
    return new Response(null, {
      headers: { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" },
    });
  }
  return json(payload);
}
