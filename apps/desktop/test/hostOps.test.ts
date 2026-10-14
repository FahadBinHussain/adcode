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
import { createHostOps } from "../src/host/hostOps.ts";

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
