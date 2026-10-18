/**
 * The Cloud workspace panel: everything about this person's sandbox, in one place.
 *
 * Time left in this session, storage used, their projects (each downloadable), whether GitHub is
 * connected, signing out, and deleting the whole cloud workspace. It opens from the time-left
 * chip, from the Feature library and from the command palette (`cloud.workspace`), all of which
 * dispatch `OPEN_CLOUD_WORKSPACE_EVENT`; it lives here rather than in the renderer so the desktop
 * build never carries it.
 */
import { connectGitHub } from "./githubConnect.ts";
import { formatReset, formatTimeLeft, relativeTime } from "./gateText.ts";
import { downloadProject } from "./projectActions.ts";
import type { ProjectSummary } from "./projectPicker.ts";
import type { HostSocket } from "./socket.ts";
import type { CloudStatus } from "./wire.ts";

export interface CloudPanelDeps {
  readonly socket: HostSocket;
  /** The latest cloud status, or null when there is no cloud in front (local development). */
  readonly status: () => CloudStatus | null;
  readonly token: () => Promise<string | null>;
  readonly signOut: () => Promise<void>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function megabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function openCloudPanel(deps: CloudPanelDeps): void {
  if (document.querySelector("dialog.web-cloud") !== null) return;
  const dialog = el("dialog", "web-picker web-cloud");
  dialog.setAttribute("aria-labelledby", "web-cloud-title");
  const header = el("header", "web-picker-header");
  const title = el("h2", undefined, "Cloud workspace");
  title.id = "web-cloud-title";
  const close = el("button", "web-picker-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  header.append(title, close);
  const body = el("div", "web-action-body web-cloud-body");
  dialog.append(header, body);
  document.body.append(dialog);
  const shut = (): void => {
    dialog.close();
    dialog.remove();
  };
  close.addEventListener("click", shut);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    shut();
  });

  /* Time and storage */
  const status = deps.status();
  const time = el("section", "web-cloud-section");
  if (status === null) {
    time.append(el("p", "web-gate-lead", "Running locally: no time limit applies here."));
  } else if (status.unlimited || status.allowanceMs <= 0) {
    time.append(
      el("h3", "web-cloud-heading", "No personal time limit"),
      el("p", "web-action-status", `Your workspace sleeps when idle and resumes when you return. Shared service capacity still applies. Saved copy: ${megabytes(status.storageBytes ?? 0)} of 2 GB.`),
    );
  } else {
    const left = Math.max(0, status.allowanceMs - status.usedMs);
    const meter = el("div", "web-cloud-meter");
    const fill = el("div", "web-cloud-meter-fill");
    fill.style.width = `${Math.min(100, Math.round((left / Math.max(1, status.allowanceMs)) * 100))}%`;
    meter.append(fill);
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", String(Math.round(status.allowanceMs / 60_000)));
    meter.setAttribute("aria-valuenow", String(Math.round(left / 60_000)));
    meter.setAttribute("aria-label", "Cloud time left in this session");
    time.append(
      el("h3", "web-cloud-heading", formatTimeLeft(left)),
      meter,
      el("p", "web-action-status", `${formatReset(status.resetsAt)}. Your workspace sleeps when nothing is happening, so idle time isn't spent. Saved copy: ${megabytes(status.storageBytes ?? 0)} of 2 GB.`),
    );
  }
  body.append(time);

  /* Projects */
  const projects = el("section", "web-cloud-section");
  projects.append(el("h3", "web-cloud-heading", "Projects"));
  const list = el("ul", "web-picker-list web-cloud-projects");
  list.append(el("li", "web-picker-empty", "Loading…"));
  projects.append(list);
  body.append(projects);
  void (deps.socket.op("projects", []) as Promise<ProjectSummary[]>).then((found) => {
    list.replaceChildren();
    if (found.length === 0) {
      list.append(el("li", "web-picker-empty", "No projects yet. Describe something to build and ADCode makes one."));
      return;
    }
    const now = Date.now();
    for (const project of found) {
      const row = el("li", "web-cloud-project");
      const name = el("span", "web-picker-name", project.name);
      const when = el("span", "web-picker-when", relativeTime(project.modifiedAt, now));
      const download = el("button", "web-gate-link", "Download");
      download.type = "button";
      download.addEventListener("click", () => {
        download.textContent = "Preparing…";
        void downloadProject(project.name, status !== null, deps.token)
          .then(() => { download.textContent = "Download"; })
          .catch((error: unknown) => { download.textContent = error instanceof Error ? error.message : "Try again"; });
      });
      row.append(name, when, download);
      list.append(row);
    }
  }, () => {
    list.replaceChildren(el("li", "web-picker-empty", "Couldn't list your projects. Try again in a moment."));
  });

  /* GitHub */
  const github = el("section", "web-cloud-section");
  github.append(el("h3", "web-cloud-heading", "GitHub"));
  const githubLine = el("p", "web-action-status", "Checking…");
  const githubButton = el("button", "web-gate-button", "Connect GitHub");
  githubButton.type = "button";
  github.append(githubLine, githubButton);
  body.append(github);
  const refreshGitHub = (): void => {
    void (deps.socket.op("githubStatus", []) as Promise<{ connected: boolean; login: string | null }>).then((state) => {
      githubLine.textContent = state.connected
        ? `Connected${state.login === null ? "" : ` as @${state.login}`}. Commit & Push works from here.`
        : "Not connected. Connect to push to your repositories and import private ones.";
      githubButton.textContent = state.connected ? "Disconnect" : "Connect GitHub";
      githubButton.onclick = () => {
        void (state.connected ? deps.socket.op("githubDisconnect", []) : connectGitHub(deps.socket, "Connect once to push and import private repositories.")).then(refreshGitHub);
      };
    }, () => { githubLine.textContent = "Couldn't check GitHub."; });
  };
  refreshGitHub();

  /* Account */
  const account = el("section", "web-cloud-section web-cloud-danger");
  account.append(el("h3", "web-cloud-heading", "Account"));
  const signOut = el("button", "web-gate-button", "Sign out");
  signOut.type = "button";
  signOut.addEventListener("click", () => void deps.signOut());
  const erase = el("button", "web-gate-button web-cloud-delete", "Delete my cloud workspace");
  erase.type = "button";
  const eraseNote = el("p", "web-action-status");
  erase.addEventListener("click", () => {
    if (status === null) {
      eraseNote.textContent = "There is no cloud workspace when running locally.";
      return;
    }
    const sure = window.confirm("Delete your cloud workspace?\n\nEvery project, conversation and saved setting in the cloud is removed for good. Your account and earnings stay. Download anything you want to keep first.");
    if (!sure) return;
    erase.disabled = true;
    eraseNote.textContent = "Deleting…";
    void deps.token()
      .then((token) => fetch("/api/delete", { method: "POST", headers: token === null ? {} : { authorization: `Bearer ${token}` } }))
      .then((response) => {
        if (!response.ok) throw new Error("not deleted");
        eraseNote.textContent = "Deleted. Signing you out…";
        setTimeout(() => void deps.signOut(), 1200);
      })
      .catch(() => {
        erase.disabled = false;
        eraseNote.textContent = "That didn't work. Try again in a moment.";
      });
  });
  const actions = el("div", "web-cloud-actions");
  actions.append(signOut, erase);
  account.append(actions, eraseNote);
  body.append(account);

  dialog.showModal();
}
