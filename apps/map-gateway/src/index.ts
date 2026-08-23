const ATTRIBUTION = "© OpenStreetMap contributors";

export default {
  async fetch(request, env): Promise<Response> {
    if (request.method === "OPTIONS") return preflight(request, env);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return withCors(request, env, new Response("Method not allowed", { status: 405 }));
    }
    const url = new URL(request.url);
    if (url.search) {
      return withCors(
        request,
        env,
        new Response("Map requests do not accept query parameters", { status: 400 }),
      );
    }
    if (url.pathname === "/health") {
      return withCors(request, env, json({ ok: true, dataset: env.PMTILES_VERSION }));
    }
    if (url.pathname === "/style.json") {
      return serveStyle(request, env, url, env.PMTILES_VERSION, false);
    }
    const versionedStyle = /^\/styles\/([0-9]{4}-[0-9]{2})\/style\.json$/u.exec(url.pathname);
    if (versionedStyle?.[1]) {
      return serveStyle(request, env, url, versionedStyle[1], true);
    }
    if (url.pathname === "/maps/global.pmtiles") {
      return serveObject(request, env, `basemap/${env.PMTILES_VERSION}/global.pmtiles`, false);
    }
    const versionedMap = /^\/maps\/([0-9]{4}-[0-9]{2})\/global\.pmtiles$/u.exec(url.pathname);
    if (versionedMap?.[1]) {
      return serveObject(request, env, `basemap/${versionedMap[1]}/global.pmtiles`, true);
    }
    const versionedAsset = /^\/assets\/([0-9]{4}-[0-9]{2})\/(.+)$/u.exec(url.pathname);
    const versionedAssetPath = versionedAsset?.[2] ? decodeAssetPath(versionedAsset[2]) : undefined;
    if (versionedAsset?.[1] && versionedAssetPath) {
      return serveObject(
        request,
        env,
        `basemap/${versionedAsset[1]}/assets/${versionedAssetPath}`,
        true,
      );
    }
    const asset = /^\/assets\/(.+)$/u.exec(url.pathname);
    const assetPath = asset?.[1] ? decodeAssetPath(asset[1]) : undefined;
    if (assetPath) {
      return serveObject(request, env, `basemap/${env.PMTILES_VERSION}/assets/${assetPath}`, false);
    }
    return withCors(request, env, new Response("Not found", { status: 404 }));
  },
} satisfies ExportedHandler<Env>;

export function decodeAssetPath(encodedPath: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return undefined;
  }
  const segments = path.split("/");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return undefined;
  }
  return path;
}

async function serveStyle(
  request: Request,
  env: Env,
  url: URL,
  version: string,
  immutable: boolean,
): Promise<Response> {
  const object = await env.MAPS.get(`basemap/${version}/style.json`);
  if (object) {
    const style = await object.text();
    const rendered = style
      .replaceAll("{{PMTILES_URL}}", `${url.origin}/maps/${version}/global.pmtiles`)
      .replaceAll("{{ASSET_ORIGIN}}", `${url.origin}/assets/${version}`);
    return withCors(
      request,
      env,
      new Response(rendered, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": immutable
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, stale-while-revalidate=3600",
          etag: object.httpEtag,
        },
      }),
    );
  }
  return withCors(
    request,
    env,
    json(
      {
        version: 8,
        name: "Enigma fallback",
        sources: {
          protomaps: {
            type: "vector",
            url: `pmtiles://${url.origin}/maps/${version}/global.pmtiles`,
            attribution: ATTRIBUTION,
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#e9eef5" } },
        ],
      },
      { status: 503, headers: { "retry-after": "300" } },
    ),
  );
}

async function serveObject(
  request: Request,
  env: Env,
  key: string,
  immutable: boolean,
): Promise<Response> {
  const object = await env.MAPS.get(key, { range: request.headers });
  if (!object) return withCors(request, env, new Response("Map object not found", { status: 404 }));
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set(
    "cache-control",
    immutable
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, stale-while-revalidate=86400",
  );
  const range = request.headers.get("range");
  const status = range ? 206 : 200;
  if (range && object.range) {
    const contentRange = contentRangeHeader(object.range, object.size);
    if (contentRange) headers.set("content-range", contentRange);
  }
  return withCors(
    request,
    env,
    new Response(request.method === "HEAD" ? null : object.body, { status, headers }),
  );
}

export function contentRangeHeader(range: R2Range, size: number): string | undefined {
  if ("offset" in range && range.offset !== undefined) {
    const length = range.length ?? size - range.offset;
    return `bytes ${range.offset}-${range.offset + length - 1}/${size}`;
  }
  if ("suffix" in range && range.suffix !== undefined) {
    const length = Math.min(range.suffix, size);
    return `bytes ${size - length}-${size - 1}/${size}`;
  }
  return undefined;
}

function preflight(request: Request, env: Env): Response {
  const response = new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Range, If-None-Match",
      "access-control-max-age": "86400",
    },
  });
  return withCors(request, env, response);
}

function withCors(request: Request, env: Env, response: Response): Response {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  if (origin && allowed.includes(origin)) {
    response.headers.set("access-control-allow-origin", origin);
    response.headers.set("vary", "Origin");
    response.headers.set(
      "access-control-expose-headers",
      "Accept-Ranges, Content-Length, Content-Range, ETag",
    );
  }
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("permissions-policy", "geolocation=()");
  return response;
}

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}
