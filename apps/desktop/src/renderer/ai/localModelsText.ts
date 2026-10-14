/**
 * What Connect AI says about local models (Ollama): what is true of this computer.
 *
 * On the web the "computer" would be the cloud sandbox, which is never the person's own, so the
 * row says plainly that local models need the desktop app instead of asking them to start an
 * Ollama they cannot reach.
 */
import type { LocalModelsView } from "../../shared/api.ts";

export const WEB_LOCAL_MODELS = "Local models run on your own computer, so they need the ADCode desktop app. Here, use the included AI or paste a key.";

/** Ollama's row, in three words. */
export function localLabel(local: LocalModelsView, web: boolean): string {
  if (web) return "Desktop app only";
  if (local.running) return local.models.length > 0 ? `Running · ${String(local.models.length)} model${local.models.length === 1 ? "" : "s"}` : "Running · no models";
  return local.installed ? "Installed · not running" : "Not installed";
}

export function localDescription(local: LocalModelsView, web: boolean): string {
  if (web) return WEB_LOCAL_MODELS;
  if (!local.installed) {
    return "Ollama runs AI models on your own computer - free, private and offline. It is not installed here yet: download it, then come back and pick a model.";
  }
  if (!local.running) return "Ollama is installed but not running. Start it, and the models it has appear here.";
  if (local.models.length === 0) {
    return "Ollama is running but has no models yet. In a terminal, run: ollama pull qwen3-coder - then pick it here.";
  }
  return "Runs on your computer: free, private, and as fast as your machine. No API key needed.";
}
