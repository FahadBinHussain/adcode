"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { AdminModelTabs } from "@/components/AdminModelTabs";
import { useAuth } from "@/components/AuthProvider";
import type { TagflowConfig, TagflowLimits, TagflowModel, TagflowUsage, TagflowUserPolicy } from "@adcode/api/src/tagflowTypes.ts";
import { INCLUDED_PROVIDERS, modelProvider, type IncludedProviderId } from "@adcode/api/src/includedProviders.ts";
import { UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE } from "@adcode/api/src/tagflowConfig.ts";
import "@/components/adminModels.css";
import "@/components/adminTagflow.css";

interface Saved { config: TagflowConfig; keyConfigured: boolean; updatedAt: number; updatedBy: string; connections: { id: IncludedProviderId; configured: boolean }[] }
interface UserView { policy: TagflowUserPolicy | null; limits: TagflowLimits; usage: TagflowUsage; resetsAt: number }
const money = (micros: number): string => `$${(micros / 1_000_000).toFixed(4)}`;

export default function TagflowPage() {
  return <AdminShell title="Free models" subtitle="Offer models without a user API key, choose the default, and control each person's allowance."><AdminModelTabs active="free" /><TagflowEditor /></AdminShell>;
}

function LimitFields({ value, onChange, disabled = false }: { value: TagflowLimits; onChange: (next: TagflowLimits) => void; disabled?: boolean }) {
  return <div className="tagflow-fields">
    <RequestField label="Requests per day" value={value.dailyRequests} unlimited={UNLIMITED_DAILY_REQUESTS} fallback={50} disabled={disabled} onChange={(dailyRequests) => onChange({ ...value, dailyRequests })} />
    <NumberField label="Tokens per day" value={value.dailyTokens} max={1_000_000_000} disabled={disabled} onChange={(dailyTokens) => onChange({ ...value, dailyTokens })} />
    <NumberField label="Spending limit per day (USD)" value={value.dailyCostMicros / 1_000_000} max={1000} step="0.000001" disabled={disabled} onChange={(amount) => onChange({ ...value, dailyCostMicros: Math.round(amount * 1_000_000) })} />
    <RequestField label="Requests per minute" value={value.requestsPerMinute} unlimited={UNLIMITED_REQUESTS_PER_MINUTE} fallback={10} disabled={disabled} onChange={(requestsPerMinute) => onChange({ ...value, requestsPerMinute })} />
  </div>;
}

function RequestField({ label, value, unlimited, fallback, disabled, onChange }: { label: string; value: number; unlimited: number; fallback: number; disabled: boolean; onChange: (value: number) => void }) {
  const unbounded = value === unlimited;
  return <div className="tagflow-field"><label className="admin-models-check"><input type="checkbox" disabled={disabled} checked={unbounded} onChange={(event) => onChange(event.target.checked ? unlimited : fallback)} /> Unlimited {label.toLowerCase()}</label><NumberField label={label} value={unbounded ? fallback : value} max={unlimited - 1} disabled={disabled || unbounded} onChange={onChange} /></div>;
}

function NumberField({ label, value, onChange, min = 0, max, step = "1", disabled = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max: number; step?: string; disabled?: boolean }) {
  return <label className="tagflow-field"><span>{label}</span><input className="input" type="number" required min={min} max={max} step={step} disabled={disabled} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

function TagflowEditor() {
  const { token } = useAuth();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState<TagflowConfig | null>(null);
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<TagflowUsage[]>([]);
  const [usageError, setUsageError] = useState("");
  const [uid, setUid] = useState("");
  const [loadedUid, setLoadedUid] = useState("");
  const [user, setUser] = useState<UserView | null>(null);
  const [userBusy, setUserBusy] = useState(false);
  const [userNotice, setUserNotice] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [inherit, setInherit] = useState(true);
  const [userLimits, setUserLimits] = useState<TagflowLimits | null>(null);

  async function call<T>(path: string, body?: unknown): Promise<T> {
    const idToken = await token();
    if (idToken === null) throw new Error("Sign in again to manage included AI.");
    const response = await fetch(`/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json", ...(path === "/ai/tagflow/chat/completions" ? { "x-adcode-ai-source": "admin-test" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json() as T & { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "Could not load or save. Check the server setup and try again.");
    return result;
  }
  useEffect(() => {
    let active = true;
    void call<Saved>("/admin/tagflow").then((value) => { if (active) { setSaved(value); setDraft(value.config); } }).catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    let active = true;
    setUsageError("");
    void call<{ rows: TagflowUsage[] }>(`/admin/tagflow/usage?day=${encodeURIComponent(day)}`).then((value) => { if (active) setRows(value.rows); }).catch(() => { if (active) { setRows([]); setUsageError("Could not read usage for this date. Try Refresh."); } });
    return () => { active = false; };
  }, [token, day]);

  if (loadError) return <p className="notice" data-tone="error" role="alert">Could not load included AI. Apply the Tagflow database migration and reload this page.</p>;
  if (draft === null || saved === null) return <p className="lede">Loading included AI…</p>;
  const change = (patch: Partial<TagflowConfig>): void => setDraft({ ...draft, ...patch });
  const editModel = (index: number, patch: Partial<TagflowModel>): void => change({ models: draft.models.map((model, at) => at === index ? { ...model, ...patch } : model) });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.config);

  async function save(): Promise<void> {
    setBusy(true); setNotice("");
    try { const result = await call<Saved>("/admin/tagflow", draft); setSaved(result); setDraft(result.config); setNotice("Saved. Limits apply to new requests immediately. Editors refresh the model list within five minutes."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Nothing was saved."); }
    finally { setBusy(false); }
  }
  async function testModel(model: TagflowModel): Promise<void> {
    setTestingModel(model.id); setNotice("");
    try {
      const result = await call<{ choices?: { message?: { content?: string } }[] }>("/ai/tagflow/chat/completions", { model: model.id, messages: [{ role: "user", content: "Reply with the single word: ok" }], max_tokens: 32, stream: false });
      const answer = result.choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error("The model answered without text. Check its chat and tool-call support.");
      setNotice(`${model.name} connected. Test reply: ${answer.slice(0, 120)}`);
      await refreshUsage();
    } catch (error) { setNotice(error instanceof Error ? error.message : "The model test failed. Check its ID and server key."); }
    finally { setTestingModel(null); }
  }
  async function loadUser(selected = uid.trim()): Promise<void> {
    if (!selected) return;
    setUserBusy(true); setUserNotice(""); setUser(null); setLoadedUid("");
    try {
      const result = await call<UserView>(`/admin/tagflow/users/${encodeURIComponent(selected)}`);
      setUid(selected); setLoadedUid(selected); setUser(result); setBlocked(result.policy?.blocked === true); setInherit(result.policy?.limits == null); setUserLimits(result.limits);
    } catch (error) { setUserNotice(error instanceof Error ? error.message : "Could not load this user."); }
    finally { setUserBusy(false); }
  }
  async function saveUser(): Promise<void> {
    if (!loadedUid) return;
    setUserBusy(true); setUserNotice("");
    try {
      const result = await call<UserView>(`/admin/tagflow/users/${encodeURIComponent(loadedUid)}`, { blocked, limits: inherit ? null : userLimits });
      setUser(result); setUserLimits(result.limits); setUserNotice("Saved for this account. Usage already spent remains counted.");
    } catch (error) { setUserNotice(error instanceof Error ? error.message : "Nothing was saved."); }
    finally { setUserBusy(false); }
  }
  async function refreshUsage(): Promise<void> {
    setUsageError("");
    try { const result = await call<{ rows: TagflowUsage[] }>(`/admin/tagflow/usage?day=${encodeURIComponent(day)}`); setRows(result.rows); }
    catch { setRows([]); setUsageError("Could not read usage. Try again."); }
  }

  return <div className="admin-models tagflow-admin">
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="admin-models">
      <div className="admin-toolbar admin-models-toolbar"><label className="admin-models-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => change({ enabled: event.target.checked })} /> Enable included AI</label><div className="admin-models-actions"><button type="button" className="btn" disabled={!dirty || busy} onClick={() => setDraft(saved.config)}>Discard changes</button><button className="btn btn-primary" disabled={!dirty || busy}>{busy ? "Saving…" : "Save settings"}</button></div></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      <section className="admin-models-provider"><h3>Server connections</h3><p className="row-sub">Free to your users means you supply the connection. You cover any provider charges. Add the named encrypted secret in Cloudflare → Workers → adcode → Settings → Variables and Secrets. Keys stay on your server.</p><div className="admin-models-scroll"><table className="admin-models-table"><thead><tr><th scope="col">Provider</th><th scope="col">Server key</th><th scope="col">Cloudflare secret name</th></tr></thead><tbody>{INCLUDED_PROVIDERS.map((provider) => <tr key={provider.id}><td><a href={provider.docs} target="_blank" rel="noreferrer">{provider.name}</a></td><td>{saved.connections?.find((connection) => connection.id === provider.id)?.configured ? "Configured" : "Not configured"}</td><td><code>{provider.secretName}</code>{provider.id === "tagflow" && <small> (your existing tagflow-api is also accepted)</small>}</td></tr>)}</tbody></table></div><p className="row-sub">Models with a missing server key are hidden from users. Reload this page after adding a key. The default must have a configured key before you save an enabled catalog.</p></section>
      <section className="admin-models-provider"><h3>Tagflow connection</h3>
        <label className="tagflow-field"><span>API base URL supplied by Tagflow (including /v1 when required)</span><input className="input" type="url" maxLength={500} value={draft.baseUrl} placeholder="https://your-deployment.tagflow-ai.com/v1" onChange={(event) => change({ baseUrl: event.target.value })} /></label>
        <p className="row-sub">Only HTTPS addresses on tagflow-ai.com or its subdomains are accepted. Get your exact deployment URL and model IDs from Tagflow.</p>
      </section>
      <section className="admin-models-provider"><h3>Default allowance per person</h3><p className="row-sub">Requests are unlimited when the controls below are checked. Token and spending limits still apply. Zero blocks that type of usage. Each day resets at midnight UTC. Chats, completions and agents share one allowance per verified account.</p><LimitFields value={draft.limits} onChange={(limits) => change({ limits })} /><div className="tagflow-fields"><NumberField label="Maximum input tokens per request" min={1} max={1_000_000} value={draft.maxInputTokens} onChange={(maxInputTokens) => change({ maxInputTokens })} /><NumberField label="Maximum output tokens per request" min={1} max={65_536} value={draft.maxOutputTokens} onChange={(maxOutputTokens) => change({ maxOutputTokens })} /></div><p className="row-sub">A request reserves its maximum response before it starts. Without provider token counts, usage is estimated conservatively. Spending uses the prices you enter below.</p></section>
      <section className="admin-models-provider"><header className="admin-card-head"><h3>Models offered to users</h3><button type="button" className="btn" disabled={draft.models.length >= 50} onClick={() => change({ models: [...draft.models, { id: "", name: "", contextWindow: 32_768, maxOutput: 4096, inputPrice: 0, outputPrice: 0 }] })}>Add model</button></header>
        <label className="tagflow-field"><span>Default model</span><select className="select" value={draft.defaultModel} onChange={(event) => change({ defaultModel: event.target.value })}><option value="">Choose a model</option>{draft.models.filter((model) => model.id && model.enabled !== false).map((model, index) => <option key={index} value={model.id}>{model.name || model.id}</option>)}</select></label>
        {draft.models.map((model, index) => <fieldset className="tagflow-model" key={index}>
          <legend>{model.name || `Model ${index + 1}`}</legend>
          {model.id && <Link className="btn" href={`/admin/tagflow/reports?model=${encodeURIComponent(model.id)}`}>View provider report</Link>}
          <label className="admin-models-check"><input type="checkbox" checked={model.enabled !== false} onChange={(event) => { const enabled = event.target.checked; change({ models: draft.models.map((one, at) => at === index ? { ...one, enabled } : one), defaultModel: !enabled && draft.defaultModel === model.id ? "" : draft.defaultModel }); }} /> Show in the free tab</label>
          <div className="tagflow-fields">
            <label className="tagflow-field"><span>Provider</span><select className="select" value={modelProvider(model)} onChange={(event) => editModel(index, { provider: event.target.value as IncludedProviderId })}>{INCLUDED_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label className="tagflow-field"><span>Model ID in ADCode</span><input className="input" required maxLength={200} value={model.id} onChange={(event) => { const id = event.target.value; change({ models: draft.models.map((one, at) => at === index ? { ...one, id } : one), defaultModel: draft.defaultModel === model.id && model.id !== "" ? id : draft.defaultModel }); }} /></label>
            <label className="tagflow-field"><span>Exact provider model ID (optional)</span><input className="input" maxLength={200} value={model.upstreamModel ?? ""} placeholder="Same as Model ID in ADCode" onChange={(event) => { const upstreamModel = event.target.value; const next = { ...model }; if (upstreamModel) next.upstreamModel = upstreamModel; else delete next.upstreamModel; change({ models: draft.models.map((one, at) => at === index ? next : one) }); }} /></label>
            <label className="tagflow-field"><span>Display name</span><input className="input" required maxLength={120} value={model.name} onChange={(event) => editModel(index, { name: event.target.value })} /></label>
            <NumberField label="Context tokens" min={1} max={10_000_000} value={model.contextWindow} onChange={(contextWindow) => editModel(index, { contextWindow })} />
            <NumberField label="Maximum output tokens" min={1} max={65_536} value={model.maxOutput} onChange={(maxOutput) => editModel(index, { maxOutput })} />
            <NumberField label="Input price (USD per 1M tokens)" max={10_000} step="0.000001" value={model.inputPrice} onChange={(inputPrice) => editModel(index, { inputPrice })} />
            <NumberField label="Output price (USD per 1M tokens)" max={10_000} step="0.000001" value={model.outputPrice} onChange={(outputPrice) => editModel(index, { outputPrice })} />
          </div>
          <div className="admin-models-actions"><button type="button" className="btn" disabled={dirty || busy || testingModel !== null || !draft.enabled || model.enabled === false} onClick={() => void testModel(model)}>{testingModel === model.id ? "Testing…" : "Test model"}</button><button type="button" className="btn" onClick={() => change({ models: draft.models.filter((_, at) => at !== index), defaultModel: draft.defaultModel === model.id ? "" : draft.defaultModel })}>Remove model</button></div>
        </fieldset>)}
        <p className="row-sub">Use unique ADCode IDs; set an optional provider ID when you need an alias. Enter your actual upstream prices for spending limits. Zero means no upstream charge. Offer models that support text chat and tool calls. These models share the account allowance above.</p>
        <p className="row-sub">Save changes before using Test model. Each test asks for a short “ok” reply and counts as one request from your account's included allowance.</p>
      </section>
    </form>
    <section className="admin-models-provider"><h3>Individual allowance</h3><form className="admin-toolbar" onSubmit={(event) => { event.preventDefault(); void loadUser(); }}><label className="tagflow-field"><span>User ID from People</span><input className="input" required maxLength={128} value={uid} onChange={(event) => setUid(event.target.value)} /></label><button className="btn" disabled={userBusy}>Load user</button></form>
      {userNotice && <p role="status" className="notice">{userNotice}</p>}
      {user !== null && userLimits !== null && <form onSubmit={(event) => { event.preventDefault(); void saveUser(); }}><p className="row-sub">Account: {loadedUid}. Today: {user.usage.requests} requests, {(user.usage.inputTokens + user.usage.outputTokens).toLocaleString()} tokens, {money(user.usage.costMicros)} estimated spend.</p><div className="tagflow-checks"><label><input type="checkbox" checked={blocked} onChange={(event) => setBlocked(event.target.checked)} /> Block included AI for this person</label><label><input type="checkbox" checked={inherit} onChange={(event) => setInherit(event.target.checked)} /> Use current defaults</label></div><LimitFields value={inherit ? saved.config.limits : userLimits} disabled={inherit} onChange={setUserLimits} /><button className="btn btn-primary" disabled={userBusy}>{userBusy ? "Saving…" : "Save user allowance"}</button></form>}
    </section>
    <section className="admin-models-provider"><header className="admin-card-head"><div><h3>Usage by account</h3><p className="row-sub">Up to 200 accounts with the highest spend on this UTC date. Only counts are stored; prompts and responses are never stored in these tables.</p></div><div className="admin-models-actions"><input className="input" type="date" value={day} aria-label="Usage date (UTC)" onChange={(event) => { if (event.target.value) setDay(event.target.value); }} /><button className="btn" type="button" onClick={() => void refreshUsage()}>Refresh</button></div></header>
      {usageError && <p className="notice" role="alert">{usageError}</p>}<div className="admin-models-scroll"><table className="admin-models-table"><thead><tr><th scope="col">Account</th><th scope="col">Requests</th><th scope="col">Tokens in / out</th><th scope="col">Estimated spend</th><th scope="col">Reserved tokens / spend</th><th scope="col">Estimated requests</th></tr></thead><tbody>{rows.map((row) => <tr key={row.uid}><td><button className="btn" onClick={() => void loadUser(row.uid)}>{row.uid}</button></td><td>{row.requests}</td><td>{row.inputTokens.toLocaleString()} / {row.outputTokens.toLocaleString()}</td><td>{money(row.costMicros)}</td><td>{row.reservedTokens.toLocaleString()} / {money(row.reservedCostMicros)}</td><td>{row.estimatedRequests}</td></tr>)}</tbody></table></div>{rows.length === 0 && !usageError && <p className="row-sub">No included AI usage on this date.</p>}
    </section>
  </div>;
}
