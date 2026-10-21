import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { credential } from "@aihot/backend/config";
import { XINHUA_ALLOWED_TOOLS } from "./catalog.ts";

export class ExpertProviderError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export type XinhuaCall = (tool: typeof XINHUA_ALLOWED_TOOLS[number], args: Record<string, unknown>) => Promise<unknown>;

function endpoint() {
  const raw = process.env.XINHUA_MCP_COMPANY_URL || "https://mcp.cnfic.com.cn/bdc-mcp-service/mcp/zjs_company/http/";
  let url: URL;
  try { url = new URL(raw); } catch { throw new ExpertProviderError("xinhua_endpoint_invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "mcp.cnfic.com.cn") throw new ExpertProviderError("xinhua_endpoint_invalid");
  return url;
}

export async function withXinhua<T>(run: (call: XinhuaCall) => Promise<T>): Promise<T> {
  const token = credential("collectors", "XINHUA_MCP_API_KEY");
  if (!token) throw new ExpertProviderError("xinhua_not_configured");
  const transport = new StreamableHTTPClientTransport(endpoint(), {
    requestInit: { headers: { authorization: `Bearer ${token}` }, redirect: "error" },
  });
  const client = new Client({ name: "citic-private-newsfeed-expert", version: "1.0.0" });
  try {
    await client.connect(transport);
    const toolset = new Set((await client.listTools()).tools.map(tool => tool.name));
    return await run(async (tool, args) => {
      if (!XINHUA_ALLOWED_TOOLS.includes(tool) || !toolset.has(tool)) throw new ExpertProviderError("xinhua_tool_unavailable");
      const result = await client.callTool({ name: tool, arguments: args });
      if (result.isError) throw new ExpertProviderError("xinhua_tool_failed");
      if (result.structuredContent !== undefined) return result.structuredContent;
      const text = result.content.filter((item): item is { type: "text"; text: string } => item.type === "text").map(item => item.text).join("\n");
      try { return JSON.parse(text) as unknown; }
      catch { throw new ExpertProviderError("xinhua_response_invalid"); }
    });
  } catch (error) {
    if (error instanceof ExpertProviderError) throw error;
    throw new ExpertProviderError("xinhua_unavailable");
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}
