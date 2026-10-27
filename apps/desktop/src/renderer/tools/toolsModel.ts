/**
 * The Tools page as data. Pure - no DOM, no IPC.
 *
 * "Agents are who, tools are what": this is where the page works out which agents may use a
 * tool, and turns a server's raw error into a sentence that says what to do next.
 */
import { filterToolsByAccess } from "@adcode/ai/toolAccess";
import type { AssistantServerView } from "../../shared/assistantControls.ts";
import type { AgentProfile } from "../ai/agentProfiles.ts";
import { AGENT_PICKABLE_TOOLS } from "./builtInTools.ts";

const PICKABLE = new Set(AGENT_PICKABLE_TOOLS.map((tool) => tool.name));

/**
 * Who may use a built-in tool: the chat always does; a saved agent does when its tool access
 * allows it. Memory tools only ever run in the chat - board runs are built without them.
 */
export function toolUsers(toolName: string, agents: readonly AgentProfile[]): string[] {
  if (!PICKABLE.has(toolName)) return ["Chat"];
  return ["Chat", ...agents.filter((agent) => filterToolsByAccess([{ name: toolName }], agent.toolAccess ?? "all").tools.length > 0).map((agent) => agent.name)];
}

/** A server's last error as one sentence that says what to do, or null when it has none. */
export function explainMcpError(error: string | null): string | null {
  if (error === null || error.trim() === "") return null;
  const missing = /spawn (\S+) ENOENT/i.exec(error);
  if (missing !== null) {
    const program = missing[1]!.replace(/\.(cmd|exe)$/i, "");
    return program === "npx" || program === "node"
      ? `Couldn't start: ${program} wasn't found. Install Node.js from nodejs.org, then press Retry.`
      : `Couldn't start: ${program} wasn't found. Install it, then press Retry.`;
  }
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(error)) {
    return "The server refused the sign-in. Sign in with its own app or CLI as its instructions say, then press Retry.";
  }
  if (/ECONNREFUSED|connection refused/i.test(error)) {
    return "Nothing is answering at that address. Start the server (or its desktop app), then press Retry.";
  }
  if (/timed? ?out|ETIMEDOUT/i.test(error)) {
    return "The server took too long to answer. Check it is running, then press Retry.";
  }
  return (error.split(/\r?\n/)[0] ?? error).trim().slice(0, 200);
}

export function serverSummary(tools: AssistantServerView["tools"]): string {
  if (tools.length === 0) return "No tools yet";
  const uses = tools.reduce((sum, tool) => sum + tool.calls, 0);
  return `${tools.length} tool${tools.length === 1 ? "" : "s"} · ${uses} use${uses === 1 ? "" : "s"}`;
}

export function matchesQuery(query: string, fields: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}

/** The connector ID a custom server gets when the person only types a name. */
export function serverIdFromName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 44)
    .replace(/-+$/g, "");
  return base === "" ? "custom-connector" : base;
}

/** That ID, or the same with -2, -3 … when a connector already has it. */
export function freeServerId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.slice(0, 44).replace(/-+$/g, "") || "custom-connector";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0
      ? stem
      : `${stem}-${(attempt + 1).toString()}`.slice(0, 48).replace(/-+$/g, "");
    if (!taken.has(candidate)) return candidate;
  }
  return `custom-connector-${Date.now().toString(36)}`;
}

/** The same address rules the main process enforces, said early so the form can help. */
export function mcpUrlProblem(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter the full address, starting with https://.";
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return "Remove credentials, query parameters and fragments from the address. Put a token under Advanced → Headers or environment values.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    return "Use an HTTPS address. Plain HTTP is accepted only for localhost.";
  }
  return null;
}
