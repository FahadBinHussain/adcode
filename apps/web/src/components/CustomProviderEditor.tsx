"use client";

import { customProviderSecretName, type CustomProvider, type OutputTokenField, type ProviderAuthentication } from "@adcode/api/src/includedProviders.ts";
import { UNLIMITED_DAILY_REQUESTS, UNLIMITED_REQUESTS_PER_MINUTE } from "@adcode/api/src/tagflowConfig.ts";

/** Admin connection editor only; credentials and network requests never enter this component. */
export function CustomProviderEditor({ value, keyStatus, inUse = false, onChange, onRemove }: {
  value: CustomProvider;
  /** Undefined until the provider is saved and the server has looked for its secret. */
  keyStatus?: boolean | undefined;
  inUse?: boolean;
  onChange(value: CustomProvider): void;
  onRemove(): void;
}) {
  const patch = (changes: Partial<CustomProvider>): void => onChange({ ...value, ...changes });
  const secret = customProviderSecretName(value.id);
  return <fieldset className="tagflow-model">
    <legend>{value.name || "New provider"}</legend>
    <div className="tagflow-fields">
      <label className="tagflow-field"><span>Provider name</span><input className="input" required maxLength={120} value={value.name} placeholder="Together AI" onChange={event => patch({ name: event.target.value })} /></label>
      <label className="tagflow-field"><span>API base URL</span><input className="input" type="url" required maxLength={500} value={value.baseUrl} placeholder="https://api.together.xyz/v1" onChange={event => patch({ baseUrl: event.target.value })} /><small>Public HTTPS address, including /v1 when the provider uses it. ADCode calls its /chat/completions.</small></label>
      <label className="tagflow-field"><span>API key header</span><select className="select" value={value.authentication ?? "bearer"} onChange={event => patch({ authentication: event.target.value as ProviderAuthentication })}><option value="bearer">Authorization: Bearer (most providers)</option><option value="x-api-key">x-api-key</option><option value="api-key">api-key (Azure OpenAI)</option></select></label>
      <label className="tagflow-field"><span>Reply length field</span><select className="select" value={value.outputTokenField ?? "max_tokens"} onChange={event => patch({ outputTokenField: event.target.value as OutputTokenField })}><option value="max_tokens">max_tokens (most providers)</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>
    </div>
    <label className="admin-models-check"><input type="checkbox" checked={value.limits !== undefined} onChange={event => {
      if (event.target.checked) patch({ limits: { dailyRequests: UNLIMITED_DAILY_REQUESTS, dailyTokens: 10_000_000, dailyCostMicros: 1_000_000, requestsPerMinute: UNLIMITED_REQUESTS_PER_MINUTE } });
      else { const next = { ...value }; delete next.limits; onChange(next); }
    }} /> Give this provider's models their own daily allowance</label>
    {value.limits !== undefined && <div className="tagflow-fields">
      <label className="tagflow-field"><span>Tokens per day, per person</span><input className="input" type="number" required min={0} max={1_000_000_000} step="1" value={value.limits.dailyTokens} onChange={event => patch({ limits: { ...value.limits!, dailyTokens: event.currentTarget.valueAsNumber } })} /></label>
      <label className="tagflow-field"><span>Spending limit per day (USD)</span><input className="input" type="number" required min={0} max={1000} step="0.000001" value={value.limits.dailyCostMicros / 1_000_000} onChange={event => patch({ limits: { ...value.limits!, dailyCostMicros: Math.round(event.currentTarget.valueAsNumber * 1_000_000) } })} /></label>
    </div>}
    <p className="row-sub">{value.limits === undefined ? "Its models share the main daily allowance below." : "Its models draw from this separate allowance instead of the main one, with unlimited requests. Personal overrides change only the main allowance; blocking a person blocks both."}</p>
    <p className="row-sub">Key: after saving, paste it under Server connections → Add or replace a key, or add the encrypted Cloudflare secret <code>{secret}</code> yourself, then reload this page. {keyStatus === undefined ? "Save first: the secret name is fixed once saved." : keyStatus ? "Key configured." : "Key not configured yet: its models stay hidden from users."} The key is never entered here or sent to the desktop app.</p>
    <div className="admin-models-actions"><button type="button" className="btn" disabled={inUse} onClick={onRemove}>Remove provider</button></div>
    {inUse && <p className="row-sub">Move or remove its models before removing this provider.</p>}
  </fieldset>;
}
