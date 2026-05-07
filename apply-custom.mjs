import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(".env.local", "utf8");
const dburl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = neon(dburl);

await sql`CREATE SEQUENCE IF NOT EXISTS ax_ticket_seq`;
await sql`
  CREATE OR REPLACE FUNCTION generate_ticket_number() RETURNS text AS $$
    SELECT 'AX-' || LPAD(nextval('ax_ticket_seq')::text, 4, '0');
  $$ LANGUAGE SQL VOLATILE
`;

const result = await sql`SELECT generate_ticket_number() AS num`;
console.log("Ticket number generator works:", result[0].num);
