import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

// Neon's HTTP driver opens a fresh connection per query — no pool to manage.
// This works cleanly with Vercel's serverless function model.
const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export type Database = typeof db;
