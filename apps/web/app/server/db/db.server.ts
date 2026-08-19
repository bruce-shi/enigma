import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export function createDb(env: Pick<Env, "DB">) {
  return drizzle(env.DB, { schema });
}

export type EnigmaDatabase = ReturnType<typeof createDb>;
