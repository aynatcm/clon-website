import { features } from "@/lib/env";

/** Run a DB query, returning `fallback` if the DB is unconfigured/unreachable. */
export async function safeDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!features.db) return fallback;
  try {
    return await fn();
  } catch (err) {
    console.error("[db] query failed:", (err as Error).message);
    return fallback;
  }
}

export const dbReady = features.db;
