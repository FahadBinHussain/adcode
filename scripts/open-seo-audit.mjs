#!/usr/bin/env node
/**
 * Run the original MIT-licensed OpenSEO HTML analyzer and issue checks against
 * public websites. This adapter supplies a bounded HTTP crawl; it is not the
 * OpenSEO hosted service, its MCP workflow, a rankings check, or a JS renderer.
 *
 * Upstream: https://github.com/every-app/open-seo
 * Pinned commit: d7ea7852480601af9bc8870942af8311a410e567
 * Copyright (c) 2026 Ben Senescu. LICENSE is preserved in the ignored cache.
 * Each downloaded source and LICENSE must match its SHA-256 before execution.
 * No package installs, accounts, provider APIs, or paid requests are made.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMIT = 'd7ea7852480601af9bc8870942af8311a410e567';
const REPOSITORY = 'https://github.com/every-app/open-seo';
const CACHE = path.join(ROOT, '.tmp', 'open-seo', COMMIT);
const SOURCE_FILES = {
  'LICENSE': 'c23e0aa0cdc924726993ffc8eb96e5283a7e8aaa7e068f1200277eb6df0f0f06',
  'src/server/lib/audit/page-analyzer.ts': '434e3fa03c20238c5e0cda487f8ca09f1e48c3a836aeda9267ee529be358c336',
  'src/server/lib/audit/url-utils.ts': '6985862e963323562aba778efa2e91bb884a1af36d421aec4f1f239a481f05ff',
  'src/server/lib/audit/issues/page-reporters.ts': '926c94fa87abb39c056139d035f164167613d3f7adf86fcab681af36362b114c',
  'src/server/lib/audit/issues/multipage-checks.ts': '0c5926565ac54e6fb9f11fa8193a9f76d71c495915efe8acc3040fd3c4d02a45',
  'src/shared/audit-issues.ts': '29cc10ae283191491b385b0f803b3a837341499330fc8a0d6ff335ba3ea74823',
};
const DEFAULT_HOSTS = ['https://adcode.bluethenics.com', 'https://web.bluethenics.com'];
const PRIVATE_PATH = /^\/(?:api|auth|login|logout|signup|sign-in|sign-up|account|dashboard|portal|support|settings|admin|oauth|callback|checkout|payment)(?:\/|$)/i;
const ASSET_PATH = /\.(?:png|jpe?g|svg|webp|gif|avif|ico|pdf|css|m?js|map|txt|xml|json|woff2?|ttf|mp4|webm|zip|exe|dmg|appimage)$/i;
const RESPONSE_BODY_LIMIT = 1024 * 1024;
const sha256 = (content) => createHash('sha256').update(content).digest('hex');

function options(argv) {
  const result = { hosts: [], maxPages: 50, timeoutMs: 15000, output: path.join(ROOT, 'artifacts', 'seo') };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/open-seo-audit.mjs [origins...] [--max-pages 180] [--timeout-ms 15000] [--output artifacts/seo]');
      process.exit(0);
    }
    if (['--max-pages', '--timeout-ms', '--output'].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
      if (arg === '--output') result.output = path.resolve(value);
      else result[arg === '--max-pages' ? 'maxPages' : 'timeoutMs'] = Number(value);
    } else if (arg.startsWith('-')) throw new Error('Unknown option: ' + arg);
    else result.hosts.push(arg);
  }
  if (!Number.isInteger(result.maxPages) || result.maxPages < 1 || result.maxPages > 500) throw new Error('--max-pages must be an integer from 1 to 500.');
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 60000) throw new Error('--timeout-ms must be an integer from 1000 to 60000.');
  result.hosts = [...new Set((result.hosts.length ? result.hosts : DEFAULT_HOSTS).map((value) => {
    const url = new URL(value);
    assertPublicUrl(url);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('Provide an origin, without a path: ' + value);
    return url.origin;
  }))];
  return result;
}

function assertPublicUrl(url) {
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs without credentials are supported.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.includes(':') || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes('.')) throw new Error('Private hosts and IP addresses are excluded: ' + host);
}

async function readBounded(response, maxBytes = RESPONSE_BODY_LIMIT) {
  if (!response.body) return { text: '', bodyTruncated: false };
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    // Read one extra byte to distinguish an exact-size response from truncation.
    while (length <= maxBytes) {
      const { value, done } = await reader.read(); if (done) break;
      const chunk = value.subarray(0, maxBytes + 1 - length); chunks.push(chunk); length += chunk.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { text: Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8'), bodyTruncated: length > maxBytes };
}

async function get(url, config) {
  assertPublicUrl(new URL(url));
  const started = Date.now();
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs), headers: { 'user-agent': 'OpenSEO-Audit/1.0', accept: 'text/html,application/xhtml+xml,application/xml,text/plain' } });
  const responseTimeMs = Date.now() - started;
  return { response, responseTimeMs, ...await readBounded(response) };
}

async function engine(config) {
  let ts, XMLParser;
  try {
    ts = require('typescript');
    require.resolve('htmlparser2');
    ({ XMLParser } = require('fast-xml-parser'));
  } catch (error) {
    throw new Error('The installed project dependencies must provide typescript, htmlparser2, and fast-xml-parser. This script does not install packages. ' + error.message);
  }
  const sourceRoot = path.join(CACHE, 'upstream'), compiledRoot = path.join(CACHE, 'compiled');
  await mkdir(compiledRoot, { recursive: true });
  await writeFile(path.join(compiledRoot, 'package.json'), '{"type":"commonjs"}\n');
  for (const [relative, digest] of Object.entries(SOURCE_FILES)) {
    const destination = path.join(sourceRoot, relative);
    let content = await readFile(destination).catch(() => null);
    if (!content || sha256(content) !== digest) {
      const url = 'https://raw.githubusercontent.com/every-app/open-seo/' + COMMIT + '/' + relative;
      const response = await fetch(url, { signal: AbortSignal.timeout(config.timeoutMs), redirect: 'error' });
      if (!response.ok) throw new Error('Cannot fetch pinned OpenSEO source: ' + relative + ' (' + response.status + ')');
      content = Buffer.from(await response.arrayBuffer());
      if (sha256(content) !== digest) throw new Error('OpenSEO source integrity check failed: ' + relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    if (relative.endsWith('.ts')) {
      const target = path.join(compiledRoot, relative.replace(/\.ts$/, '.js'));
      const compiled = ts.transpileModule(content.toString('utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, compiled);
    } else await writeFile(path.join(compiledRoot, 'LICENSE'), content);
  }
  await writeFile(path.join(CACHE, 'provenance.json'), JSON.stringify({ repository: REPOSITORY, commit: COMMIT, files: SOURCE_FILES }, null, 2) + '\n');
  return {
    ...require(path.join(compiledRoot, 'src/server/lib/audit/page-analyzer.js')),
    ...require(path.join(compiledRoot, 'src/server/lib/audit/url-utils.js')),
    ...require(path.join(compiledRoot, 'src/server/lib/audit/issues/page-reporters.js')),
    ...require(path.join(compiledRoot, 'src/server/lib/audit/issues/multipage-checks.js')),
    ...require(path.join(compiledRoot, 'src/shared/audit-issues.js')),
    XMLParser,
  };
}

// Longest matching Allow/Disallow rule, with OpenSEO-specific groups preferred.
function robotsPolicy(text) {
  const groups = []; let group = null, hasRules = false;
  for (const line of text.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').trim().match(/^([^:]+):\s*(.*)$/); if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && ['allow', 'disallow'].includes(key)) { group.rules.push({ key, value }); hasRules = true; }
  }
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && 'openseo-audit'.includes(a)));
  const active = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (url) => {
    const parsed = new URL(url), target = parsed.pathname + parsed.search;
    const matches = active.flatMap(g => g.rules).filter(rule => {
      if (!rule.value) return false;
      const end = rule.value.endsWith('$');
      const value = end ? rule.value.slice(0, -1) : rule.value;
      return new RegExp('^' + value.split('*').map(escape).join('.*') + (end ? '$' : '')).test(target);
    }).sort((a, b) => b.value.length - a.value.length || (a.key === 'allow' ? -1 : 1));
    return !matches.length || matches[0].key === 'allow';
  };
}

async function audit(origin, config, e) {
  const { normalizeUrl, isSameOrigin, analyzeHtml } = e;
  const startedAt = new Date().toISOString(), failures = [], skipped = [], discovery = [], truncatedResponses = [];
  const robots = await get(origin + '/robots.txt', config).catch(error => { failures.push({ url: origin + '/robots.txt', error: error.message }); return null; });
  const robotStatus = robots?.response.status ?? null;
  // A server failure is not permission to crawl. A normal missing robots file is.
  if (robotStatus === null || robotStatus === 429 || robotStatus >= 500 || robotStatus === 401 || robotStatus === 403 || (robotStatus >= 300 && robotStatus < 400)) {
    throw new Error('Cannot establish robots permission for ' + origin + ': ' + robotStatus);
  }
  if (robots.bodyTruncated) throw new Error('Cannot establish robots permission: robots.txt exceeds the ' + RESPONSE_BODY_LIMIT + '-byte response limit for ' + origin);
  const robotText = robots.response.ok && !robots.text.trimStart().startsWith('<') ? robots.text : '';
  const isAllowed = robotsPolicy(robotText), sitemapUrls = new Set(), sitemapDocs = new Set();
  const xml = new e.XMLParser();
  async function sitemap(url, depth = 0) {
    if (depth > 2 || sitemapDocs.size >= 10 || sitemapDocs.has(url) || !isSameOrigin(url, origin) || !isAllowed(url)) return;
    sitemapDocs.add(url);
    const got = await get(url, config).catch(error => { discovery.push({ url, error: error.message }); return null; });
    if (got?.bodyTruncated) {
      truncatedResponses.push({ url, stage: 'sitemap', limitBytes: RESPONSE_BODY_LIMIT });
      discovery.push({ url, error: 'Sitemap exceeded the response limit; URL discovery is incomplete.' });
      return;
    }
    if (!got?.response.ok || !/^\s*(<\?xml|<urlset|<sitemapindex)/i.test(got.text)) return;
    let parsed;
    try { parsed = xml.parse(got.text); } catch (error) { discovery.push({ url, error: error.message }); return; }
    for (const row of [parsed.urlset?.url ?? []].flat()) {
      const normalized = typeof row.loc === 'string' ? normalizeUrl(row.loc) : null;
      if (normalized && isSameOrigin(normalized, origin)) sitemapUrls.add(normalized);
    }
    for (const row of [parsed.sitemapindex?.sitemap ?? []].flat()) if (typeof row.loc === 'string') await sitemap(row.loc, depth + 1);
  }
  const sitemapLocations = [...robotText.matchAll(/^sitemap:\s*(.+)$/gmi)].map(match => match[1].trim());
  for (const url of new Set([...sitemapLocations, origin + '/sitemap.xml'])) await sitemap(url);
  const queue = [], seen = new Set(), pages = [], links = [];
  function enqueue(value, depth) {
    const url = normalizeUrl(value); if (!url || seen.has(url) || !isSameOrigin(url, origin)) return;
    const parsed = new URL(url);
    if (parsed.search || PRIVATE_PATH.test(parsed.pathname) || ASSET_PATH.test(parsed.pathname)) { skipped.push({ url, reason: 'query, private path, or asset' }); return; }
    if (!isAllowed(url)) { skipped.push({ url, reason: 'robots.txt' }); return; }
    seen.add(url); queue.push({ url, depth });
  }
  enqueue(origin + '/', 0);
  for (const url of sitemapUrls) enqueue(url, null);
  let pagesAttempted = 0;
  const noindexPattern = /(^|[\s,:])(?:noindex|none)($|[\s,])/i;
  while (queue.length && pagesAttempted < config.maxPages) {
    const batch = queue.splice(0, Math.min(3, config.maxPages - pagesAttempted));
    // Failed and timed-out page requests consume the same budget as successful ones.
    pagesAttempted += batch.length;
    const fetched = await Promise.all(batch.map(async entry => {
      try { return { ...entry, got: await get(entry.url, config) }; }
      catch (error) { failures.push({ url: entry.url, error: error.message }); return null; }
    }));
    for (const item of fetched) {
      if (!item) continue;
      const { url, depth, got: { response, text, responseTimeMs, bodyTruncated } } = item;
      if (bodyTruncated) truncatedResponses.push({ url, stage: 'page', limitBytes: RESPONSE_BODY_LIMIT });
      const isHtml = (response.headers.get('content-type') ?? '').includes('text/html');
      const analysis = analyzeHtml(isHtml ? text : '', url, response.status, responseTimeMs);
      const xRobotsTag = response.headers.get('x-robots-tag');
      const headerCanonical = (response.headers.get('link') ?? '').match(/<([^>]+)>\s*;\s*rel="?canonical/i);
      const location = response.headers.get('location');
      const redirectUrl = response.status >= 300 && response.status < 400 && location ? normalizeUrl(location, url) : null;
      const isIndexable = !noindexPattern.test([analysis.robotsMeta, xRobotsTag].filter(Boolean).join(','));
      const page = { ...analysis, id: randomUUID(), bodyTruncated, isHtml, isIndexable, xRobotsTag, redirectUrl, crawlDepth: depth,
        fetchClass: response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) || response.headers.get('cf-mitigated') === 'challenge' ? 'blocked' : 'ok',
        canonicalUrl: analysis.canonical ? normalizeUrl(analysis.canonical, url) : null,
        headerCanonicalUrl: headerCanonical ? normalizeUrl(headerCanonical[1], url) : null,
        h1Count: analysis.h1s.length, imagesMissingAlt: analysis.images.filter(image => image.alt === null).length, imagesTotal: analysis.images.length,
        contentHash: sha256(analysis.bodyText), inSitemap: sitemapUrls.has(url),
      };
      pages.push(page);
      if (!isIndexable) { skipped.push({ url, reason: 'noindex response; outgoing links not followed' }); continue; }
      for (const link of analysis.links) if (link.isInternal) { links.push({ sourceUrl: url, targetUrl: link.targetUrl }); enqueue(link.targetUrl, depth === null ? null : depth + 1); }
      if (redirectUrl) enqueue(redirectUrl, depth);
    }
  }
  const issues = pages.flatMap(e.runPageReporters);
  issues.push(...e.findDuplicates(pages), ...e.findRedirectChainsAndLoops(pages));
  const byUrl = new Map(pages.map(page => [page.url, page]));
  for (const link of links) {
    const target = byUrl.get(link.targetUrl);
    if (target && target.fetchClass === 'ok' && target.statusCode >= 400) issues.push({ issueType: 'broken-internal-link', pageUrl: link.sourceUrl, details: { targetUrl: link.targetUrl, targetStatus: target.statusCode } });
  }
  const counts = {};
  for (const issue of issues) counts[issue.issueType] = (counts[issue.issueType] ?? 0) + 1;
  const output = {
    repository: REPOSITORY, commit: COMMIT, startedAt, completedAt: new Date().toISOString(), origin,
    scope: 'Original OpenSEO HTML analyzer, page reporters, duplicate and redirect checks; bounded HTTP crawl adapter; no JavaScript rendering, rankings, backlinks, analytics, or GSC.',
    maxPages: config.maxPages, timeoutMs: config.timeoutMs, responseBodyLimitBytes: RESPONSE_BODY_LIMIT, robotsStatus: robotStatus, sitemapUrlCount: sitemapUrls.size,
    pagesAttempted, pagesCrawled: pages.length, pagesRemaining: queue.length, crawlComplete: queue.length === 0 && failures.length === 0 && discovery.length === 0 && truncatedResponses.length === 0,
    counts, failures, discovery, truncatedResponses, skipped: [...new Map(skipped.map(item => [item.url + item.reason, item])).values()],
    issues: issues.map(issue => ({ ...issue, severity: e.AUDIT_ISSUE_TYPES[issue.issueType]?.severity ?? 'warning' })),
    pages: pages.map(({ bodyText, images, links: outgoing, ...page }) => ({ ...page, issueTypes: issues.filter(issue => issue.pageUrl === page.url).map(issue => issue.issueType) })),
  };
  await mkdir(config.output, { recursive: true });
  const destination = path.join(config.output, new URL(origin).hostname + '.json');
  await writeFile(destination, JSON.stringify(output, null, 2) + '\n');
  console.log(origin + ': ' + pagesAttempted + ' attempted; ' + pages.length + ' pages; ' + queue.length + ' queued; ' + issues.length + ' reported issues; ' + failures.length + ' fetch failures.');
  if (truncatedResponses.length) console.log('  Incomplete coverage: ' + truncatedResponses.length + ' response(s) exceeded the ' + RESPONSE_BODY_LIMIT + '-byte limit.');
  for (const [type, count] of Object.entries(counts)) console.log('  ' + count + ' ' + type);
  console.log('  Report: ' + destination);
  return output;
}

try {
  const config = options(process.argv.slice(2));
  const e = await engine(config);
  for (const host of config.hosts) {
    const report = await audit(host, config, e);
    if (report.failures.length || report.discovery.length || report.truncatedResponses.length) process.exitCode = 1;
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
