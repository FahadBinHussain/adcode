/**
 * `window.adcode` for a browser tab, built from the bridge table.
 *
 * Every method the desktop preload forwards over Electron IPC is forwarded over the socket
 * here, with the same channel and the same fixed arguments - `test/webBridgeTable.test.ts`
 * holds the two to each other. A few methods are better answered by the browser itself (the
 * clipboard, downloads, full screen); those come in as `local` overrides keyed by
 * `"namespace.method"`, and win over the socket.
 */
import type { AdcodeApi } from "../shared/api.ts";
import { BRIDGE, type ApiPath } from "./bridgeTable.ts";
import type { HostSocket } from "./socket.ts";

export type LocalOverrides = Partial<Record<ApiPath, (...args: never[]) => unknown>>;

export function createWebApi(socket: HostSocket, local: LocalOverrides): AdcodeApi {
  const api: Record<string, Record<string, unknown>> = {};
  for (const entry of BRIDGE) {
    const [namespace, method] = entry.path.split(".") as [string, string];
    const target = (api[namespace] ??= {});
    const override = local[entry.path];
    if (override !== undefined) {
      target[method] = override;
      continue;
    }
    const fixed: readonly unknown[] = "fixed" in entry ? entry.fixed : [];
    switch (entry.kind) {
      case "invoke":
        target[method] = (...args: unknown[]) => socket.invoke(entry.channel, [...fixed, ...args]);
        break;
      case "send":
        target[method] = (...args: unknown[]) => socket.send(entry.channel, [...fixed, ...args]);
        break;
      case "subscribe":
        target[method] = (listener: (...args: unknown[]) => void) => socket.subscribe(entry.channel, listener);
        break;
      case "local":
        target[method] = () => "";
        break;
    }
  }
  return api as unknown as AdcodeApi;
}
