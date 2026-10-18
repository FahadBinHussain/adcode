/**
 * An OpenAPI description, connected like an MCP server.
 *
 * ChatGPT plugins and GPT Actions - and most modern "connectors" - are not MCP servers;
 * they are REST APIs with a machine-readable description. To the assistant they should
 * look the same as everything else, so this turns one into the `McpSession` the rest of
 * the app already knows: `list()` reads the description's operations, `call()` builds the
 * one HTTP request that operation describes and sends it.
 *
 * Nothing here decides policy. Whether the person may call this tool at all, and whether
 * this particular call is approved, is settled before `call()` is reached (same as MCP).
 * The only judgement made here is transport-level: HTTPS only, no redirects, a timeout,
 * and a capped response body.
 */
import { BASE_URL_KEY, buildOperationRequest, openApiTools, parseOpenApi, renderHttpResult, type ParsedOpenApi } from "@adcode/connect";
import type { AssistantServerRecord } from "../shared/assistantControls.ts";
import type { McpSession, RemoteTool } from "./assistantControlsService.ts";

const CALL_TIMEOUT_MS = 30_000;
/** Enough for any real JSON answer; the service shortens it further for the model. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface OpenApiConnection {
  readonly server: AssistantServerRecord;
  /** The connector's stored values: `token` and possibly `__base_url`. */
  readonly values: Readonly<Record<string, string>>;
}

/** Why this connector cannot be used yet, in one sentence, or null when it is ready. */
export function openApiConnectionProblem(connection: OpenApiConnection): string | null {
  const { server, values } = connection;
  if (server.spec === null) return "The API description was not saved with this connector. Add it again from its file or URL.";
  if (baseUrl(connection) === "") return "This connector has no server address yet. Add its address, then reconnect.";
  const auth = server.auth;
  if (auth !== null && auth.needsToken && (values["token"] ?? "") === "") return "This connector needs a token. Add it, then reconnect.";
  return null;
}

function baseUrl(connection: OpenApiConnection): string {
  const declared = connection.values[BASE_URL_KEY] ?? "";
  return connection.server.endpoint !== "" ? connection.server.endpoint : declared;
}

/** The connection as the session the service speaks to. Throws with a sentence when unusable. */
export function createOpenApiSession(connection: OpenApiConnection): McpSession {
  const problem = openApiConnectionProblem(connection);
  if (problem !== null) throw new Error(problem);
  let doc: ParsedOpenApi;
  try {
    doc = parseOpenApi(connection.server.spec!);
  } catch (error) {
    throw new Error(error instanceof Error ? `This connector's API description cannot be read: ${error.message}` : "This connector's API description cannot be read.");
  }

  const tools: RemoteTool[] = openApiTools(doc).map(tool => ({
    name: tool.name,
    description: tool.description !== "" ? tool.description : `${tool.inputSchema["title"]?.toString() ?? tool.name}`,
    inputSchema: tool.inputSchema,
  }));
  const byName = new Map(doc.operations.map(operation => [operation.name, operation]));

  return {
    async list(): Promise<RemoteTool[]> {
      return tools;
    },

    async call(name, args, signal) {
      const operation = byName.get(name);
      if (operation === undefined) return { content: `This API does not describe an operation named ${name}. Reconnect the connector if the description changed.`, isError: true };

      let request;
      try {
        request = buildOperationRequest(operation, args, { baseUrl: baseUrl(connection), auth: connection.server.auth, token: connection.values["token"] ?? null });
      } catch (error) {
        // A missing or wrong argument is the model's to correct, so it comes back as a
        // readable tool result rather than a connection failure.
        return { content: error instanceof Error ? error.message : "The arguments could not be turned into a request.", isError: true };
      }

      const controller = new AbortController();
      const onAbort = (): void => controller.abort(signal.reason);
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error("The API did not answer in time.")), CALL_TIMEOUT_MS);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: { Accept: "application/json, text/plain;q=0.8, */*;q=0.5", ...request.headers },
          ...(request.body === null ? {} : { body: request.body }),
          redirect: "error",
          signal: controller.signal,
        });
        const body = await readCapped(response);
        return renderHttpResult(response.status, response.statusText, response.headers.get("content-type") ?? "", body);
      } catch (error) {
        const reason = signal.aborted ? "The call was cancelled." : controller.signal.aborted ? "The API did not answer in time." : error instanceof Error ? error.message : "The request failed.";
        return { content: `The request to ${request.url} did not complete: ${reason}`, isError: true };
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      }
    },

    async close(): Promise<void> {
      // REST calls hold no connection. Nothing to close.
    },
  };
}

/** Read a body up to the cap, so a streaming endpoint cannot fill memory. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let text = "";
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    if (text.length + value.byteLength > MAX_RESPONSE_BYTES) {
      text += decoder.decode(value.subarray(0, Math.max(0, MAX_RESPONSE_BYTES - text.length)));
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return truncated ? `${text}\n[The response was larger than 512 KB and was cut here.]` : text;
}
