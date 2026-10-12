const { app, BrowserWindow } = require('electron');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const ts = require('typescript');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-tree-refresh-')));
const compile = file => ts.transpileModule(readFileSync(resolve(__dirname, '../../src/renderer/workbench', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadURL('about:blank');
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const result = await window.webContents.executeJavaScript(`(async () => {
      const editing = (() => { const exports = {}; ${compile('inlineEdit.ts')} return exports; })();
      const tree = (() => { const exports = {}; ${compile('treeRefresh.ts')} return exports; })();
      const box = document.createElement('div'); document.body.append(box);
      const existing = document.createElement('div'); existing.className = 'tree-wrapper'; box.append(existing);
      const commits = [];
      const editor = editing.createInlineEditor({ depth: 0, cancel() {}, commit: async name => { commits.push(name); return null; } });
      box.prepend(editor); await Promise.resolve();
      const input = editor.querySelector('input'); input.value = 'smoke-st';
      const added = document.createElement('div');
      tree.reconcileTreeChildren(box, [added, existing]);
      tree.reconcileTreeChildren(box, [existing]);
      const preserved = input.isConnected && document.activeElement === input && input.value === 'smoke-st' && commits.length === 0;
      input.value = 'smoke-style.css';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 20));
      const submittedOnce = commits.length === 1 && commits[0] === 'smoke-style.css' && !editor.isConnected;
      return { preserved, submittedOnce, retainedRow: box.firstElementChild === existing, staleRowRemoved: !added.isConnected };
    })()`);
    console.log('treeRefreshEvidence:' + JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { window.destroy(); app.quit(); }
});
