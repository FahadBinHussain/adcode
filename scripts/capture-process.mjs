import { spawn } from "node:child_process";
import { basename } from "node:path";

/** Keep machine-readable stdout separate from diagnostics such as PowerShell CLIXML. */
export function captureProcess(executable, args, options = {}) {
  const { timeout = 180_000, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, ...spawnOptions, shell: false });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout?.on("data", data => { stdout += data; });
    child.stderr?.on("data", data => { stderr += data; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${basename(executable)} timed out`));
      else if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${basename(executable)} exited ${code}: ${(stdout + stderr).slice(-4000)}`));
    });
  });
}
