import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantServerRecord } from "../src/shared/assistantControls.ts";
import { createOpenApiSession, openApiConnectionProblem, type OpenApiConnection } from "../src/main/openapiSession.ts";

/**
 * The session that makes a REST API - a ChatGPT plugin, a GPT Action, any OpenAPI
 * description - look like an MCP server to the rest of the app.
 *
 * The network is stubbed: what matters here is which request gets built from which
 * arguments, what an answer turns into, and that every failure comes back as a readable
 * tool result rather than an exception.
 */

const spec = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Issue Tracker", version: "2.0.0" },
  servers: [{ url: "https://issues.example.com/v1" }],
  paths: {
    "/issues": {
      get: {
        operationId: "listIssues",
        summary: "List issues",
        parameters: [{ name: "query", in: "query", schema: { type: "string" } }],
      },
      post: {
        operationId: "createIssue",
        summary: "Create an issue",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title"], properties: { title: { type: "string" }, label: { type: "string" } } } } } },
      },
    },
    "/issues/{issueId}": {
      get: { operationId: "showIssue", parameters: [{ name: "issueId", in: "path", required: true, schema: { type: "string" } }] },
    },
  },
});

function server(overrides: Partial<AssistantServerRecord> = {}): AssistantServerRecord {
  return {
    id: "issue-tracker",
    name: "Issue Tracker",
    transport: "http",
    endpoint: "https://issues.example.com/v1",
    args: [],
    kind: "openapi",
    origin: "actions",
    source: "Imported link: issues.example.com",
    purpose: "",
    valueKeys: [],
    spec,
    auth: null,
    homepage: null,
    root: null,
    version: null,
    ...overrides,
  };
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn((input: string | URL, init?: RequestInit) => Promise.resolve(handler(String(input), init)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("openApiConnectionProblem", () => {
  const connection = (overrides: Partial<OpenApiConnection>): OpenApiConnection => ({ server: server(), values: {}, ...overrides });

  it("names what is missing before a connection is attempted", () => {
    expect(openApiConnectionProblem(connection({ server: server({ spec: null }) }))).toContain("was not saved");
    expect(openApiConnectionProblem(connection({ server: server({ endpoint: "" }) }))).toContain("no server address");
    const needsToken = server({ auth: { kind: "bearer", name: null, needsToken: true } });
    expect(openApiConnectionProblem(connection({ server: needsToken }))).toContain("needs a token");
    expect(openApiConnectionProblem(connection({ server: needsToken, values: { token: "t" } }))).toBeNull();
    // The address may have been answered in the Add dialog instead of coming from the description.
    expect(openApiConnectionProblem(connection({ server: server({ endpoint: "" }), values: { __base_url: "https://alt.example.com" } }))).toBeNull();
  });

  it("throws the same sentence when a session is built on a problem", () => {
    expect(() => createOpenApiSession({ server: server({ spec: null }), values: {} })).toThrow("was not saved");
  });
});

describe("createOpenApiSession", () => {
  it("lists the description's operations as tools", async () => {
    const session = createOpenApiSession({ server: server(), values: {} });
    const tools = await session.list();
    expect(tools.map(tool => tool.name)).toEqual(["listIssues", "createIssue", "showIssue"]);
    expect(tools[0]).toMatchObject({ description: "GET /issues - List issues" });
    expect(tools[0]?.inputSchema).toMatchObject({ type: "object" });
    await session.close();
  });

  it("sends the request the operation describes and renders the answer", async () => {
    const fetch = stubFetch(() => json({ issues: [{ id: 7 }] }));
    const session = createOpenApiSession({ server: server(), values: {} });
    const result = await session.call("listIssues", { query: "flaky" }, signal());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://issues.example.com/v1/issues?query=flaky");
    expect(init?.method).toBe("GET");
    expect(result.isError).toBe(false);
    expect(result.content).toContain("HTTP 200");
    expect(result.content).toContain('"id": 7');
  });

  it("adds the stored token as a bearer header, and the answered address as the base", async () => {
    const fetch = stubFetch(() => json({ ok: true }));
    const session = createOpenApiSession({
      server: server({ endpoint: "", auth: { kind: "bearer", name: null, needsToken: true } }),
      values: { token: "secret-token", __base_url: "https://alt.example.com" },
    });
    await session.call("listIssues", {}, signal());
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://alt.example.com/issues");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-token");
  });

  it("sends a JSON body for a create operation", async () => {
    const fetch = stubFetch(() => json({ id: 8 }, 201));
    const session = createOpenApiSession({ server: server(), values: {} });
    const result = await session.call("createIssue", { title: "Crash on save", label: "bug" }, signal());
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://issues.example.com/v1/issues");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"title":"Crash on save","label":"bug"}');
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(result.isError).toBe(false);
    expect(result.content).toContain("HTTP 201");
  });

  it("returns a readable result when an argument is missing or the operation is unknown", async () => {
    const fetch = stubFetch(() => json({}));
    const session = createOpenApiSession({ server: server(), values: {} });
    const missing = await session.call("showIssue", {}, signal());
    expect(missing.isError).toBe(true);
    expect(missing.content).toContain("issueId");
    const unknown = await session.call("deleteEverything", {}, signal());
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toContain("does not describe");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps HTTP failures, transport failures and cancellation as tool results", async () => {
    stubFetch(() => new Response("gone", { status: 404, statusText: "Not Found" }));
    const session = createOpenApiSession({ server: server(), values: {} });
    const notFound = await session.call("listIssues", {}, signal());
    expect(notFound.isError).toBe(true);
    expect(notFound.content).toContain("HTTP 404");

    stubFetch(() => Promise.reject(new Error("fetch failed")));
    const offline = await session.call("listIssues", {}, signal());
    expect(offline.isError).toBe(true);
    expect(offline.content).toContain("did not complete");
    expect(offline.content).toContain("fetch failed");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await createOpenApiSession({ server: server(), values: {} }).call("listIssues", {}, controller.signal);
    expect(cancelled.isError).toBe(true);
    expect(cancelled.content).toContain("cancelled");
  });

  it("cuts a response larger than the 512 KB cap", async () => {
    stubFetch(() => new Response("x".repeat(600_000), { status: 200 }));
    const result = await createOpenApiSession({ server: server(), values: {} }).call("listIssues", {}, signal());
    expect(result.content).toContain("was larger than 512 KB");
    expect(result.content.length).toBeLessThan(512 * 1024 + 200);
  });
});
