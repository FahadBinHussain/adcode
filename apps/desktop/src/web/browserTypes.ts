/** The browser workspace's saved data contains no credentials or executable runtime state. */
export interface BrowserMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface BrowserRepository {
  readonly fullName: string;
  readonly branch: string;
  /** The immutable commit that file reads and the eventual pull request are based on. */
  readonly commit: string;
}

export interface BrowserProposal {
  readonly path: string;
  readonly content: string | null;
}

export interface BrowserChatSummary {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: number;
  readonly repository?: BrowserRepository;
}

export interface BrowserChat extends BrowserChatSummary {
  readonly messages: readonly BrowserMessage[];
  readonly proposals?: readonly BrowserProposal[];
}

export interface BrowserModel {
  readonly id: string;
  readonly label: string;
  readonly contextWindow: number;
  readonly maxOutput: number;
}

export interface BrowserConfig {
  readonly available: boolean;
  readonly models: readonly BrowserModel[];
  readonly defaultModel: string;
}

export interface GitHubStatus {
  readonly connected: boolean;
  readonly login?: string;
}

export interface GitHubAuthorization {
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly intervalMs: number;
}

export interface GitHubPoll {
  readonly state: "pending" | "connected" | "expired" | "denied";
  readonly login?: string;
  readonly retryAfterMs?: number;
}

export interface GitHubRepository {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly private: boolean;
  readonly canPush: boolean;
  readonly htmlUrl: string;
}

export interface GitHubRepositories {
  readonly repos: readonly GitHubRepository[];
  readonly nextPage: number | null;
}

export interface GitHubTree {
  readonly repo: string;
  readonly ref: string;
  readonly commit: string;
  readonly files: readonly { readonly path: string; readonly sha: string; readonly size: number }[];
  readonly truncated: boolean;
}

export interface GitHubFile {
  readonly path: string;
  readonly sha: string;
  readonly content: string;
  readonly bytes: number;
}

export interface BrowserPullRequestInput {
  readonly repo: string;
  readonly baseBranch: string;
  readonly baseCommit: string;
  readonly title: string;
  readonly body: string;
  readonly files: readonly BrowserProposal[];
}

export interface BrowserPullRequest {
  readonly url: string;
  readonly branch: string;
  readonly number: number;
}

export type BrowserTurnEvent =
  | { readonly type: "status"; readonly text: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "proposal"; readonly proposal: BrowserProposal; readonly previousContent?: string | null }
  | { readonly type: "usage"; readonly inputTokens: number; readonly outputTokens: number };

export interface BrowserTurnOptions {
  readonly chat: BrowserChat;
  readonly text: string;
  readonly model: string;
  readonly selectedPaths?: readonly string[];
  readonly signal: AbortSignal;
  readonly onEvent: (event: BrowserTurnEvent) => void;
}

export interface BrowserTurnResult {
  readonly chat: BrowserChat;
  readonly requestId?: string;
}

export const BROWSER_LIMITS = {
  chats: 50,
  messages: 200,
  chatBytes: 512 * 1024,
  proposalFileBytes: 128 * 1024,
  proposalTotalBytes: 256 * 1024,
} as const;
