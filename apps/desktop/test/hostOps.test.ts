/*
 * The web-only operations adcode-host answers.
 *
 * The desktop opens any folder through the system dialog. The web has one place projects live,
 * `~/projects` in the sandbox, and the project picker lists it. Hidden folders are not projects.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostOps, repoFolderName } from "../src/host/hostOps.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectsHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "adcode-ops-"));
  made.push(dir);
  return dir;
}

describe("projects", () => {
  it("lists project folders, newest first, without hidden folders or loose files", async () => {
    const home = projectsHome();
    mkdirSync(join(home, "snake-game"));
    mkdirSync(join(home, "portfolio"));
    mkdirSync(join(home, ".trash"));
    writeFileSync(join(home, "notes.txt"), "x");
    utimesSync(join(home, "snake-game"), new Date(1000), new Date(1000));
    utimesSync(join(home, "portfolio"), new Date(5000), new Date(5000));
    const projects = (await createHostOps({ projectsHome: home })["projects"]!()) as { name: string; path: string; modifiedAt: number }[];
    expect(projects.map((project) => project.name)).toEqual(["portfolio", "snake-game"]);
    expect(projects[0]!.path).toBe(join(home, "portfolio"));
  });

  it("is empty when there is no projects folder yet", async () => {
    expect(await createHostOps({ projectsHome: join(projectsHome(), "missing") })["projects"]!()).toEqual([]);
  });
});

describe("making a project for an upload", () => {
  it("makes a folder named like the upload, and a fresh one when the name is taken", async () => {
    const home = projectsHome();
    const ops = createHostOps({ projectsHome: home });
    const first = (await ops["createProjectFolder"]!("My Site!")) as string;
    const second = (await ops["createProjectFolder"]!("My Site!")) as string;
    expect(first).toBe(join(home, "my-site"));
    expect(second).toBe(join(home, "my-site-2"));
  });

  it("falls back to a plain name when nothing usable is left", async () => {
    const home = projectsHome();
    expect(await createHostOps({ projectsHome: home })["createProjectFolder"]!("../../")).toBe(join(home, "project"));
  });
});

describe("writing uploaded files", () => {
  it("writes bytes at a path inside the project, making folders as needed", async () => {
    const home = projectsHome();
    const ops = createHostOps({ projectsHome: home });
    const root = (await ops["createProjectFolder"]!("site")) as string;
    await ops["writeFile"]!(root, "src/app.js", new Uint8Array([104, 105]));
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(root, "src", "app.js"), "utf8")).toBe("hi");
  });

  it("refuses to write outside the project or outside the projects home", async () => {
    const home = projectsHome();
    const ops = createHostOps({ projectsHome: home });
    const root = (await ops["createProjectFolder"]!("site")) as string;
    for (const path of ["../escape.txt", "/etc/passwd", "a/../../escape.txt", "C:\\Windows\\x.txt", "ok\u0000.txt", ""]) {
      await expect(ops["writeFile"]!(root, path, new Uint8Array([1]))).rejects.toThrow();
    }
    await expect(ops["writeFile"]!(tmpdir(), "x.txt", new Uint8Array([1]))).rejects.toThrow();
  });
});

describe("importing from GitHub", () => {
  it("names the project after the repository", () => {
    expect(repoFolderName("https://github.com/bluethenics/adcode.git")).toBe("adcode");
    expect(repoFolderName("https://github.com/someone/My-App/")).toBe("my-app");
    expect(repoFolderName("https://gitlab.com/group/sub/thing")).toBe("thing");
  });

  it("refuses anything but an https address, because other git transports can run commands", async () => {
    const ops = createHostOps({ projectsHome: projectsHome() });
    for (const url of ["ext::sh -c touch% /tmp/pwned", "file:///etc", "git@github.com:a/b.git", "http://github.com/a/b", "https://", "--upload-pack=touch /tmp/x"]) {
      await expect(ops["cloneProject"]!(url)).rejects.toThrow("https");
    }
  });
});
