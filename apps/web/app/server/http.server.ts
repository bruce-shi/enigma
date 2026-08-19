import type { RouterContextProvider } from "react-router";
import { createAuth } from "./auth.server";
import { cloudflareRequestContext } from "./context.server";

export function envFrom(context: Readonly<RouterContextProvider>): Env {
  return context.get(cloudflareRequestContext).env;
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new Response("application/json required", { status: 415 });
  }
  try {
    return await request.json();
  } catch {
    throw new Response("invalid JSON", { status: 400 });
  }
}

export function assertSameOrigin(request: Request, env: Env): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(env.PUBLIC_ORIGIN).origin) {
    throw new Response("invalid origin", { status: 403 });
  }
}

export async function getSession(request: Request, env: Env) {
  return createAuth(env).api.getSession({ headers: request.headers });
}

export async function requireSession(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) throw new Response("authentication required", { status: 401 });
  return session;
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) throw new Response("bearer token required", { status: 401 });
  return match[1];
}
