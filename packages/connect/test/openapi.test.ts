import { describe, expect, it } from "vitest";
import { buildOperationRequest, openApiTools, operationNameFrom, parseOpenApi, renderHttpResult, sanitizeOperationId } from "../src/openapi.ts";

const spec = {
  openapi: "3.0.3",
  info: { title: "Pet Store", version: "1.4.0" },
  servers: [{ url: "https://pets.example.com/api/v1" }],
  security: [{ bearer: [] }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "List pets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
          { name: "tags", in: "query", schema: { type: "array", items: { type: "string" } } },
        ],
      },
      post: {
        summary: "Create a pet",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
      },
    },
    "/pets/{petId}": {
      get: {
        operationId: "showPetById",
        parameters: [
          { name: "petId", in: "path", required: true, schema: { type: "string" } },
          { name: "X-Trace", in: "header", schema: { type: "string" } },
        ],
      },
      delete: { operationId: "showPetById", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }] },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          tag: { $ref: "#/components/schemas/Tag" },
          friend: { $ref: "#/components/schemas/Pet" },
        },
      },
      Tag: { type: "object", properties: { id: { type: "integer" } } },
    },
  },
};

const noAuth = { baseUrl: "", auth: null, token: null };

describe("parseOpenApi", () => {
  const doc = parseOpenApi(JSON.stringify(spec));

  it("reads the document's name, version and server", () => {
    expect(doc.title).toBe("Pet Store");
    expect(doc.version).toBe("1.4.0");
    expect(doc.baseUrl).toBe("https://pets.example.com/api/v1");
  });

  it("turns every operation into a named tool", () => {
    expect(doc.operations.map(operation => operation.name)).toEqual(["listPets", "post_pets", "showPetById", "showPetById_2"]);
    expect(openApiTools(doc).map(tool => tool.name)).toEqual(["listPets", "post_pets", "showPetById", "showPetById_2"]);
  });

  it("builds input schemas from parameters, with a fallback type", () => {
    const list = doc.operations[0]!;
    const properties = list.inputSchema["properties"] as Record<string, Record<string, unknown>>;
    expect(properties["limit"]).toMatchObject({ type: "integer", maximum: 100 });
    expect(properties["tags"]).toMatchObject({ type: "array", items: { type: "string" } });
    expect(list.inputSchema["required"]).toBeUndefined();
    const show = doc.operations[2]!;
    expect(show.inputSchema["required"]).toEqual(["petId"]);
  });

  it("merges a JSON body into the input object, resolving $refs and surviving cycles", () => {
    const create = doc.operations[1]!;
    const properties = create.inputSchema["properties"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(properties)).toEqual(["name", "tag", "friend"]);
    expect(create.inputSchema["required"]).toEqual(["name"]);
    expect((properties["tag"]?.["properties"] as Record<string, unknown>)["id"]).toMatchObject({ type: "integer" });
    expect(properties["friend"]).toMatchObject({ type: "object", additionalProperties: true });
  });

  it("names unnamed operations from method and path, and sanitizes odd operationIds", () => {
    expect(operationNameFrom("get", "/users/{id}/posts")).toBe("get_users_id_posts");
    expect(sanitizeOperationId("users.list-everything!")).toBe("users_list_everything");
    expect(sanitizeOperationId("1/2")).toBe("call_1_2");
  });

  it("refuses documents that are not OpenAPI, and notes declared security", () => {
    expect(() => parseOpenApi("not json")).toThrow(/not valid JSON/);
    expect(() => parseOpenApi('{"hello":1}')).toThrow(/not an OpenAPI/);
    expect(doc.warnings.join(" ")).toMatch(/security schemes/);
  });

  it("resolves a relative server URL only when it knows where the document came from", () => {
    const relative = JSON.stringify({ ...spec, servers: [{ url: "/api" }] });
    expect(parseOpenApi(relative).baseUrl).toBeNull();
    expect(parseOpenApi(relative, { documentUrl: "https://docs.example.com/openapi.json" }).baseUrl).toBe("https://docs.example.com/api");
    expect(parseOpenApi(JSON.stringify({ ...spec, servers: [{ url: "https://x.example.com/{base}", variables: { base: { default: "v2" } } }] })).baseUrl).toBe("https://x.example.com/v2");
  });
});

describe("buildOperationRequest", () => {
  const doc = parseOpenApi(JSON.stringify(spec));
  const [list, create, show] = doc.operations;

  it("fills path parameters with encoding and refuses to guess a missing one", () => {
    expect(buildOperationRequest(show!, { petId: "a b/c" }, { ...noAuth, baseUrl: doc.baseUrl! }).url).toBe("https://pets.example.com/api/v1/pets/a%20b%2Fc");
    expect(() => buildOperationRequest(show!, {}, { ...noAuth, baseUrl: doc.baseUrl! })).toThrow(/Missing value for path parameter petId/);
  });

  it("serializes query arrays by repeating the name, and skips absent optionals", () => {
    const request = buildOperationRequest(list!, { tags: ["a b", "c"], limit: 5 }, { ...noAuth, baseUrl: doc.baseUrl! });
    expect(request.url).toBe("https://pets.example.com/api/v1/pets?limit=5&tags=a%20b&tags=c");
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
  });

  it("sends header parameters and a JSON body", () => {
    const showRequest = buildOperationRequest(show!, { petId: "1", "X-Trace": "abc" }, { ...noAuth, baseUrl: doc.baseUrl! });
    expect(showRequest.headers["X-Trace"]).toBe("abc");
    const createRequest = buildOperationRequest(create!, { name: "Rex", tag: { id: 4 } }, { ...noAuth, baseUrl: doc.baseUrl! });
    expect(createRequest.body).toBe('{"name":"Rex","tag":{"id":4}}');
    expect(createRequest.headers["Content-Type"]).toBe("application/json");
    expect(() => buildOperationRequest(create!, {}, { ...noAuth, baseUrl: doc.baseUrl! })).toThrow(/Missing required argument name/);
  });

  it("adds the token the way the plugin described", () => {
    const base = { ...noAuth, baseUrl: doc.baseUrl!, token: "secret" };
    expect(buildOperationRequest(list!, {}, { ...base, auth: { kind: "bearer", name: null, needsToken: true } }).headers["Authorization"]).toBe("Bearer secret");
    expect(buildOperationRequest(list!, {}, { ...base, auth: { kind: "header", name: "X-Api-Key", needsToken: true } }).headers["X-Api-Key"]).toBe("secret");
    expect(buildOperationRequest(list!, {}, { ...base, auth: { kind: "query", name: "api_key", needsToken: true } }).url).toContain("api_key=secret");
    expect(buildOperationRequest(list!, {}, { ...base, auth: { kind: "none", name: null, needsToken: false } }).headers["Authorization"]).toBeUndefined();
  });
});

describe("Swagger 2.0", () => {
  const swagger = {
    swagger: "2.0",
    info: { title: "Notes", version: "1.0" },
    host: "notes.example.com",
    basePath: "/api",
    schemes: ["https"],
    paths: {
      "/notes": {
        post: {
          operationId: "addNote",
          parameters: [
            { name: "draft", in: "query", type: "boolean" },
            { name: "body", in: "body", required: true, schema: { type: "object", required: ["text"], properties: { text: { type: "string" } } } },
          ],
        },
      },
      "/login": { post: { operationId: "login", parameters: [{ name: "user", in: "formData", required: true, type: "string" }, { name: "password", in: "formData", required: true, type: "string" }] } },
    },
  };
  const doc = parseOpenApi(JSON.stringify(swagger));

  it("assembles host, basePath and scheme", () => {
    expect(doc.baseUrl).toBe("https://notes.example.com/api");
  });
  it("reads a body parameter and formData fields", () => {
    const add = doc.operations[0]!;
    const properties = add.inputSchema["properties"] as Record<string, unknown>;
    expect(Object.keys(properties)).toContain("draft");
    expect(Object.keys(properties)).toContain("text");
    const request = buildOperationRequest(add, { text: "hello" }, { ...noAuth, baseUrl: doc.baseUrl! });
    expect(request.body).toBe('{"text":"hello"}');
    const login = doc.operations[1]!;
    const formRequest = buildOperationRequest(login, { user: "ada", password: "pw" }, { ...noAuth, baseUrl: doc.baseUrl! });
    expect(formRequest.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(formRequest.body).toBe("user=ada&password=pw");
  });
});

describe("renderHttpResult", () => {
  it("leads with the status, pretty-prints JSON, and flags errors", () => {
    expect(renderHttpResult(200, "OK", "application/json", '{"count":2}')).toEqual({ content: 'HTTP 200 OK\n{\n  "count": 2\n}', isError: false });
    expect(renderHttpResult(404, "Not Found", "text/plain", "no such pet").isError).toBe(true);
    expect(renderHttpResult(204, "No Content", "", "").content).toContain("(empty response)");
  });
});
