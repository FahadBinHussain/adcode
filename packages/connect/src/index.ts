/**
 * `@adcode/connect` - the outside world's connector formats, in one shape.
 *
 * Read twice in this repo: by the desktop app's import flow, and by its tests. Nothing
 * here performs I/O; text and bytes go in, drafts and requests come out.
 */
export * from "./types.ts";
export * from "./mcpConfig.ts";
export * from "./mcpb.ts";
export * from "./claudePlugin.ts";
export * from "./openaiPlugin.ts";
export * from "./openapi.ts";
export * from "./import.ts";
export * from "./zip.ts";
export * from "./mcpOAuth.ts";
