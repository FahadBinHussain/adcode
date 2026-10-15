"use client";

import { customProviderSecretName, type CustomProvider, type OutputTokenField, type ProviderAuthentication } from "@adcode/api/src/includedProviders.ts";

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
    {value.limits === undefined
      ? <p className="row-sub">Its models draw from the one credit balance, at the rate each model sets below.</p>
      : <p className="row-sub">This provider's old separate allowance ({value.limits.dailyTokens.toLocaleString()} tokens a day) is now combined into credits: its models cost less to match, unless a model sets its own credit rate. <button type="button" className="btn" onClick={() => { const next = { ...value }; delete next.limits; onChange(next); }}>Forget the old allowance</button></p>}
    <p className="row-sub">Key: after saving, paste it under Server connections → Add or replace a key, or add the encrypted Cloudflare secret <code>{secret}</code> yourself, then reload this page. {keyStatus === undefined ? "Save first: the secret name is fixed once saved." : keyStatus ? "Key configured." : "Key not configured yet: its models stay hidden from users."} The key is never entered here or sent to the desktop app.</p>
    <div className="admin-models-actions"><button type="button" className="btn" disabled={inUse} onClick={onRemove}>Remove provider</button></div>
    {inUse && <p className="row-sub">Move or remove its models before removing this provider.</p>}
  </fieldset>;
}
