const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'adcode-live-inline-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = ['tokens.css', 'liveAgents.css', 'agents.css'].map(file => readFileSync(resolve(renderer, 'styles', file), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ entryPoints: [resolve(renderer, 'liveAgents/chatLiveRoom.ts')], bundle: true, write: false, format: 'iife', globalName: 'LiveInline', platform: 'browser', target: 'es2022', alias: { '@adcode/ai/toolAccess': resolve(__dirname, '../../../../packages/ai/src/toolAccess.ts') } }).outputFiles[0].text;
    const result = await win.webContents.executeJavaScript(`(async () => {
      const style = document.createElement('style'); style.textContent = ${JSON.stringify(css + '\nbody { margin: 0; } .chat-transcript { height: 440px; overflow: auto; padding: 12px; } .older { height: 500px; } .composer { height: 100px; }')}; document.head.append(style);
      document.body.innerHTML = '<div class="chat-transcript"><p>Earlier user message</p></div><div class="composer">Ask anything…</div>';
      let liveEvent; let cancellations = 0;
      window.adcode = { settings: {read: async () => ({}), onChanged() {}}, aiLive: {onEvent: listener => { liveEvent = listener; }}, aiTeam: {onChanged() {}, cancel: async () => { cancellations++; }} };
      ${bundle}
      const transcript = document.querySelector('.chat-transcript');
      const handle = LiveInline.createChatLiveRoom({ onActivity(element, newRun) { if (newRun || element.parentElement !== transcript) transcript.append(element); } });
      await Promise.resolve();
      const source = { teamId: 'solo-1', nodeId: 'coder', roleId: 'coder', label: 'Coder', model: 'tagflow-code-27b', kind: 'solo' };
      liveEvent({source, event: {kind: 'start'}});
      liveEvent({source, event: {kind: 'text', text: 'Reading the project and fixing the issue.'}});
      await new Promise(resolve => setTimeout(resolve, 180));
      const mountedInline = handle.element.parentElement === transcript && transcript.firstElementChild.tagName === 'P' && !handle.element.hidden;
      const compactSolo = getComputedStyle(handle.element.querySelector('.live-room-strip')).display === 'none' && getComputedStyle(handle.element.querySelector('.live-room-log')).display === 'none';
      const spacer = document.createElement('div'); spacer.className = 'older'; transcript.append(spacer);
      const before = handle.element.getBoundingClientRect().top;
      const composerBefore = document.querySelector('.composer').getBoundingClientRect().top;
      transcript.scrollTop = 100;
      const scrollsWithMessages = Math.abs(handle.element.getBoundingClientRect().top - (before - 100)) < 0.5 && getComputedStyle(handle.element).position === 'static' && document.querySelector('.composer').getBoundingClientRect().top === composerBefore;
      if (!scrollsWithMessages) throw new Error(JSON.stringify({before, after: handle.element.getBoundingClientRect().top, scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight, clientHeight: transcript.clientHeight, position: getComputedStyle(handle.element).position, composerBefore, composerAfter: document.querySelector('.composer').getBoundingClientRect().top}));
      const stop = handle.element.querySelector('.live-window-stop'); stop.click(); await new Promise(resolve => setTimeout(resolve, 0));
      const stopStillWorks = cancellations === 1;
      transcript.replaceChildren();
      liveEvent({source: {...source, teamId: 'solo-2'}, event: {kind: 'start'}});
      await new Promise(resolve => setTimeout(resolve, 130));
      const remountsAfterNewChat = handle.element.parentElement === transcript && !handle.element.hidden;
      return {mountedInline, compactSolo, scrollsWithMessages, stopStillWorks, remountsAfterNewChat};
    })()`);
    console.log('LIVE_INLINE_RESULTS=' + JSON.stringify(result)); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
