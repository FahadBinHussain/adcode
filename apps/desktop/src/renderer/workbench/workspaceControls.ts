import type { GitStatusView } from "../../shared/api.ts";
import { createIcon, type IconSource } from "./icons.ts";
import { WEB_ICON } from "./webIcons.ts";
import { projectName } from "./vibeSidebarModel.ts";

interface Options {
  run(command: string): void;
  changes(): void;
  project(): void;
  browser(): void;
  web: boolean;
}
let serial = 0;
/** A compact, keyboard-accessible workspace inspector, anchored to its trigger. */
export function createWorkspaceControls(options: Options) {
  const element = document.createElement("div");
  element.className = "workspace-controls";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "web-tabs-button workspace-control-trigger";
  trigger.title = "Workspace details and tools";
  trigger.setAttribute("aria-label", trigger.title);
  trigger.setAttribute("aria-expanded", "false");
  const hive = createIcon("M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7zM8 5l2.6 1.5v3L8 11 5.4 9.5v-3z");
  hive.classList.add("workspace-hive");
  trigger.append(hive);
  const panel = document.createElement("div");
  panel.className = "workspace-control-panel";
  panel.id = `workspace-controls-${++serial}`;
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Workspace details and tools");
  trigger.setAttribute("aria-controls", panel.id);
  const group = (name: string) => {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.textContent = name;
    section.append(heading); panel.append(section); return section;
  };
  const row = (parent: HTMLElement, label: string, icon: IconSource, action: () => void) => {
    const button = document.createElement("button"); button.type = "button";
    const text = document.createElement("span"); text.textContent = label;
    button.append(createIcon(icon), text);
    button.addEventListener("click", () => { panel.hidePopover(); action(); });
    parent.append(button); return { button, text };
  };
  const project = group("WORKSPACE");
  const name = row(project, "Open a project", options.web ? WEB_ICON.folder : "M2 4h4l2 2h6v7H2z", options.project);
  row(project, options.web ? "Browser workspace" : "Local workspace", options.web ? WEB_ICON.workspace : "M2 3h12v8H2zM5 14h6M8 11v3", options.project);
  const branch = row(project, "No repository", options.web ? WEB_ICON.branch : "M4 3v10M4 8h5a3 3 0 0 0 3-3V3M2 3a2 2 0 1 0 4 0M10 3a2 2 0 1 0 4 0", options.changes);
  const changes = row(project, "Open a project to see changes", options.web ? WEB_ICON.changes : "M4 2h6l3 3v9H4zM7 8h3M7 11h3", options.changes);
  const tools = group("TOOLS & CONNECTIONS");
  row(tools, "Browser", options.web ? WEB_ICON.browser : "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c-4 4-4 9 0 13M8 1.5c4 4 4 9 0 13", options.browser);
  row(tools, "MCP servers", options.web ? WEB_ICON.servers : "M3 5h10v6H3zM5 2v3M11 2v3M5 11v3M11 11v3", () => options.run("tools.servers"));
  row(tools, "Skills", options.web ? WEB_ICON.skills : "M8 2 1 6l7 4 7-4zM4 8v4l4 2 4-2V8", () => options.run("tools.skills"));
  row(tools, "Built-in tools", options.web ? WEB_ICON.grid : "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z", () => options.run("tools.builtIn"));
  row(tools, "Project memory", options.web ? WEB_ICON.memory : "M3 2h7l3 3v9H3zM6 7h4M6 10h4", () => options.run("tools.memory"));
  const position = () => {
    const rect = trigger.getBoundingClientRect();
    panel.style.top = `${rect.bottom + 8}px`;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - Math.min(340, innerWidth - 16) - 8, rect.right - 340))}px`;
  };
  trigger.addEventListener("click", event => {
    panel.dataset["motion"] = event.detail > 0 ? "pointer" : "keyboard";
    position(); panel.togglePopover();
    if (event.detail === 0 && panel.matches(":popover-open")) name.button.focus();
  });
  panel.addEventListener("toggle", () => trigger.setAttribute("aria-expanded", String(panel.matches(":popover-open"))));
  panel.addEventListener("keydown", event => { if (event.key === "Escape") trigger.focus(); });
  window.addEventListener("resize", () => { if (panel.matches(":popover-open")) position(); });
  element.append(trigger, panel);
  return { element, update(root: string | null, git: GitStatusView | null) {
    name.text.textContent = projectName(root);
    branch.text.textContent = git?.branch ?? (root === null ? "No repository" : "Repository unavailable");
    changes.text.textContent = root === null ? "Open a project to see changes" : git === null ? "Checking changes…" : !git.isRepo ? "Not a Git repository" : git.entries.length === 0 ? "Working tree clean" : `${git.entries.length} changed files`;
    branch.button.disabled = root === null; changes.button.disabled = root === null;
  } };
}
