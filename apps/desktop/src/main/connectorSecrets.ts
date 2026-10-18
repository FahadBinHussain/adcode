/**
 * The values a connector needs to work: API keys, tokens, environment values, headers.
 *
 * Brief §5.2's rule - "keys are stored in the OS keychain, never in settings JSON" -
 * applies to every credential an imported connector carries, not just model provider keys.
 * An MCP config copied out of Claude Desktop is full of `GITHUB_PERSONAL_ACCESS_TOKEN`
 * values; an OpenAPI action arrives with a token. None of them may land in
 * `assistant-controls.json`, which is user-readable, sometimes synced, and pasted into
 * bug reports.
 *
 * So the saved connector keeps only the *names* of its values, and the values themselves
 * live here, encrypted with the same OS store (`safeStorage`) the provider keys use.
 * Like that store, this one fails closed: if the OS cannot encrypt, nothing is written
 * rather than a value being quietly persisted in the clear.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, safeStorage } from "electron";

const FILENAME = "connector-secrets.json";
/** One connector's values: name to base64 ciphertext. */
type ConnectorValues = Record<string, string>;
/** Connector ID to values. */
type Stored = Record<string, ConnectorValues>;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Env names, header names, and the reserved `__base_url` key all fit this. */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const PROTECTED = new Set(["constructor", "prototype", "__proto__"]);
const MAX_VALUE_LENGTH = 4_096;

export interface ConnectorSecretStore {
  /** Every value saved for this connector, decrypted. Empty when none are. */
  read(id: string): Promise<Readonly<Record<string, string>>>;
  /** Replace this connector's values with exactly the given map. */
  write(id: string, values: Readonly<Record<string, string>>): Promise<void>;
  /** Forget everything saved for this connector. */
  clear(id: string): Promise<void>;
}

export function validSecretKey(key: string): boolean {
  return KEY_PATTERN.test(key) && !PROTECTED.has(key);
}

export function validConnectorId(id: string): boolean {
  return ID_PATTERN.test(id) && !PROTECTED.has(id);
}

function filePath(): string {
  return join(app.getPath("userData"), FILENAME);
}

async function readAll(): Promise<Stored> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath(), "utf8"));
    if (typeof parsed !== "object" || parsed === null) return {};

    const out: Stored = Object.create(null) as Stored;
    for (const [id, values] of Object.entries(parsed as Record<string, unknown>)) {
      if (!validConnectorId(id) || typeof values !== "object" || values === null) continue;
      const entry: ConnectorValues = Object.create(null) as ConnectorValues;
      for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
        if (validSecretKey(key) && typeof value === "string") entry[key] = value;
      }
      out[id] = entry;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeAll(values: Stored): Promise<void> {
  const target = filePath();
  const temporary = `${target}.tmp`;

  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(temporary, JSON.stringify(values, null, 2), "utf8");
  await rename(temporary, target);
}

// One writer at a time: a read-modify-write must not interleave with another connector's.
let writes: Promise<unknown> = Promise.resolve();
function mutate(work: () => Promise<void>): Promise<void> {
  const next = writes.then(work);
  writes = next.catch(() => undefined);
  return next;
}

function checkEntry(id: string, values: Readonly<Record<string, string>>): void {
  if (!validConnectorId(id)) throw new Error("Invalid connector ID for stored values.");
  for (const [key, value] of Object.entries(values)) {
    if (!validSecretKey(key)) throw new Error(`Invalid value name: ${key}`);
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH || value.includes("\0")) throw new Error(`The value for ${key} is empty or too long.`);
  }
}

export function createConnectorSecrets(): ConnectorSecretStore {
  return {
    async read(id: string): Promise<Readonly<Record<string, string>>> {
      await writes;
      if (!validConnectorId(id)) return {};
      const stored = (await readAll())[id];
      if (stored === undefined) return {};
      if (!safeStorage.isEncryptionAvailable()) return {};

      const out: Record<string, string> = {};
      for (const [key, blob] of Object.entries(stored)) {
        try {
          out[key] = safeStorage.decryptString(Buffer.from(blob, "base64"));
        } catch {
          // A blob this machine cannot decrypt - copied from another profile, or written
          // before the OS credential store was reset. Treat it as absent.
        }
      }
      return out;
    },

    async write(id: string, values: Readonly<Record<string, string>>): Promise<void> {
      checkEntry(id, values);
      return mutate(async () => {
        // Fail closed, exactly like the provider key store: a value that cannot be
        // encrypted is not written at all.
        if (Object.keys(values).length > 0 && !safeStorage.isEncryptionAvailable()) {
          throw new Error("The OS credential store is unavailable, so the connector's values were not saved.");
        }

        const all = await readAll();
        if (Object.keys(values).length === 0) delete all[id];
        else all[id] = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, safeStorage.encryptString(value).toString("base64")]));

        if (Object.keys(all).length === 0) {
          try {
            await unlink(filePath());
          } catch {
            // Nothing to remove.
          }
          return;
        }
        await writeAll(all);
      });
    },

    async clear(id: string): Promise<void> {
      if (!validConnectorId(id)) return;
      return mutate(async () => {
        const all = await readAll();
        if (all[id] === undefined) return;
        delete all[id];
        if (Object.keys(all).length === 0) {
          try {
            await unlink(filePath());
          } catch {
            // Nothing to remove.
          }
          return;
        }
        await writeAll(all);
      });
    },
  };
}
