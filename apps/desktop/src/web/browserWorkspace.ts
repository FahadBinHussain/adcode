import "./browserWorkspace.css";
import { brandMark } from "../renderer/workbench/brandMark.ts";
import { createIcon, type IconSource } from "../renderer/workbench/icons.ts";
import { WEB_ICON } from "../renderer/workbench/webIcons.ts";
import { createWebRail } from "../renderer/workbench/webShell.ts";
import { DESKTOP_DOWNLOAD_URL } from "../renderer/surface.ts";
import { ArrowUp, Trash2 } from "lucide";
import { renderChatMessageHtml } from "../renderer/ai/chatMarkdown.ts";
import { createBrowserClient } from "./browserClient.ts";
import type { BrowserChat, BrowserChatSummary, BrowserRepository, BrowserProposal, GitHubRepository, GitHubTree } from "./browserTypes.ts";
import { browserDraftKey, browserFileDiff, shouldSendBrowserMessage, updateBrowserHistory, updateBrowserProposals } from "./browserState.ts";
import type { WebSession } from "./gate.ts";

export interface BrowserWorkspaceOptions {
  readonly session: WebSession;
  readonly onRunPreview: (repository?: BrowserRepository) => Promise<void>;
  readonly onAccount: (section?: string) => void;
  readonly onFeatures?: () => void;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, icon?: IconSource, run?: () => void, className = "bw-button"): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  if (icon) node.append(createIcon(icon));
  node.append(element("span", "", label));
  if (run) node.addEventListener("click", run);
  return node;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function githubLink(url: string, label: string): HTMLAnchorElement {
  const link = element("a", "bw-button", label);
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") throw new Error("GitHub returned an unexpected link. Please try again.");
  link.href = parsed.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/** Paint immediately; chat and GitHub use ordinary requests, with no runtime connection. */
export function mountBrowserWorkspace(options: BrowserWorkspaceOptions): { dispose(): void } {
  const { session } = options;
  const api = createBrowserClient(session);
  const root = element("div");
  root.id = "web-workspace";
  root.dataset["project"] = "closed";
  root.dataset["history"] = window.matchMedia("(max-width: 900px)").matches ? "closed" : "open";
  root.setAttribute("aria-label", "ADCode workspace");
  let disposed = false;
  let chat: BrowserChat = { id: crypto.randomUUID(), title: "New chat", updatedAt: Date.now(), messages: [] };
  let history: BrowserChatSummary[] = [];
  let busy = false;
  let available = false;
  let runtimePending = false;
  let publishing = false;
  let repositoryLoading = false;
  const deletingChats = new Set<string>();
  const restoringChats = new Set<string>();
  const lifetime = new AbortController();
  const publishedProposals = new Set<string>();
  let turn: AbortController | null = null;
  let openGeneration = 0;
  let repositoryGeneration = 0;
  let githubGeneration = 0;
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  let repos: GitHubRepository[] = [];
  let nextRepoPage: number | null = null;
  let tree: GitHubTree | null = null;
  let retryTurn: { source: BrowserChat; text: string } | null = null;
  const selectedPaths = new Set<string>();
  const previousFiles = new Map<string, string | null>();
  let scrollFrame: number | null = null;
  let openTabs: string[] = [];
  const dialogs = new Set<HTMLDialogElement>();

  const sidebar = element("aside", "bw-sidebar");
  sidebar.setAttribute("aria-label", "Conversations");
  const sidebarMain = element("div", "bw-sidebar-main");
  const brand = element("div", "bw-brand");
  const brandActions = element("div", "bw-brand-actions");
  brandActions.append(button("Main menu", WEB_ICON.menu, () => showMainMenu(), "bw-icon-button"), button("Search chats", WEB_ICON.search, () => focusHistory(), "bw-icon-button"));
  brand.append(brandMark({ size: 24, plate: true, accent: true }), element("span", "bw-wordmark", "ADCode"), brandActions);
  const closeHistory = button("Close chats", WEB_ICON.close, () => { root.dataset["history"] = "closed"; }, "bw-button bw-mobile");
  const newButton = button("New conversation", WEB_ICON.newChat, () => newChat(), "bw-button bw-new");
  const usage = element("div", "bw-usage");
  const earnings = button("Earnings", WEB_ICON.earnings, () => options.onAccount("earnings"), "bw-nav-row");
  earnings.dataset["accountSection"] = "earnings";
  const invites = button("Invite friends, earn more", WEB_ICON.gift, () => options.onAccount("invites"), "bw-nav-row");
  invites.dataset["accountSection"] = "invites";
  usage.append(button("Included AI", WEB_ICON.spark, () => focusModels(), "bw-nav-row"), earnings, invites);
  const projectCard = button("Open a project", WEB_ICON.folder, () => showProject(), "bw-project-card");
  projectCard.append(createIcon(WEB_ICON.chevron));
  const historySearch = element("input", "bw-search");
  historySearch.placeholder = "Search chats";
  historySearch.type = "search";
  historySearch.setAttribute("aria-label", "Search chats");
  const historyHost = element("div", "bw-history");
  const sidebarFooter = element("div", "bw-sidebar-footer");
  const footerLinks = element("div", "bw-links");
  for (const [label, icon, url] of [
    ["Desktop app", WEB_ICON.monitor, DESKTOP_DOWNLOAD_URL],
    ["Docs", WEB_ICON.book, "https://adcode.bluethenics.com/docs"],
  ] as const) {
    const link = button(label, icon, () => window.open(url, "_blank", "noopener,noreferrer"), "bw-nav-row bw-link-row");
    link.append(createIcon(WEB_ICON.chevronRight));
    footerLinks.append(link);
  }
  const allFeatures = button("All features", WEB_ICON.grid, () => {
    if (options.onFeatures) options.onFeatures();
    else window.open("https://adcode.bluethenics.com/docs", "_blank", "noopener,noreferrer");
  }, "bw-nav-row bw-link-row");
  allFeatures.append(createIcon(WEB_ICON.chevronRight));
  footerLinks.append(allFeatures);
  const promo = element("div", "bw-promo");
  promo.append(element("p", "", "For local projects and local models, use ADCode on desktop."), button("Get the desktop app", WEB_ICON.ide, () => window.open(DESKTOP_DOWNLOAD_URL, "_blank", "noopener,noreferrer"), "bw-button bw-download"));
  sidebarFooter.append(footerLinks, promo);
  sidebarMain.append(brand, closeHistory, newButton, usage, element("div", "bw-sidebar-label", "Project"), projectCard, element("div", "bw-sidebar-label", "Chats"), historySearch, historyHost);
  sidebar.append(sidebarMain, sidebarFooter);

  const main = element("main", "bw-main");
  const header = element("header", "bw-header bw-tabs");
  const mobileHistory = button("Toggle sidebar", WEB_ICON.sidebar, () => {
    root.dataset["history"] = root.dataset["history"] === "open" ? "closed" : "open";
  }, "bw-icon-button bw-sidebar-toggle");
  const tabStrip = element("div", "bw-tab-strip");
  tabStrip.setAttribute("role", "tablist");
  tabStrip.setAttribute("aria-label", "Open chats");
  const heading = element("span", "bw-title", "New conversation");
  const addChat = button("New chat in a new tab", WEB_ICON.newChat, () => newChat(), "bw-icon-button bw-tab-add");
  const projectToggle = button("Project", WEB_ICON.branch, () => showProject(), "bw-button bw-project-toggle");
  const runButton = button("Preview", WEB_ICON.preview, () => showWorkspaceFeature("Live preview", "Open your cloud workspace to run a project and see its live preview."), "bw-button bw-run");
  runButton.title = "Open cloud workspace for a live preview";
  header.append(mobileHistory, tabStrip, addChat, element("div", "bw-tabs-spacer"), projectToggle, runButton);
  const chatPanel = element("section", "bw-chat-panel");
  chatPanel.setAttribute("aria-label", "Chat");
  const chatHeader = element("div", "bw-chat-header");
  chatHeader.append(button("New conversation", WEB_ICON.newChat, () => newChat(), "bw-icon-button"), button("Review proposed changes", WEB_ICON.changes, () => showProject(true), "bw-icon-button"), button("Included AI models", WEB_ICON.spark, () => focusModels(), "bw-icon-button"));
  const transcript = element("div", "bw-transcript");
  transcript.setAttribute("role", "log");
  transcript.setAttribute("aria-label", "Conversation");
  transcript.setAttribute("aria-live", "off");
  const composerArea = element("div", "bw-composer-area");
  const status = element("div", "bw-status");
  status.setAttribute("role", "status");
  const composer = element("form", "bw-composer");
  const context = element("div", "bw-context");
  context.hidden = true;
  const input = element("textarea", "bw-input");
  input.placeholder = "Ask anything or describe what you'd like to build…";
  input.rows = 2;
  input.maxLength = 60_000;
  input.setAttribute("aria-label", "Message ADCode");
  const composerBottom = element("div", "bw-composer-bottom");
  const composerTools = element("div", "bw-composer-tools");
  composerTools.append(button("Choose project files", WEB_ICON.folder, () => showProject(), "bw-icon-button"), button("Plan a change", WEB_ICON.spark, () => {
    input.value = "Help me plan this change: "; resizeInput(); persistDraft(); input.focus();
  }, "bw-icon-button"));
  const model = element("select", "bw-model");
  model.setAttribute("aria-label", "AI model");
  model.append(new Option("Loading models…", ""));
  model.disabled = true;
  const sendButton = button("Send", ArrowUp, () => busy ? stop() : void send(), "bw-button bw-primary bw-send");
  composerBottom.append(composerTools, model, sendButton);
  composer.append(context, input, composerBottom);
  composerArea.append(status, composer, element("p", "bw-composer-note", "Enter to send · Shift + Enter for a new line"));
  const suggestions = element("div", "bw-suggestions");
  chatPanel.append(chatHeader, transcript, composerArea, suggestions);
  main.append(header, chatPanel);

  const project = element("aside", "bw-project");
  project.setAttribute("aria-label", "GitHub project");
  const projectHeader = element("div", "bw-project-header");
  const projectHeading = element("div", "bw-project-heading");
  projectHeading.append(createIcon(WEB_ICON.branch), element("span", "", "Project"));
  projectHeader.append(projectHeading, button("Close project", WEB_ICON.close, () => { root.dataset["project"] = "closed"; }, "bw-icon-button"));
  const githubHost = element("section");
  const filesHost = element("section");
  const proposalsHost = element("section");
  const runtimeNote = element("section", "bw-runtime-note");
  runtimeNote.append(element("h2", "", "Need a terminal or live preview?"), element("p", "", "Open your separate cloud workspace. GitHub changes stay in the pull requests you create here; they aren't automatically copied into that workspace."));
  project.append(projectHeader, githubHost, filesHost, proposalsHost, runtimeNote);
  const railAccount = button("Your account", WEB_ICON.account, () => options.onAccount(), "bw-icon-button");
  railAccount.title = session.email ?? "Your account";
  const rail = createWebRail({
    home: () => { root.dataset["project"] = "closed"; input.focus(); },
    places: [
      { id: "chat", label: "Chat", icon: WEB_ICON.chat, run: () => { root.dataset["project"] = "closed"; input.focus(); } },
      { id: "agents", label: "Agents", icon: WEB_ICON.agents, run: () => showWorkspaceFeature("Agents", "Open your cloud workspace to use agents that run tools and work on project files.") },
      { id: "tools", label: "Tools", icon: WEB_ICON.tools, run: () => showWorkspaceFeature("Tools", "Open your cloud workspace for terminals, installed tools and project execution.") },
    ],
    panels: [
      { id: "account", label: "Account", icon: WEB_ICON.account, run: () => options.onAccount() },
      { id: "changes", label: "Changes", icon: WEB_ICON.changes, run: () => showProject(true) },
      { id: "preview", label: "Preview", icon: WEB_ICON.preview, run: () => showWorkspaceFeature("Live preview", "Open your cloud workspace to run a project and see its live preview.") },
      { id: "automations", label: "Automations", shortLabel: "Schedule", icon: WEB_ICON.automations, run: () => showWorkspaceFeature("Automations", "Open your cloud workspace to schedule project tasks.") },
    ],
    footer: [button("Included AI models", WEB_ICON.gear, () => focusModels(), "bw-icon-button"), button("Help and documentation", WEB_ICON.book, () => window.open("https://adcode.bluethenics.com/docs", "_blank", "noopener,noreferrer"), "bw-icon-button"), railAccount],
  });
  rail.element.classList.add("bw-rail");
  rail.setCurrent("chat");
  root.append(rail.element, sidebar, main, project);
  document.body.append(root);
  document.body.dataset["webMode"] = "browser";
  document.body.dataset["shell"] = "ready";

  function showDialog(title: string): { dialog: HTMLDialogElement; body: HTMLElement; close(): void } {
    const dialog = element("dialog", "bw-dialog");
    const titleId = `bw-dialog-${crypto.randomUUID()}`;
    dialog.setAttribute("aria-labelledby", titleId);
    const head = element("div", "bw-dialog-header");
    const heading = element("h2", "", title);
    heading.id = titleId;
    const close = (): void => { dialog.close(); dialog.remove(); dialogs.delete(dialog); };
    head.append(heading, button("Close", WEB_ICON.close, close, "bw-icon-button"));
    const body = element("div", "bw-dialog-body");
    dialog.append(head, body);
    dialog.addEventListener("close", () => { dialog.remove(); dialogs.delete(dialog); }, { once: true });
    root.append(dialog);
    dialogs.add(dialog);
    dialog.showModal();
    return { dialog, body, close };
  }

  function showMainMenu(): void {
    const menu = showDialog("ADCode");
    for (const [label, icon, act] of [
      ["New conversation", WEB_ICON.newChat, () => newChat()],
      ["Search chats", WEB_ICON.search, () => focusHistory()],
      ["Open a GitHub project", WEB_ICON.branch, () => showProject()],
      ["Your account", WEB_ICON.account, () => options.onAccount()],
      ["Open cloud workspace", WEB_ICON.workspace, () => void runPreview()],
    ] as const) menu.body.append(button(label, icon, () => { menu.close(); act(); }, "bw-nav-row"));
  }

  function showWorkspaceFeature(title: string, detail: string): void {
    const sheet = showDialog(title);
    sheet.body.append(element("p", "", detail), element("p", "bw-muted", "Your GitHub conversations and proposed changes stay saved here."),
      button("Open cloud workspace", WEB_ICON.workspace, () => { sheet.close(); void runPreview(); }, "bw-button bw-primary"));
  }

  function focusModels(): void {
    model.focus();
    if (model.disabled) {
      setStatus("Included AI models are unavailable right now. Your draft is kept.", true, () => void loadConfig());
      return;
    }
    try { model.showPicker(); } catch { /* Keyboard focus still opens the native model choices. */ }
  }

  function focusHistory(): void {
    root.dataset["history"] = "open";
    historySearch.focus();
  }

  function showProject(review = false): void {
    root.dataset["project"] = "open";
    projectToggle.setAttribute("aria-expanded", "true");
    projectCard.setAttribute("aria-expanded", "true");
    if (review && proposalsHost.childElementCount > 0) proposalsHost.scrollIntoView({ block: "nearest" });
  }

  function setStatus(text: string, error = false, retry?: () => void): void {
    if (disposed) return;
    status.replaceChildren(document.createTextNode(text));
    status.dataset["error"] = String(error);
    if (retry) status.append(button("Try again", undefined, retry, "bw-retry"));
  }

  function persistDraft(): void {
    const key = browserDraftKey(session.uid, chat.messages.length === 0 ? "new" : chat.id);
    if (key === null) return;
    try {
      if (input.value) localStorage.setItem(key, input.value);
      else localStorage.removeItem(key);
    } catch { /* The composer still works when browser storage is unavailable. */ }
  }

  function restoreDraft(): void {
    const key = browserDraftKey(session.uid, chat.messages.length === 0 ? "new" : chat.id);
    try { input.value = key === null ? "" : localStorage.getItem(key) ?? ""; } catch { input.value = ""; }
    resizeInput();
  }

  function resizeInput(): void {
    input.style.height = "auto";
    input.style.height = `${Math.min(220, Math.max(60, input.scrollHeight))}px`;
    syncControls();
  }

  function syncControls(): void {
    sendButton.disabled = !busy && (!available || input.value.trim().length === 0 || runtimePending || publishing || repositoryLoading || deletingChats.size > 0);
    sendButton.replaceChildren(...(busy ? [] : [createIcon(ArrowUp)]), element("span", "", busy ? "Stop" : "Send"));
    sendButton.dataset["state"] = busy ? "working" : "idle";
    sendButton.setAttribute("aria-label", busy ? "Stop response" : "Send message");
    runButton.disabled = busy || runtimePending || publishing || repositoryLoading || deletingChats.size > 0;
    newButton.disabled = busy || runtimePending || publishing || deletingChats.size > 0;
    addChat.disabled = newButton.disabled;
    model.disabled = busy || !available;
    for (const control of project.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")) {
      if (control.dataset["lock"] === "turn") control.disabled = busy || runtimePending || publishing || repositoryLoading || deletingChats.size > 0 || control.dataset["complete"] === "true";
    }
    for (const control of historyHost.querySelectorAll<HTMLButtonElement>(".bw-delete")) control.disabled = busy || runtimePending || publishing || deletingChats.size > 0;
  }

  function renderHistory(): void {
    renderTabs();
    const query = historySearch.value.trim().toLocaleLowerCase();
    const matching = history.filter((entry) => `${entry.title} ${entry.repository?.fullName ?? ""}`.toLocaleLowerCase().includes(query));
    historyHost.replaceChildren();
    if (matching.length === 0) historyHost.append(element("p", "bw-notice", query ? "No matching chats." : "Your chats will appear here."));
    for (const entry of matching) {
      const row = element("div", "bw-history-row");
      const item = button(entry.title || "Untitled chat", WEB_ICON.chat, () => void openChat(entry.id), "bw-history-item");
      item.title = entry.repository ? `${entry.title} · ${entry.repository.fullName}` : entry.title;
      if (entry.id === chat.id) item.setAttribute("aria-current", "page");
      const remove = button("", Trash2, () => void deleteChat(entry.id), "bw-delete");
      remove.setAttribute("aria-label", `Delete chat: ${entry.title || "Untitled chat"}`);
      remove.title = "Delete chat";
      remove.dataset["chat"] = entry.id;
      remove.disabled = busy || runtimePending || publishing || deletingChats.size > 0;
      row.append(item, remove);
      historyHost.append(row);
    }
  }

  function renderTabs(): void {
    const known = new Set(history.map((entry) => entry.id));
    openTabs = openTabs.filter((id) => known.has(id) || id === chat.id);
    if (!openTabs.includes(chat.id)) openTabs.push(chat.id);
    openTabs = openTabs.slice(-8);
    tabStrip.replaceChildren();
    for (const id of openTabs) {
      const active = id === chat.id;
      const title = active ? chat.messages.length === 0 ? "New conversation" : chat.title : history.find((entry) => entry.id === id)?.title ?? "Conversation";
      const item = element("div", "bw-tab web-tab");
      item.dataset["active"] = String(active);
      const open = element("button", "bw-tab-open web-tab-open");
      open.type = "button";
      open.setAttribute("role", "tab");
      open.setAttribute("aria-selected", String(active));
      open.tabIndex = active ? 0 : -1;
      open.title = title;
      const indicator = element("span", "bw-tab-status");
      indicator.dataset["status"] = active && busy ? "working" : "idle";
      if (active) { heading.textContent = title; open.append(indicator, heading); }
      else open.append(indicator, element("span", "bw-tab-title", title));
      open.addEventListener("click", () => { if (!active) void openChat(id); });
      const close = button(`Close ${title}`, WEB_ICON.close, () => {
        if (busy || runtimePending || publishing || deletingChats.size > 0) return;
        openTabs = openTabs.filter((one) => one !== id);
        if (active) {
          const neighbour = openTabs.at(-1);
          if (neighbour) void openChat(neighbour); else newChat();
        } else renderTabs();
      }, "bw-icon-button bw-tab-close");
      item.append(open, close);
      tabStrip.append(item);
    }
  }

  async function deleteChat(id: string): Promise<void> {
    if (busy || runtimePending || publishing || deletingChats.size > 0) return;
    deletingChats.add(id);
    openGeneration += 1;
    renderHistory();
    syncControls();
    try {
      await api.deleteChat(id);
      if (disposed) return;
      history = history.filter((entry) => entry.id !== id);
      deletingChats.delete(id);
      if (chat.id === id) newChat(null);
      renderHistory();
      setStatus("Conversation deleted.");
      status.append(button("Undo", undefined, () => void restoreChat(id), "bw-retry"));
    } catch (error) { setStatus(message(error), true, () => void deleteChat(id)); }
    finally { deletingChats.delete(id); if (!disposed) syncControls(); }
  }

  async function restoreChat(id: string): Promise<void> {
    if (restoringChats.has(id)) return;
    restoringChats.add(id);
    try {
      const restored = await api.restoreChat(id);
      if (disposed) return;
      history = updateBrowserHistory(history, restored);
      renderHistory();
      setStatus("Conversation restored.");
    } catch (error) {
      setStatus(message(error), true);
      if (!disposed) status.append(button("Try Undo again", undefined, () => void restoreChat(id), "bw-retry"));
    } finally { restoringChats.delete(id); }
  }

  function addMessage(role: "user" | "assistant", text: string): HTMLElement {
    const article = element("article", "bw-message");
    article.dataset["role"] = role;
    const label = element("div", "bw-message-label", role === "user" ? "You" : "ADCode");
    const body = element("div", "bw-message-content");
    if (role === "assistant") body.innerHTML = renderChatMessageHtml(text);
    else body.textContent = text;
    article.append(label, body);
    transcript.append(article);
    return body;
  }

  function renderConversation(): void {
    root.dataset["empty"] = String(chat.messages.length === 0);
    suggestions.hidden = chat.messages.length > 0;
    suggestions.replaceChildren();
    transcript.replaceChildren();
    if (chat.messages.length === 0) {
      const welcome = element("div", "bw-welcome");
      const hour = new Date().getHours();
      const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      const title = element("h1", "bw-greeting");
      title.append(createIcon(WEB_ICON.spark), element("span", "", greeting));
      welcome.append(title, element("p", "", chat.repository ? "What can I help you build or change in this project?" : "What do you want to build? Describe it below."));
      const starters = chat.repository ? [
        ["Explain this project", "Give me a short tour of this project and explain where a newcomer should start reading."],
        ["Build something", "Help me build this change in my project: "],
        ["Fix an error", "Help me find and fix the root cause of this error: "],
        ["Plan new idea", "Help me plan this idea for my project: "],
      ] : [
        ["Landing page", "Help me build a landing page for my small business, with services, testimonials and a contact form."],
        ["Snake game", "Help me write a snake game for the browser with a score and a restart button."],
        ["To-do app", "Help me write a to-do app that saves tasks in the browser."],
        ["Portfolio", "Help me build a personal portfolio with an about section, projects and a way to contact me."],
        ["Something else", "Help me build this: "],
      ];
      for (const [label, prompt] of starters) suggestions.append(button(label!, undefined, () => { input.value = prompt!; resizeInput(); persistDraft(); input.focus(); }, "bw-suggestion"));
      transcript.append(welcome);
    } else for (const entry of chat.messages) addMessage(entry.role, entry.content);
    renderHistory();
    renderProposals();
    updateContext();
  }

  function scrollToBottom(): void {
    if (scrollFrame !== null) return;
    scrollFrame = requestAnimationFrame(() => { scrollFrame = null; if (!disposed) transcript.scrollTop = transcript.scrollHeight; });
  }

  function newChat(repository: BrowserRepository | null | undefined = chat.repository): void {
    if (busy || runtimePending || publishing || deletingChats.size > 0) return;
    persistDraft();
    openGeneration += 1;
    repositoryGeneration += 1;
    repositoryLoading = false;
    chat = { id: crypto.randomUUID(), title: "New chat", updatedAt: Date.now(), messages: [], ...(repository ? { repository } : {}) };
    retryTurn = null;
    previousFiles.clear();
    setStatus("");
    restoreDraft();
    renderConversation();
    root.dataset["history"] = "closed";
    input.focus();
  }

  async function openChat(id: string): Promise<void> {
    if (busy || runtimePending || publishing || deletingChats.size > 0 || id === chat.id) return;
    persistDraft();
    repositoryGeneration += 1;
    repositoryLoading = false;
    const generation = ++openGeneration;
    setStatus("Opening conversation…");
    try {
      const saved = await api.getChat(id);
      if (disposed || generation !== openGeneration) return;
      chat = saved;
      retryTurn = null;
      previousFiles.clear();
      selectedPaths.clear();
      tree = null;
      restoreDraft();
      renderConversation();
      renderFiles();
      setStatus("");
      root.dataset["history"] = "closed";
      scrollToBottom();
      if (chat.repository) void loadTree(chat.repository.fullName, chat.repository.commit, false);
    } catch (error) { if (generation === openGeneration) setStatus(message(error), true, () => void openChat(id)); }
  }

  function stop(): void { turn?.abort(); }

  async function send(retry?: { source: BrowserChat; text: string }): Promise<void> {
    retry ??= retryTurn?.text === input.value.trim() ? retryTurn : undefined;
    const text = retry?.text ?? input.value.trim();
    if (busy || runtimePending || publishing || repositoryLoading || deletingChats.size > 0 || !available || !text) return;
    const originalDraftKey = browserDraftKey(session.uid, chat.messages.length === 0 ? "new" : chat.id);
    openGeneration += 1;
    const source = retry?.source ?? chat;
    retryTurn = null;
    if (retry) { chat = source; renderConversation(); }
    busy = true;
    turn = new AbortController();
    const controller = turn;
    if (!retry || input.value.trim() === text) {
      input.value = "";
      if (originalDraftKey !== null) try { localStorage.removeItem(originalDraftKey); } catch { /* optional draft storage */ }
    }
    resizeInput();
    if (source.messages.length === 0) transcript.replaceChildren();
    root.dataset["empty"] = "false";
    suggestions.hidden = true;
    addMessage("user", text);
    const answer = addMessage("assistant", "");
    let partial = "";
    let proposals = [...(source.proposals ?? [])];
    let replyFinished = false;
    setStatus("Thinking…");
    syncControls();
    renderTabs();
    scrollToBottom();
    try {
      // Save the person's message before asking the model, so closing a tab cannot lose it.
      chat = { ...source, title: source.messages.length ? source.title : text.slice(0, 70), updatedAt: Date.now(), messages: [...source.messages, { role: "user", content: text }] };
      await api.saveChat(chat);
      if (disposed) return;
      const result = await api.streamTurn({ chat: source, text, model: model.value, selectedPaths: [...selectedPaths], signal: controller.signal, onEvent: (event) => {
        if (disposed || turn !== controller) return;
        const pinned = transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop < 120;
        if (event.type === "text") {
          partial += event.text;
          answer.innerHTML = renderChatMessageHtml(partial);
          setStatus("Writing…");
          if (pinned) scrollToBottom();
        } else if (event.type === "status") setStatus(event.text);
        else if (event.type === "proposal") {
          proposals = updateBrowserProposals(proposals, event.proposal);
          if (event.previousContent !== undefined) previousFiles.set(event.proposal.path, event.previousContent);
          chat = { ...chat, proposals };
          renderProposals();
        }
      } });
      if (disposed) return;
      chat = result.chat;
      replyFinished = true;
      await api.saveChat(chat);
      if (disposed) return;
      history = updateBrowserHistory(history, chat);
      heading.textContent = chat.title;
      renderHistory();
      renderProposals();
      setStatus(result.truncated ? "This reply was cut short. Ask ADCode to continue." : "Saved to your conversations.");
    } catch (error) {
      if (disposed) return;
      if (controller.signal.aborted) {
        chat = { ...source, title: source.messages.length ? source.title : text.slice(0, 70), updatedAt: Date.now(), messages: [...source.messages, { role: "user", content: text }, ...(partial ? [{ role: "assistant" as const, content: partial }] : [])], proposals };
        try { await api.saveChat(chat); history = updateBrowserHistory(history, chat); renderHistory(); setStatus("Response stopped. Your conversation is saved."); }
        catch { setStatus("Response stopped. Couldn't save this conversation yet.", true, () => void saveCurrent()); }
      } else if (replyFinished) {
        history = updateBrowserHistory(history, chat);
        renderHistory();
        renderProposals();
        setStatus("Your reply is ready, but saving failed. Keep this page open and try saving again.", true, () => void saveCurrent());
      } else {
        chat = { ...source, title: source.messages.length ? source.title : text.slice(0, 70), updatedAt: Date.now(), messages: [...source.messages, { role: "user", content: text }, ...(partial ? [{ role: "assistant" as const, content: partial }] : [])], proposals };
        history = updateBrowserHistory(history, chat);
        renderHistory();
        retryTurn = { source, text };
        if (input.value.trim().length === 0) input.value = text;
        persistDraft();
        resizeInput();
        setStatus(message(error), true, () => void send({ source, text }));
      }
    } finally {
      if (!disposed) {
        busy = false;
        turn = null;
        renderProposals();
        syncControls();
      }
    }
  }

  async function saveCurrent(): Promise<void> {
    try { await api.saveChat(chat); setStatus("Conversation saved."); } catch (error) { setStatus(message(error), true, () => void saveCurrent()); }
  }

  async function runPreview(): Promise<void> {
    if (busy || runtimePending || publishing || repositoryLoading || deletingChats.size > 0) return;
    persistDraft();
    runtimePending = true;
    syncControls();
    setStatus("Opening your cloud workspace…");
    try { await options.onRunPreview(chat.repository); }
    catch (error) { setStatus(message(error), true, () => void runPreview()); }
    finally { if (!disposed) { runtimePending = false; syncControls(); } }
  }

  function updateContext(): void {
    context.hidden = chat.repository === undefined;
    context.textContent = chat.repository ? `${chat.repository.fullName} · ${chat.repository.branch}${selectedPaths.size ? ` · ${selectedPaths.size} selected file${selectedPaths.size === 1 ? "" : "s"}` : ""}` : "";
    const label = projectCard.querySelector("span");
    if (label) label.textContent = chat.repository?.fullName.split("/").at(-1) ?? "Open a project";
    projectCard.title = chat.repository ? `${chat.repository.fullName} · ${chat.repository.branch}` : "Connect a GitHub project";
  }

  async function loadConfig(): Promise<void> {
    try {
      const config = await api.config();
      if (disposed) return;
      model.replaceChildren(...config.models.map((entry) => new Option(entry.label, entry.id)));
      model.value = config.defaultModel;
      if (!model.value && config.models[0]) model.value = config.models[0].id;
      available = config.available && config.models.length > 0;
      if (!available) {
        model.replaceChildren(new Option("Models unavailable", ""));
        setStatus("Chat is temporarily unavailable. Your draft is kept.", true, () => void loadConfig());
      }
      else if (status.dataset["error"] === "true") setStatus("");
      syncControls();
    } catch (error) {
      if (disposed) return;
      available = false;
      model.replaceChildren(new Option("Models unavailable", ""));
      syncControls();
      setStatus(message(error), true, () => void loadConfig());
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const saved = await api.listChats();
      if (disposed) return;
      history = [...saved];
      if (chat.messages.length > 0) history = updateBrowserHistory(history, chat);
      renderHistory();
    } catch (error) {
      if (disposed) return;
      historyHost.replaceChildren(element("p", "bw-notice", message(error)), button("Reload chats", undefined, () => void loadHistory(), "bw-retry"));
    }
  }

  function showDisconnected(): void {
    githubHost.replaceChildren(element("h2", "", "Bring your project"), element("p", "", "Connect GitHub to read your files, discuss your code, and review proposed changes."), button("Connect GitHub", WEB_ICON.branch, () => void connectGitHub()), element("p", "bw-muted", "You choose when to create a pull request. Chat works without connecting."));
  }

  async function loadGithub(): Promise<void> {
    try {
      const connected = await api.githubStatus();
      if (disposed) return;
      if (connected.connected) await loadRepos(1, connected.login);
      else showDisconnected();
    } catch (error) {
      if (disposed) return;
      githubHost.replaceChildren(element("p", "", message(error)), button("Try GitHub again", undefined, () => void loadGithub()));
    }
  }

  async function connectGitHub(): Promise<void> {
    const generation = ++githubGeneration;
    githubHost.replaceChildren(element("p", "", "Getting a code from GitHub…"));
    try {
      const auth = await api.githubStart();
      if (disposed || generation !== githubGeneration) return;
      const authStatus = element("p", "bw-muted", "Enter this code on GitHub, then return here. This page checks automatically.");
      githubHost.replaceChildren(element("h2", "", "Connect GitHub"), element("div", "bw-auth-code", auth.userCode), authStatus, githubLink(auth.verificationUri, "Open GitHub"), button("Copy code", undefined, () => {
        void navigator.clipboard.writeText(auth.userCode).then(() => { authStatus.textContent = "Code copied. Enter it on GitHub."; }, () => { authStatus.textContent = "Select and copy the code above."; });
      }), button("Cancel", undefined, () => { githubGeneration += 1; clearTimeout(authTimer); showDisconnected(); }));
      const poll = async (): Promise<void> => {
        if (disposed || generation !== githubGeneration) return;
        try {
          if (Date.now() >= auth.expiresAt) throw new Error("This code expired. Connect GitHub again to get a new one.");
          const result = await api.githubPoll();
          if (disposed || generation !== githubGeneration) return;
          if (result.state === "connected") { await loadRepos(1, result.login); return; }
          if (result.state !== "pending") throw new Error(result.state === "expired" ? "This code expired. Please connect again." : "GitHub connection was cancelled. You can try again.");
          authTimer = setTimeout(() => void poll(), Math.max(1_000, result.retryAfterMs ?? auth.intervalMs));
        } catch (error) {
          if (disposed || generation !== githubGeneration) return;
          githubHost.replaceChildren(element("p", "", message(error)), button("Connect again", undefined, () => void connectGitHub()));
        }
      };
      authTimer = setTimeout(() => void poll(), auth.intervalMs);
    } catch (error) {
      if (disposed || generation !== githubGeneration) return;
      githubHost.replaceChildren(element("p", "", message(error)), button("Try again", undefined, () => void connectGitHub()));
    }
  }

  async function loadRepos(page = 1, login?: string): Promise<void> {
    try {
      const result = await api.githubRepos(page);
      if (disposed) return;
      repos = page === 1 ? [...result.repos] : [...repos, ...result.repos.filter((entry) => !repos.some((old) => old.fullName === entry.fullName))];
      nextRepoPage = result.nextPage;
      renderRepos(login);
    } catch (error) { if (!disposed) githubHost.replaceChildren(element("p", "", message(error)), button("Reload repositories", undefined, () => void loadRepos(page, login))); }
  }

  function renderRepos(login?: string): void {
    const connection = element("div", "bw-connection", login ? `Connected as @${login}` : "GitHub connected");
    const repoSelect = element("select", "bw-field");
    repoSelect.setAttribute("aria-label", "GitHub repository");
    repoSelect.dataset["lock"] = "turn";
    repoSelect.append(new Option("Choose a repository", ""), ...repos.map((entry) => new Option(entry.fullName, entry.fullName)));
    if (chat.repository && !repos.some((entry) => entry.fullName === chat.repository!.fullName)) repoSelect.append(new Option(chat.repository.fullName, chat.repository.fullName));
    repoSelect.value = chat.repository?.fullName ?? "";
    repoSelect.addEventListener("change", () => {
      const repo = repos.find((entry) => entry.fullName === repoSelect.value);
      if (repo) void loadTree(repo.fullName, repo.defaultBranch, true);
      else if (repoSelect.value === "") {
        repositoryGeneration += 1;
        tree = null;
        selectedPaths.clear();
        newChat(null);
        renderRepos(login);
        renderFiles();
      }
    });
    githubHost.replaceChildren(connection, element("h2", "", "Repository"), repoSelect);
    if (nextRepoPage !== null) githubHost.append(button("Load more repositories", undefined, () => void loadRepos(nextRepoPage!, login), "bw-retry"));
    if (repos.length === 0) githubHost.append(element("p", "", "No repositories found. Create one on GitHub, then reload this list."));
    if (chat.repository) {
      const branch = element("input", "bw-field");
      branch.value = chat.repository.branch;
      branch.setAttribute("aria-label", "GitHub branch");
      branch.dataset["lock"] = "turn";
      const openBranch = button("Open branch", WEB_ICON.branch, () => { if (branch.value.trim()) void loadTree(chat.repository!.fullName, branch.value.trim(), true); });
      openBranch.dataset["lock"] = "turn";
      githubHost.append(branch, openBranch);
    }
    const disconnect = button("Disconnect GitHub", undefined, () => void (async () => {
      try { await api.githubDisconnect(); if (!disposed) { githubGeneration += 1; repos = []; tree = null; selectedPaths.clear(); newChat(null); showDisconnected(); renderFiles(); } }
      catch (error) { setStatus(message(error), true); }
    })(), "bw-retry");
    disconnect.dataset["lock"] = "turn";
    githubHost.append(disconnect);
    syncControls();
  }

  async function loadTree(repo: string, ref: string, changeChat: boolean): Promise<void> {
    const generation = ++repositoryGeneration;
    repositoryLoading = true;
    syncControls();
    filesHost.replaceChildren(element("p", "bw-muted", "Reading repository files…"));
    try {
      const result = await api.githubTree(repo, ref, lifetime.signal);
      if (disposed || generation !== repositoryGeneration) return;
      repositoryLoading = false;
      tree = result;
      selectedPaths.clear();
      if (changeChat) {
        previousFiles.clear();
        const repository = { fullName: repo, branch: ref, commit: result.commit };
        if (chat.messages.length > 0) newChat(repository);
        else { chat = { ...chat, repository }; renderConversation(); }
      }
      renderRepos();
      renderFiles();
      updateContext();
    } catch (error) {
      if (disposed || generation !== repositoryGeneration) return;
      filesHost.replaceChildren(element("p", "", message(error)), button("Read files again", undefined, () => void loadTree(repo, ref, changeChat)));
    } finally {
      if (generation === repositoryGeneration) repositoryLoading = false;
      if (!disposed) syncControls();
    }
  }

  function renderFiles(): void {
    filesHost.replaceChildren();
    if (!tree || !chat.repository) return;
    const filter = element("input", "bw-field");
    filter.placeholder = "Find a file…";
    filter.type = "search";
    filter.setAttribute("aria-label", "Find repository file");
    const list = element("div", "bw-files");
    const preview = element("div");
    const paint = (): void => {
      list.replaceChildren();
      const matching = tree!.files.filter((entry) => entry.path.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase()));
      for (const file of matching.slice(0, 150)) {
        const row = element("div", "bw-file");
        const check = element("input");
        check.type = "checkbox";
        check.checked = selectedPaths.has(file.path);
        check.setAttribute("aria-label", `Include ${file.path} in your next message`);
        check.dataset["lock"] = "turn";
        check.addEventListener("change", () => {
          if (check.checked && selectedPaths.size >= 8) { check.checked = false; setStatus("Choose up to 8 files for one message."); return; }
          if (check.checked) selectedPaths.add(file.path); else selectedPaths.delete(file.path);
          updateContext();
        });
        const open = button(file.path, undefined, () => void (async () => {
          const selected = chat.repository!;
          preview.replaceChildren(element("p", "bw-muted", "Opening file…"));
          try {
            const result = await api.githubFile(selected.fullName, selected.commit, file.path, lifetime.signal);
            if (disposed || chat.repository?.fullName !== selected.fullName || chat.repository.commit !== selected.commit) return;
            previousFiles.set(file.path, result.content);
            const details = element("details", "bw-proposal");
            details.open = true;
            details.append(element("summary", "", file.path), element("pre", "", result.content));
            preview.replaceChildren(details);
          } catch (error) { if (!disposed) preview.replaceChildren(element("p", "", message(error))); }
        })(), "bw-history-item");
        open.title = file.path;
        row.append(check, open);
        list.append(row);
      }
      if (matching.length > 150) list.append(element("p", "bw-muted", `${matching.length} files. Search to narrow the list.`));
      if (matching.length === 0) list.append(element("p", "bw-muted", "No matching files."));
      syncControls();
    };
    filter.addEventListener("input", paint);
    filesHost.append(element("h2", "", "File context"), element("p", "bw-muted", "Choose files to include, or let ADCode find the relevant code as you chat."), filter, list, preview);
    if (tree.truncated) filesHost.append(element("p", "bw-muted", "GitHub returned part of this large repository. You can still ask about a specific file path."));
    paint();
  }

  function renderProposals(): void {
    proposalsHost.replaceChildren();
    const proposals = chat.proposals ?? [];
    rail.setBadge("changes", proposals.length > 0 ? String(proposals.length) : "");
    if (proposals.length === 0) return;
    proposalsHost.append(element("h2", "", `Proposed changes · ${proposals.length}`), element("p", "bw-muted", "Review these files. Nothing is written to GitHub until you create a pull request."));
    for (const proposal of proposals) {
      const details = element("details", "bw-proposal");
      const summary = element("summary", "", `${proposal.content === null ? "Delete · " : ""}${proposal.path}`);
      const code = element("pre");
      const previous = previousFiles.get(proposal.path);
      if (previous !== undefined) {
        for (const line of browserFileDiff(previous, proposal.content)) {
          const row = element("span", "bw-diff-line", `${line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "} ${line.text}`);
          row.dataset["kind"] = line.kind;
          code.append(row);
        }
      } else code.textContent = proposal.content ?? "This file will be deleted.";
      details.append(summary, code);
      proposalsHost.append(details);
    }
    if (!chat.repository) { proposalsHost.append(element("p", "bw-muted", "Connect a repository to save changes as a pull request.")); return; }
    if (repos.find((entry) => entry.fullName === chat.repository!.fullName)?.canPush === false) {
      proposalsHost.append(element("p", "bw-muted", "You can read this repository. To create a pull request, choose a repository you can write to."));
      return;
    }
    const title = element("input", "bw-field");
    title.value = chat.title === "New chat" ? "Update project with ADCode" : chat.title;
    title.maxLength = 200;
    title.setAttribute("aria-label", "Pull request title");
    title.dataset["lock"] = "turn";
    const publishStatus = element("p", "bw-muted");
    publishStatus.setAttribute("role", "status");
    const publish = button("Create pull request", WEB_ICON.branch, () => void (async () => {
      if (busy || publishing || !chat.repository || !title.value.trim()) return;
      publishing = true;
      syncControls();
      publishStatus.textContent = "Creating your pull request…";
      const selected = chat.repository;
      try {
        const result = await api.publishPullRequest({ repo: selected.fullName, baseBranch: selected.branch, baseCommit: selected.commit, title: title.value.trim(), body: "Changes prepared with ADCode. Review the proposed files before merging.", files: proposals });
        if (disposed) return;
        publishStatus.replaceChildren(githubLink(result.url, `Open pull request #${result.number}`));
        publish.textContent = "Pull request created";
        publishedProposals.add(JSON.stringify({ repository: selected, proposals }));
        publish.dataset["complete"] = "true";
      } catch (error) { if (!disposed) { publishStatus.textContent = message(error); publish.disabled = false; } }
      finally { publishing = false; if (!disposed) syncControls(); }
    })(), "bw-button bw-primary");
    publish.dataset["lock"] = "turn";
    if (publishedProposals.has(JSON.stringify({ repository: chat.repository, proposals }))) {
      publish.dataset["complete"] = "true";
      publish.textContent = "Pull request created";
    }
    publish.disabled = busy || publish.dataset["complete"] === "true";
    proposalsHost.append(title, publish, publishStatus);
  }

  input.addEventListener("input", () => { resizeInput(); persistDraft(); });
  input.addEventListener("keydown", (event) => {
    if (shouldSendBrowserMessage(event)) { event.preventDefault(); if (!busy) void send(); }
  });
  composer.addEventListener("submit", (event) => { event.preventDefault(); if (!busy) void send(); });
  historySearch.addEventListener("input", renderHistory);
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { root.dataset["history"] = "closed"; root.dataset["project"] = "closed"; }
  });
  tabStrip.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...tabStrip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (at + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    tabs[next]?.focus();
  });
  transcript.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".chat-codeblock-copy") : null;
    if (target) {
      const text = target.closest(".chat-codeblock")?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard.writeText(text).then(() => { target.textContent = "Copied"; }, () => setStatus("Copy didn't work. Select the code and copy it manually."));
    }
  });
  restoreDraft();
  renderConversation();
  showDisconnected();
  syncControls();
  void loadConfig();
  void loadHistory();
  void loadGithub();

  return { dispose(): void {
    if (disposed) return;
    persistDraft();
    disposed = true;
    turn?.abort();
    lifetime.abort();
    githubGeneration += 1;
    clearTimeout(authTimer);
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    for (const dialog of dialogs) { dialog.close(); dialog.remove(); }
    dialogs.clear();
    root.remove();
  } };
}
