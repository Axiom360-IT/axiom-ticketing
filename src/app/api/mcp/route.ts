import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpToken } from "@/lib/auth/mcp-tokens";
import { buildMcpServer } from "@/lib/mcp/server";

// Claude/MCP connector endpoint. Stateless: a fresh server + transport is
// built for every request (no session persistence between calls), which
// matches Vercel's serverless model and keeps this simple — each tool call
// re-validates the token and the caller's permissions on its own anyway, so
// nothing is lost by not carrying state across requests.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

async function handle(req: Request): Promise<Response> {
  const token = bearerToken(req);
  const user = token ? await resolveMcpToken(token) : null;
  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const server = buildMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
