"use client";

/**
 * Buying AI tokens for Heabsy's models in ADCode.
 *
 * Every account gets a free weekly allowance on those models; past it, the relay draws on tokens
 * bought here. Payment happens on Dodo's hosted page, so no card details touch this site, and the
 * webhook credits the tokens - this page only starts the checkout and shows what arrived.
 * Spec: docs/superpowers/specs/2026-10-21-paid-ai-tokens-design.md.
 */
import { useCallback, useEffect, useState } from "react";
import { AdcodeLoader } from "@/components/AdcodeLoader";
import { useAuth } from "@/components/AuthProvider";
import { SignInCard } from "@/components/SignInCard";
import { apiFetch, MESSAGES } from "@/lib/api";

export interface TokenPack { id: string; priceCents: number; tokens: number }
export interface TokensView { enabled: boolean; free: { limit: number; used: number; held: number; remaining: number; resetsAt: number | null }; purchased: number }
interface TokenOrderView { orderId: string; packId: string; priceCents: number; tokens: number; status: "pending" | "paid" | "refunded" | "abandoned"; createdAt: number; paidAt: number | null }
interface TokenLedgerView { id: string; delta: number; kind: "purchase" | "usage" | "refund" | "grant"; note: string; createdAt: number }
interface TokenActivityView { tokens: TokensView; orders: TokenOrderView[]; ledger: TokenLedgerView[] }
interface PaidOffer { enabled: boolean; freeWeeklyTokens: number; packs: TokenPack[] }

const POLL_MS = 3_000;
const POLL_FOR_MS = 120_000;

export function formatTokens(tokens: number): string {
  const n = Math.max(0, tokens);
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(2))}M`;
  if (n >= 1_000) return `${Number((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
}

export function refillText(resetsAt: number, now: number): string {
  const ms = resetsAt - now;
  if (ms <= 0) return "now";
  const unit = (value: number, word: string) => `in ${value} ${word}${value === 1 ? "" : "s"}`;
  if (ms >= 86_400_000) return unit(Math.round(ms / 86_400_000), "day");
  if (ms >= 3_600_000) return unit(Math.round(ms / 3_600_000), "hour");
  return unit(Math.max(1, Math.round(ms / 60_000)), "minute");
}

export type Arrival = "checking" | "added" | "not-yet";

/** Back from Dodo: a payment is only "received" once the webhook has marked the order paid. */
export function arrivalMessage(arrival: Arrival): string {
  if (arrival === "checking") return "Checking your payment…";
  if (arrival === "added") return "Your tokens are added. A task that paused carries on by itself.";
  return "We haven't received this payment yet. If you paid, your tokens arrive within a few minutes - press Refresh to check again. If you closed the checkout, nothing was charged.";
}

const dollars = (cents: number): string => `$${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;

export function PackList({ packs, busy, onBuy }: { packs: TokenPack[]; busy: string | null; onBuy: (pack: TokenPack) => void }) {
  return (
    <ul className="token-packs" aria-label="Token packs">
      {packs.map((pack) => (
        <li key={pack.id} className="token-pack">
          <span className="token-pack-price">{dollars(pack.priceCents)}</span>
          <span className="token-pack-tokens">{formatTokens(pack.tokens)} tokens</span>
          <span className="field-hint">${(pack.priceCents / 100 / (pack.tokens / 1_000_000)).toFixed(2)} per million</span>
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => onBuy(pack)}>
            {busy === pack.id ? "Opening checkout…" : `Buy ${formatTokens(pack.tokens)}`}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function BalanceSummary({ tokens, now }: { tokens: TokensView; now: number }) {
  return (
    <div className="stats">
      <div className="stat">
        <span className="stat-label">Free this week</span>
        <span className="stat-value">{formatTokens(tokens.free.remaining)} of {formatTokens(tokens.free.limit)} free</span>
        <span className="stat-hint">{tokens.free.resetsAt === null ? "Starts with your first Heabsy request" : `Free tokens refill ${refillText(tokens.free.resetsAt, now)}`}</span>
      </div>
      <div className="stat">
        <span className="stat-label">Purchased</span>
        <span className="stat-value">{formatTokens(tokens.purchased)} purchased</span>
        <span className="stat-hint">Used after your free tokens. They never expire.</span>
      </div>
    </div>
  );
}

/** A two-letter region from the browser's language, for Dodo's tax country; the person can change it. */
const guessCountry = (): string => {
  if (typeof navigator === "undefined") return "US";
  const region = /-([A-Z]{2})\b/.exec(navigator.language)?.[1];
  return region ?? "US";
};

export default function AiTokens() {
  const { user, loading: authLoading, token } = useAuth();
  const [offer, setOffer] = useState<PaidOffer | null>(null);
  const [activity, setActivity] = useState<TokenActivityView | null>(null);
  const [country, setCountry] = useState("US");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { setCountry(guessCountry()); }, []);

  useEffect(() => {
    void fetch("/v1/ai/tagflow/config").then(async (response) => {
      const body = await response.json() as { paid?: PaidOffer };
      if (body.paid !== undefined) setOffer(body.paid);
    }).catch(() => setError("Couldn't load the token packs. Check your connection and refresh."));
  }, []);

  const load = useCallback(async (): Promise<TokenActivityView | null> => {
    const found = await apiFetch<TokenActivityView>({ path: "/ai/tokens/orders", token: await token() });
    if (!found.ok) { setError(MESSAGES[found.error]); return null; }
    setActivity(found.value); setNow(Date.now());
    return found.value;
  }, [token]);

  useEffect(() => { if (user !== null) void load(); }, [user, load]);

  // Back from Dodo: wait for the webhook to credit this order, then say so.
  useEffect(() => {
    if (user === null) return;
    const order = new URLSearchParams(window.location.search).get("order");
    if (order === null) return;
    setArrival("checking");
    const started = Date.now();
    // Once it is settled either way, the address loses ?order= so a reload days later says nothing.
    const forget = (): void => window.history.replaceState(null, "", window.location.pathname);
    const timer = window.setInterval(() => {
      void load().then((view) => {
        if (view?.orders.some((one) => one.orderId === order && one.status === "paid")) { setArrival("added"); forget(); window.clearInterval(timer); }
        else if (Date.now() - started > POLL_FOR_MS) { setArrival("not-yet"); forget(); window.clearInterval(timer); }
      });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [user, load]);

  const buy = async (pack: TokenPack) => {
    if (busy !== null) return;
    if (!/^[A-Z]{2}$/.test(country)) { setError("Enter your country as a two-letter code, like US or DE."); return; }
    setBusy(pack.id); setError(null);
    const session = await apiFetch<{ orderId: string; checkoutUrl: string }>({ path: "/ai/tokens/checkout", token: await token(), method: "POST", body: { pack: pack.id, billingCountry: country } });
    setBusy(null);
    if (!session.ok) { setError(MESSAGES[session.error]); return; }
    window.location.assign(session.value.checkoutUrl);
  };

  if (authLoading) return <AdcodeLoader />;

  // The heading and the offer are rendered by the page on the server (page.tsx).
  return (
    <>
      {user === null ? (
        <SignInCard heading="Sign in with your ADCode account" />
      ) : (
        <>
          {error !== null && <div className="notice" data-tone="error" role="alert">{error}</div>}
          {arrival !== null && (
            <div className="notice" data-tone={arrival === "added" ? "success" : undefined} role="status">
              {arrivalMessage(arrival)}{" "}
              {arrival === "not-yet" && <button type="button" className="btn btn-outline btn-small" onClick={() => void load()}>Refresh</button>}
            </div>
          )}

          {activity !== null && <BalanceSummary tokens={activity.tokens} now={now} />}

          {offer === null ? <AdcodeLoader /> : !offer.enabled ? (
            <p className="notice">Buying tokens opens soon. Tagflow AI stays free in the meantime.</p>
          ) : (
            <>
              <div className="field ai-tokens-country">
                <label htmlFor="t-country">Billing country</label>
                <span className="field-hint">Two-letter code, used for tax.</span>
                <input id="t-country" className="input" maxLength={2} value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} />
              </div>
              <PackList packs={offer.packs} busy={busy} onBuy={(pack) => void buy(pack)} />
              <p className="field-hint">You&apos;ll pay on Dodo Payments&apos; secure page; Dodo handles sales tax. Nothing renews. For a refund of unused tokens, contact us from the Help page.</p>
            </>
          )}

          {activity !== null && activity.ledger.length > 0 && (
            <section className="ai-tokens-history" aria-label="Token history">
              <h2>History</h2>
              <table className="table">
                <thead><tr><th>Date</th><th>What</th><th>Tokens</th></tr></thead>
                <tbody>
                  {activity.ledger.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.createdAt).toLocaleDateString()}</td>
                      <td>{{ purchase: "Bought", usage: "Used", refund: "Refunded", grant: "Added by ADCode" }[row.kind]}{row.note ? ` - ${row.note}` : ""}</td>
                      <td>{row.delta > 0 ? "+" : "-"}{formatTokens(Math.abs(row.delta))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
