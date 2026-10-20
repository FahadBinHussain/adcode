// Holds the status page SQL to the TypeScript rules, in a real Postgres.
//
// Replays every migration into PGlite (Postgres compiled to WebAssembly), then drives the
// same incident through `status_create_incident` / `status_add_incident_update` and through
// the in-memory store (`services/api/src/memoryStore.ts`), and checks that both answer the
// same: opening stamps created/updated, resolving stamps the resolution time, reopening
// clears it, an update to an incident that does not exist changes nothing, and the two
// datasets assemble into the same public view.
//
// No test in `npm run verify` can execute SQL; run this after any change to either side.
//
//   npm install --no-save @electric-sql/pglite
//   node scripts/check-status-sql.mjs .
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const ROOT = process.argv[2] ?? ".";
const MIG = join(ROOT, "supabase/migrations");
const { createMemoryStore } = await import(pathToFileURL(join(ROOT, "services/api/src/memoryStore.ts")).href);
const { assembleStatusView } = await import(pathToFileURL(join(ROOT, "services/api/src/status.ts")).href);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create schema cron;
  create table cron.jobs_seen (name text, schedule text, command text);
  create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ insert into cron.jobs_seen values (a, b, c) returning 1::bigint $$;
`);
for (const name of readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(MIG, name), "utf8").replace(/create extension if not exists pg_cron[^;]*;/gi, "");
  try { await db.exec(sql); } catch (error) { console.error(`MIGRATION FAILED: ${name}: ${error.message}`); process.exit(1); }
}
console.log("migrations: all applied");

const num = (value) => (value === null || value === undefined ? null : Number(value));
const T0 = Date.parse("2026-10-19T09:00:00Z");
const HOUR = 3_600_000;

const openSql = (incidentId, updateId, title, impact, status, body, at) =>
  db.query(`select public.status_create_incident($1,$2,$3,$4,$5,$6,$7,$8) as r`, [
    incidentId, updateId, title, impact, status, body, "admin-1", at,
  ]);

const addSql = (incidentId, updateId, status, body, at) =>
  db.query(`select public.status_add_incident_update($1,$2,$3,$4,$5,$6) as r`, [
    incidentId, updateId, status, body, "admin-1", at,
  ]);

const sqlIncidents = async () => {
  const { rows } = await db.query(
    `select incident_id, title, impact, status, author_uid, created_at, updated_at, resolved_at from public.status_incidents order by incident_id`,
  );
  return rows.map((row) => ({
    incidentId: row.incident_id,
    title: row.title,
    impact: row.impact,
    status: row.status,
    authorUid: row.author_uid,
    createdAt: num(row.created_at),
    updatedAt: num(row.updated_at),
    resolvedAt: num(row.resolved_at),
  }));
};

const sqlUpdates = async () => {
  const { rows } = await db.query(
    `select update_id, incident_id, status, body, author_uid, created_at from public.status_incident_updates order by update_id`,
  );
  return rows.map((row) => ({
    updateId: row.update_id,
    incidentId: row.incident_id,
    status: row.status,
    body: row.body,
    authorUid: row.author_uid,
    createdAt: num(row.created_at),
  }));
};

const memory = createMemoryStore();
const incident = (over) => ({
  incidentId: "inc-1",
  title: "Elevated errors on free models",
  impact: "major",
  status: "investigating",
  authorUid: "admin-1",
  createdAt: T0,
  updatedAt: T0,
  resolvedAt: null,
  ...over,
});
const firstUpdate = {
  updateId: "incupd-1",
  incidentId: "inc-1",
  status: "investigating",
  body: "Requests to free models are failing for some people. We are looking.",
  authorUid: "admin-1",
  createdAt: T0,
};

/* The same sequence, once through Postgres and once through the memory store. */
await openSql("inc-1", "incupd-1", "Elevated errors on free models", "major", "investigating", firstUpdate.body, T0);
await memory.createStatusIncident(incident({}), firstUpdate);

const resolvedAt = T0 + HOUR;
await addSql("inc-1", "incupd-2", "resolved", "The fix is deployed.", resolvedAt);
await memory.addStatusIncidentUpdate("inc-1", {
  updateId: "incupd-2", incidentId: "inc-1", status: "resolved",
  body: "The fix is deployed.", authorUid: "admin-1", createdAt: resolvedAt,
});

const reopenedAt = T0 + 2 * HOUR;
await addSql("inc-1", "incupd-3", "monitoring", "It came back; still watching.", reopenedAt);
await memory.addStatusIncidentUpdate("inc-1", {
  updateId: "incupd-3", incidentId: "inc-1", status: "monitoring",
  body: "It came back; still watching.", authorUid: "admin-1", createdAt: reopenedAt,
});

/* An incident that does not exist: the function says so and writes no update. */
const missing = await addSql("inc-does-not-exist", "incupd-4", "resolved", "Nothing.", reopenedAt);
assert.equal(missing.rows[0].r, false, "status_add_incident_update on a missing incident must return false");
assert.equal(
  await memory.addStatusIncidentUpdate("inc-does-not-exist", {
    updateId: "incupd-4", incidentId: "inc-does-not-exist", status: "resolved",
    body: "Nothing.", authorUid: "admin-1", createdAt: reopenedAt,
  }),
  false,
  "memoryStore must refuse a missing incident too",
);
assert.equal((await sqlUpdates()).length, 3, "a refused update must not be written");

/* Opening resolved is allowed, and stamps the resolution time. */
const bornResolvedAt = T0 + 3 * HOUR;
await openSql("inc-2", "incupd-5", "Scheduled maintenance", "maintenance", "resolved", "Done in 40 minutes.", bornResolvedAt);
await memory.createStatusIncident(
  incident({
    incidentId: "inc-2",
    title: "Scheduled maintenance",
    impact: "maintenance",
    status: "resolved",
    createdAt: bornResolvedAt,
    updatedAt: bornResolvedAt,
    resolvedAt: bornResolvedAt,
  }),
  {
    updateId: "incupd-5", incidentId: "inc-2", status: "resolved",
    body: "Done in 40 minutes.", authorUid: "admin-1", createdAt: bornResolvedAt,
  },
);

const fromSql = { incidents: await sqlIncidents(), updates: await sqlUpdates() };
const fromMemory = {
  incidents: await memory.listStatusIncidents(),
  updates: await memory.listStatusIncidentUpdates(),
};

const byId = (rows) => new Map(rows.map((row) => [row.incidentId, row]));
assert.deepEqual(
  byId(fromSql.incidents).get("inc-1"),
  {
    incidentId: "inc-1",
    title: "Elevated errors on free models",
    impact: "major",
    status: "monitoring",
    authorUid: "admin-1",
    createdAt: T0,
    updatedAt: reopenedAt,
    resolvedAt: null,
  },
  "the row must mirror its newest update, and a reopen must clear resolved_at",
);
assert.deepEqual(
  byId(fromSql.incidents).get("inc-2"),
  {
    incidentId: "inc-2",
    title: "Scheduled maintenance",
    impact: "maintenance",
    status: "resolved",
    authorUid: "admin-1",
    createdAt: bornResolvedAt,
    updatedAt: bornResolvedAt,
    resolvedAt: bornResolvedAt,
  },
  "an incident opened as resolved must be stamped resolved",
);

const sort = (rows, key) => [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
assert.deepEqual(
  sort(fromSql.incidents, "incidentId"),
  sort(fromMemory.incidents, "incidentId"),
  "SQL and memoryStore must hold the same incidents",
);
assert.deepEqual(
  sort(fromSql.updates, "updateId"),
  sort(fromMemory.updates, "updateId"),
  "SQL and memoryStore must hold the same updates",
);

const now = T0 + 4 * HOUR;
assert.deepEqual(
  assembleStatusView({ now, days: 90, outcomes: [], ...fromSql }),
  assembleStatusView({ now, days: 90, outcomes: [], ...fromMemory }),
  "the public view assembled from SQL must equal the one assembled from memory",
);

console.log("status page SQL: creates, resolves, reopens and refuses exactly like memoryStore");
