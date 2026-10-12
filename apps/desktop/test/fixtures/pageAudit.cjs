/* Exercise the shipped browser and accessibility engine against real local pages. */
const { app } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const esbuild = require('esbuild');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-page-audit-')));
app.whenReady().then(async () => {
  const root = resolve(__dirname, '../../../..');
  const output = join(root, '.tmp', 'composer-rework', 'page-audit-bundle.cjs');
  mkdirSync(join(output, '..'), { recursive: true });
  const rawAxe = join(root, '.tmp', 'composer-rework', 'axe-source.cjs');
  writeFileSync(rawAxe, 'module.exports = ' + JSON.stringify(readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')) + ';');
  esbuild.buildSync({ entryPoints: [join(root, 'apps/desktop/src/main/agentBrowser.ts')], tsconfig: join(root, 'tsconfig.json'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], alias: { 'axe-core/axe.min.js?raw': rawAxe }, outfile: output, logLevel: 'silent' });
  const { viewPage, closeAgentBrowser } = require(output);
  const bad = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  .wide { width:1800px } .faint {color:#ddd;background:white} .moving {animation:spin 4s linear infinite;width:30px;height:30px;background:black} @keyframes spin{to{transform:rotate(360deg)}}
  </style></head><body><div class="wide"><h1>Bad page</h1><p class="faint">Low contrast text</p><button></button><input><img src="/missing.png"><div class="moving"></div></div></body></html>`;
  const good = `<!doctype html><html lang="en"><head><title>Project settings</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{color:#111;background:white;font:18px sans-serif;margin:24px} button,input{font:inherit;padding:12px} .moving{animation:spin 4s linear infinite;width:30px;height:30px;background:black} @keyframes spin{to{transform:rotate(360deg)}} @media(prefers-reduced-motion:reduce){.moving{animation:none}}
  </style></head><body><main><h1>Project settings</h1><label for="name">Project name</label><input id="name"><button>Save changes</button><div class="moving" aria-hidden="true"></div></main></body></html>`;
  const server = createServer((req, res) => {
    if (req.url === '/missing.png') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(req.url === '/bad' ? bad : good);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (page, reducedMotion, width = 390, audit = true) => ({ target: { kind: 'url', url: base + page }, width, height: 844, actions: [], screenshot: false, fullPage: false, reducedMotion, audit });
  try {
    const failure = await viewPage(request('/bad', true), { previewUrl: async () => base }, new AbortController().signal);
    assert.equal(failure.isError, false, failure.content);
    for (const finding of ['button-name', 'label', 'image-alt', 'color-contrast', 'scrolls sideways', '404', 'Reduced motion: emulated', 'Active animations: 1']) assert.ok(failure.content.includes(finding), finding + '\n' + failure.content);
    const fixed = await viewPage(request('/good', true, 1440), { previewUrl: async () => base }, new AbortController().signal);
    assert.equal(fixed.isError, false, fixed.content);
    assert.ok(fixed.content.includes('Accessibility: 0 rule violations'), fixed.content);
    assert.ok(fixed.content.includes('Active animations: 0'), fixed.content);
    assert.ok(!fixed.content.includes('scrolls sideways'), fixed.content);
    const normal = await viewPage(request('/good', false, 390), { previewUrl: async () => base }, new AbortController().signal);
    assert.ok(normal.content.includes('Reduced motion: not emulated'), normal.content);
    assert.ok(normal.content.includes('Active animations: 1'), normal.content);
    const aborted = new AbortController(); aborted.abort();
    const stopped = await viewPage(request('/good', true), { previewUrl: async () => base }, aborted.signal);
    assert.equal(stopped.isError, true);
    process.stdout.write('PAGE_AUDIT_RESULTS=' + JSON.stringify({ realAxe: true, responsive: true, reducedMotion: true, mediaReset: true, cancelled: true }) + '\n');
  } finally { closeAgentBrowser(); await new Promise(resolve => server.close(resolve)); }
  app.exit(0);
}).catch(error => { process.stderr.write(String(error.stack || error) + '\n'); app.exit(1); });
