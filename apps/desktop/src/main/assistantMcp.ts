/**
 * The real MCP transports, kept separate so policy and persistence can be tested offline.
 *
 * A connector arrives here with its values already decrypted. Where they go depends on
 * the transport, and each is handled the way that transport actually works:
 *
 * - stdio: the values are environment variables for the child process. The SDK replaces
 *   the environment entirely when `env` is given, so the default environment is merged
 *   back in - otherwise `PATH` disappears and `npx` stops resolving;
 * - HTTP: the values are headers on every request;
 * - SSE (the older transport, still in use): the values are headers on the POSTs, and
 *   the stream request needs a fetch of its own, because the EventSource API has no way
 *   to set headers at all.
 *
 * A remote server that publishes OAuth metadata gets a signed fetch instead (`mcpOAuth.ts`):
 * every request carries the connector's bearer token, refreshed as it nears expiry and on a
 * 401. Without a sign-in yet, connecting stops and says so - the card offers Sign in.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { OAUTH_CLIENT_ID_KEY, OAUTH_CLIENT_SECRET_KEY } from "@adcode/connect";
import type { AssistantConnectRequest, McpSession, RemoteTool } from "./assistantControlsService.ts";
import { discoverProtectedResource, mcpAuthFetch, McpSignInRequired } from "./mcpOAuth.ts";

/**
 * The fetch a remote connector signs its requests with, or null when it needs none. A saved
 * Authorization value wins: whoever pasted a key meant it to be used.
 */
async function remoteAuth(request: AssistantConnectRequest): Promise<FetchLike | null> {
  if (Object.keys(request.values).some((key) => key.toLowerCase() === "authorization")) return null;
  const signed = await mcpAuthFetch(request.server.id);
  if (signed !== null) return signed;
  if (await discoverProtectedResource(request.server.endpoint).catch(() => null)) throw new McpSignInRequired(request.server.name);
  return null;
}

export async function connectAssistantMcp(request: AssistantConnectRequest, onClose: () => void): Promise<McpSession> {
  const { server, values } = request;
  const client = new Client({ name: "adcode-assistant", version: "1.0.2" }, { capabilities: {} });
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  let signedFetch: FetchLike | null = null;
  if (server.transport === "stdio") {
    transport = new StdioClientTransport({
      command: server.endpoint,
      args: [...server.args],
      env: { ...getDefaultEnvironment(), ...values },
      stderr: "ignore",
      maxBufferSize: 2_000_000,
    });
  } else {
    // A hand-entered OAuth client is for sign-in, not a header to send to the server.
    const { [OAUTH_CLIENT_ID_KEY]: _id, [OAUTH_CLIENT_SECRET_KEY]: _secret, ...headers } = values;
    const signed = await remoteAuth(request);
    signedFetch = signed;
    const base: FetchLike = signed ?? ((url, init) => fetch(url, init));
    if (server.transport === "sse") {
      const withHeaders: FetchLike = (url, init) => base(url, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
      transport = new SSEClientTransport(new URL(server.endpoint), { eventSourceInit: { fetch: withHeaders }, requestInit: { headers, redirect: "error" }, ...(signed ? { fetch: signed } : {}) });
    } else {
      transport = new StreamableHTTPClientTransport(new URL(server.endpoint), { requestInit: { headers, redirect: "error" }, ...(signed ? { fetch: signed } : {}) });
    }
  }
  client.onclose = onClose;
  // Revoke the cached tool catalogue immediately when its definitions change.
  // Reconnect discovers the new signatures and requires re-enabling changed tools.
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    onClose();
    await client.close();
  });
  try {
    // SDK HTTP transport declares sessionId as string | undefined while its own
    // Transport interface uses an optional string (exactOptionalPropertyTypes).
    await client.connect(transport as Transport, { timeout: 12_000 });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return {
    signedIn: server.transport !== "stdio" && signedFetch !== null,
    async list() {
      const tools: RemoteTool[] = [];
      const names = new Set<string>();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 12_000 });
        for (const tool of page.tools) {
          if (names.has(tool.name)) continue;
          if (tools.length >= 500) throw new Error("Server exposes more than 500 tools. Limit its tool list and reconnect.");
          names.add(tool.name);
          const entry = { name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema };
          if (JSON.stringify(entry).length > 20_000) throw new Error(`Tool ${tool.name} has a schema too large for discovery.`);
          tools.push(entry);
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("Server repeated a tool-list cursor.");
        if (cursor) cursors.add(cursor);
        if (cursors.size > 30) throw new Error("Server tool pagination exceeded 30 pages.");
      } while (cursor);
      return tools;
    },
    async call(name, args, signal) {
      const response = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30_000, maxTotalTimeout: 30_000 });
      const blocks = Array.isArray(response.content) ? response.content : [];
      const text = blocks.map((block: Record<string, unknown>) => {
        if (block["type"] === "text") return String(block["text"] ?? "");
        if (block["type"] === "resource" && typeof block["resource"] === "object" && block["resource"] !== null) {
          const resource = block["resource"] as Record<string, unknown>;
          return typeof resource["text"] === "string" ? resource["text"] : `[Resource: ${String(resource["uri"] ?? "unknown")}]`;
        }
        if (block["type"] === "resource_link") return `[Resource: ${String(block["name"] ?? "")} ${String(block["uri"] ?? "")}]`;
        return `[${String(block["type"] ?? "Unknown")} content returned; this assistant currently displays MCP text results.]`;
      }).join("\n");
      return { content: text || JSON.stringify(response.structuredContent ?? {}), isError: response.isError === true };
    },
    close: () => client.close(),
  };
}
