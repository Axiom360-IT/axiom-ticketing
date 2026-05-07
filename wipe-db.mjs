import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(".env.local", "utf8");
const dburl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();

const sql = neon(dburl);
await sql`DROP SCHEMA public CASCADE`;
await sql`CREATE SCHEMA public`;
await sql`GRANT ALL ON SCHEMA public TO PUBLIC`;

const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
console.log("Wiped. Tables remaining:", rows.length === 0 ? "(none — clean)" : rows.map(r => r.tablename));
