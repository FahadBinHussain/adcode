import adcodeLogo from "../../../../build/icon.svg?raw";

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** The sign-in browser page stays complete after its loopback listener closes. */
export function resultPage(heading: string, detail: string, ok: boolean, provider = "Google"): string {
  const logo = adcodeLogo.replace("<svg ", '<svg class="brand-logo" aria-hidden="true" ');
  const symbol = ok ? '<path d="m7 12 3.2 3.2L17 8.4"/>' : '<path d="M12 7v6m0 4h.01"/>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(heading)} · ADCode</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(adcodeLogo)}">
<style>
  :root { color-scheme: light dark; --paper:#f5f5f3; --surface:#fff; --ink:#20221f; --muted:#62665f; --line:#e2e4de; --state:#26764c; --state-bg:#edf7f0; }
  @media (prefers-color-scheme:dark) { :root { --paper:#141613; --surface:#1d201b; --ink:#f2f4ef; --muted:#a9b0a3; --line:#353b30; --state:#9fd6af; --state-bg:#263c2b; } }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; min-height:100svh; display:grid; place-items:center; padding:24px; background:var(--paper); color:var(--ink); font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; -webkit-font-smoothing:antialiased; }
  main { width:min(100%,440px); }
  .brand { display:flex; align-items:center; gap:12px; margin:0 0 24px; }
  .brand-logo { display:block; width:46px; height:46px; flex:none; }
  .brand-name { font-size:19px; font-weight:650; letter-spacing:-.025em; }
  .brand-caption { display:block; color:var(--muted); font-size:12px; line-height:1.5; }
  .card { padding:32px; border:1px solid var(--line); border-radius:20px; background:var(--surface); box-shadow:0 8px 30px #00000005; animation:arrive .18s ease-out; }
  .status { display:inline-flex; align-items:center; gap:7px; color:var(--state); background:var(--state-bg); padding:4px 10px 4px 6px; border-radius:30px; font-size:12px; font-weight:600; }
  .status svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
  .retry { --state:var(--muted); --state-bg:var(--paper); }
  h1 { margin:20px 0 10px; font-size:30px; line-height:1.2; font-weight:650; letter-spacing:-.035em; overflow-wrap:anywhere; }
  p { margin:0; color:var(--muted); font-size:15px; }
  .next { margin-top:24px; padding-top:20px; border-top:1px solid var(--line); display:flex; align-items:center; gap:10px; font-size:13px; color:var(--ink); }
  .next svg { width:18px; height:18px; flex:none; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
  footer { margin-top:20px; color:var(--muted); font-size:12px; text-align:center; }
  @keyframes arrive { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @media (prefers-reduced-motion:reduce) { .card { animation:none; } }
  @media (max-width:380px) { body { padding:18px; } .card { padding:24px; } h1 { font-size:27px; } }
</style></head>
<body><main>
  <header class="brand">${logo}<div><span class="brand-name">ADCode</span><span class="brand-caption">Account connection</span></div></header>
  <section class="card${ok ? "" : " retry"}" aria-labelledby="result-title">
    <span class="status"><svg viewBox="0 0 24 24" aria-hidden="true">${symbol}</svg>${escapeHtml(provider)}</span>
    <h1 id="result-title">${escapeHtml(heading)}</h1>
    <p>${escapeHtml(detail)}</p>
    <div class="next"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H5v14h14v-4M13 5h6v6m0-6L9 15"/></svg>Continue in the ADCode app</div>
  </section>
  <footer>You can close this tab.</footer>
</main></body></html>`;
}

export const RESULT_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
