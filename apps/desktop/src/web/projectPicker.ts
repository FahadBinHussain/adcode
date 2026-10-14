/**
 * "Open a project" on the web: the sandbox's projects, instead of the system folder dialog.
 *
 * On the desktop, opening a folder means Electron's file dialog. In a cloud sandbox there is one
 * place projects live, so main-process code that asks for a folder gets this list instead. New
 * projects still come from describing one in the chat; importing from GitHub and uploading are
 * offered here too, through the actions passed in.
 */
import { relativeTime } from "./gateText.ts";

export interface ProjectSummary {
  readonly name: string;
  readonly path: string;
  readonly modifiedAt: number;
}

export interface ProjectPickerDeps {
  readonly listProjects: () => Promise<readonly ProjectSummary[]>;
  /** Extra actions under the list (Import from GitHub, Upload); each resolves with a path to open, or null. */
  readonly extras?: readonly { readonly label: string; readonly run: () => Promise<string | null> }[];
}

export function pickProjectFolder(deps: ProjectPickerDeps): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "web-picker";
    dialog.setAttribute("aria-labelledby", "web-picker-title");
    let settled = false;
    const finish = (path: string | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(path);
    };

    const header = document.createElement("header");
    header.className = "web-picker-header";
    const title = document.createElement("h2");
    title.id = "web-picker-title";
    title.textContent = "Open a project";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "web-picker-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.addEventListener("click", () => finish(null));
    header.append(title, close);

    const list = document.createElement("ul");
    list.className = "web-picker-list";
    list.setAttribute("aria-busy", "true");
    const loading = document.createElement("li");
    loading.className = "web-picker-empty";
    loading.textContent = "Loading your projects…";
    list.append(loading);

    const footer = document.createElement("footer");
    footer.className = "web-picker-footer";
    for (const extra of deps.extras ?? []) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "web-gate-button";
      button.textContent = extra.label;
      button.addEventListener("click", () => {
        void extra.run().then((path) => {
          if (path !== null) finish(path);
        });
      });
      footer.append(button);
    }

    dialog.append(header, list, footer);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) finish(null);
    });
    document.body.append(dialog);
    dialog.showModal();

    void deps.listProjects()
      .catch(() => [] as readonly ProjectSummary[])
      .then((projects) => {
        list.replaceChildren();
        list.removeAttribute("aria-busy");
        if (projects.length === 0) {
          const empty = document.createElement("li");
          empty.className = "web-picker-empty";
          empty.textContent = "No projects yet. Close this and describe what you want to build - ADCode makes the project for you.";
          list.append(empty);
          return;
        }
        const now = Date.now();
        for (const project of projects) {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "web-picker-item";
          const name = document.createElement("span");
          name.className = "web-picker-name";
          name.textContent = project.name;
          const when = document.createElement("span");
          when.className = "web-picker-when";
          when.textContent = relativeTime(project.modifiedAt, now);
          button.append(name, when);
          button.addEventListener("click", () => finish(project.path));
          item.append(button);
          list.append(item);
        }
        list.querySelector<HTMLButtonElement>("button")?.focus();
      });
  });
}
