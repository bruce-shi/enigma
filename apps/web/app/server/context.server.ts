import { createContext } from "react-router";

export interface CloudflareRequestContext {
  env: Env;
  ctx: ExecutionContext;
}

export const cloudflareRequestContext = createContext<CloudflareRequestContext>();
