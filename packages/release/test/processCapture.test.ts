import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const helper = pathToFileURL(resolve(import.meta.dirname, "../../../scripts/capture-process.mjs")).href;
function run(source: string): string {
  return execFileSync(process.execPath, ["--input-type=module", "-e", `import { captureProcess } from ${JSON.stringify(helper)}; ${source}`], { encoding: "utf8", timeout: 10_000 }).trim();
}

it("keeps initialization diagnostics out of a successful machine-readable result", () => {
  const program = "process.stderr.write('#< CLIXML\\nPreparing modules for first use'); process.stdout.write('0\\r\\n')";
  expect(run(`console.log(JSON.stringify(await captureProcess(process.execPath, ['-e', ${JSON.stringify(program)}])));`)).toBe('"0"');
});

it("retains both streams when a command fails", () => {
  const program = "process.stdout.write('context'); process.stderr.write('failure detail'); process.exitCode=7";
  const result = run(`try { await captureProcess(process.execPath, ['-e', ${JSON.stringify(program)}]); } catch (error) { console.log(error.message); }`);
  expect(result).toContain("exited 7");
  expect(result).toContain("contextfailure detail");
});

it("waits for its owned child to stop when a command times out", () => {
  const result = run("try { await captureProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 100 }); } catch (error) { console.log(error.message); }");
  expect(result).toContain("timed out");
});
