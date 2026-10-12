export const AUDIENCE_ROLES = ["unknown", "student", "hobbyist", "professional-developer", "founder", "designer", "researcher", "other"] as const;
export const AUDIENCE_EXPERIENCE = ["unknown", "beginner", "intermediate", "advanced"] as const;
export const DECLARED_USES = ["unknown", "build-product", "debugging", "testing", "code-review", "learning", "documentation", "ui-design", "other"] as const;
export const AI_PERSONAS = ["unknown", "coding-assistant", "reviewer", "tester", "ui-polish", "bug-fixer", "docs-writer", "custom-agent", "inline-assistant"] as const;
export interface ModelAudienceProfile {
  uid: string;
  role: typeof AUDIENCE_ROLES[number];
  experience: typeof AUDIENCE_EXPERIENCE[number];
  primaryUse: typeof DECLARED_USES[number];
  updatedAt: number;
}
export type ModelAudienceProfileInput = Omit<ModelAudienceProfile, "uid" | "updatedAt"> & { consent: boolean };
export const audienceChoice = (value: unknown, choices: readonly string[]): string => typeof value === "string" && choices.includes(value) ? value : "unknown";
/** Only a trusted deployment callback may supply country; never read a client country header. */
export const audienceCountry = (value: unknown): string => typeof value === "string" && /^[A-Z]{2}$/.test(value) && value !== "XX" ? value : "unknown";
export function observedUse(source: string, persona: string): string {
  if (source === "completion") return "code-completion";
  if (source === "edit") return "code-editing";
  if (source === "chat") return "coding-assistance";
  if (source === "agent") return ({ reviewer: "code-review", tester: "testing", "ui-polish": "ui-design", "bug-fixer": "debugging", "docs-writer": "documentation" } as Record<string,string>)[persona] ?? "agent-workflow";
  return "unknown";
}
export const AUDIENCE_DIMENSIONS = ["countries", "userRoles", "experienceLevels", "aiPersonas", "useCases", "declaredUses", "platforms"] as const;
export type AudienceDimension = typeof AUDIENCE_DIMENSIONS[number];
export const audienceTitles: Record<AudienceDimension,string> = { countries: "Geography · network country", userRoles: "User personas · optional self-reported role", experienceLevels: "Coding experience · optional self-report", aiPersonas: "AI assistant personas", useCases: "Observed workflows", declaredUses: "Primary purpose · optional self-report", platforms: "Desktop platforms" };
export const audienceLabel = (value: string, dimension: AudienceDimension): string => {
  if (value === "unknown") return "Unknown / not provided";
  if (dimension === "countries") { try { return new Intl.DisplayNames(["en"], { type: "region" }).of(value) ?? value; } catch { return value; } }
  return ({ "professional-developer": "Professional developer", "coding-assistant": "Coding assistant", "custom-agent": "Custom agent", "inline-assistant": "Inline assistant", "ui-polish": "UI polish", "bug-fixer": "Bug fixer", "docs-writer": "Documentation writer", "ui-design": "UI design", "code-review": "Code review", "build-product": "Building a product", "coding-assistance": "Coding assistance", "code-completion": "Code completion", "code-editing": "Code editing", "agent-workflow": "Agent workflow", darwin: "macOS", win32: "Windows", linux: "Linux" } as Record<string,string>)[value] ?? value.charAt(0).toUpperCase()+value.slice(1);
};
