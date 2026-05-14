import { Pool, neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzlePool } from "drizzle-orm/neon-serverless";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// ── HTTP driver — the default `db` used by reads + non-tx writes ───────
//
// Each query is a single HTTPS POST to Neon's gateway, no connection state
// to manage. This is the safe default for Next.js dev where HMR can leave
// long-lived sockets in a half-dead state — switching back to HTTP for
// non-tx queries fixes the "Failed query" errors that appeared after every
// edit when the whole app ran through a WS Pool.
//
// Bounded retry on transient errors:
//  - `TypeError: fetch failed` (DNS/connect blip, Neon cold-start)
//  - HTTP 5xx responses from Neon (gateway hiccups, Postgres restart)
//  - HTTP 408 / 429 (timeout, rate limit) — back off and try again
//
// In dev we additionally log the underlying cause loudly, because
// Drizzle wraps every query failure as `Failed query: select …` and the
// real reason (fetch error, 503 body, etc.) is otherwise invisible to
// anyone reading the browser console.
const RETRY_DELAYS_MS = [200, 600, 1500];
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const isDev = process.env.NODE_ENV !== "production";

function isTransientFetchError(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "TypeError" &&
    err.message === "fetch failed"
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    let out = `${err.name}: ${err.message}`;
    // AggregateError (thrown by Node's native fetch when multiple
    // connection attempts fail — typically IPv6 then IPv4) stores its
    // individual failures on `.errors[]`, not `.cause`.
    const inner = (err as { errors?: unknown[] }).errors;
    if (Array.isArray(inner) && inner.length > 0) {
      out += ` | inner=[${inner.map((e) => describeError(e)).join("; ")}]`;
    }
    if ("cause" in err && err.cause) {
      out += ` | cause=${describeError(err.cause)}`;
    }
    return out;
  }
  return String(err);
}

neonConfig.fetchFunction = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(input, init);
      // Transient HTTP statuses: read body once for the dev log, then
      // retry with the cached body so the driver still sees a Response.
      if (TRANSIENT_HTTP_STATUSES.has(res.status)) {
        const body = await res.clone().text().catch(() => "<no body>");
        if (isDev) {
          console.warn(
            `[neon-http] HTTP ${res.status} on attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}: ${body.slice(0, 300)}`,
          );
        }
        if (attempt === RETRY_DELAYS_MS.length) return res;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (isDev) {
        console.warn(
          `[neon-http] fetch threw on attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}: ${describeError(err)}`,
        );
      }
      if (!isTransientFetchError(err) || attempt === RETRY_DELAYS_MS.length) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
};

const sql = neon(process.env.DATABASE_URL);
export const db = drizzleHttp(sql, { schema });
export type Database = typeof db;

// ── WebSocket Pool — used ONLY for transactions ────────────────────────
//
// The HTTP driver has no notion of BEGIN/COMMIT, so anything that needs
// atomicity goes through this Pool. We lazy-create on first use so the
// common path (HTTP reads) never opens a WebSocket. In Node (our server
// actions runtime) there's no global `WebSocket`, so wire up `ws`.
neonConfig.webSocketConstructor = ws;

// Cache on globalThis so HMR doesn't leak a fresh Pool per edit.
type GlobalWithPool = typeof globalThis & { __neonPool?: Pool };
const globalForPool = globalThis as GlobalWithPool;

function getPool(): Pool {
  if (!globalForPool.__neonPool) {
    globalForPool.__neonPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
  }
  return globalForPool.__neonPool;
}

type Schema = typeof schema;
export type Tx = PgTransaction<
  NeonQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

/**
 * Run `fn` inside a Postgres transaction. Use this in place of
 * `db.transaction(...)` — `db` is the HTTP driver and doesn't support
 * BEGIN/COMMIT. Anything atomic must go through here.
 */
export function transactional<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const dbTx = drizzlePool(getPool(), { schema });
  return dbTx.transaction(fn);
}
