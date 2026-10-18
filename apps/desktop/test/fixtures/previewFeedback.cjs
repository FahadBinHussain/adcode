const { app, BrowserWindow } = require('electron');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-preview-feedback-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    const renderer = resolve(__dirname, '../../src/renderer');
    const script = esbuild.buildSync({ stdin: {
      contents: `export { createPreviewPane } from './preview/previewPane.ts'; export { createNotificationCentre } from './notifications/notifications.ts'; export { createIcon } from './workbench/icons.ts'; export { WEB_ICON } from './workbench/webIcons.ts';`,
      resolveDir: renderer,
    }, bundle: true, write: false, format: 'iife', globalName: 'Fixture', platform: 'browser', logLevel: 'silent' }).outputFiles[0].text;
    await win.webContents.executeJavaScript(script);
    const results = await win.webContents.executeJavaScript(`(async () => {
      document.body.innerHTML = '<main id="editor-area"></main><aside id="notifications"></aside>';
      const notices = [];
      let starts = 0;
      let detects = 0;
      const stopped = { running: false, starting: false, url: null, mode: 'static', label: null, error: null };
      let next = stopped;
      let failure = null;
      let detectionFailure = false;
      window.adcode = { preview: {
        onChange: () => () => {}, onOutput: () => () => {},
        detect: async () => { detects++; if (detectionFailure) throw Error('Disconnected'); return null; },
        start: async () => { starts++; if (failure) throw Error(failure); return next; },
        stop: async () => stopped, openExternal: async () => {},
      }};
      const notifications = Fixture.createNotificationCentre(document.querySelector('#notifications'));
      const preview = Fixture.createPreviewPane({ host: document.querySelector('main'), onLayoutChange: () => {}, reportProblem: () => {}, notify: body => { notices.push(body); notifications.show({title:'Live preview',body}); } });
      const check = (condition, message) => { if (!condition) throw Error(message); };
      await preview.toggle();
      check(notices.at(-1).includes('Nothing to preview yet') && notices.at(-1).includes('open an existing web project'), 'No project must explain how to preview');
      check(starts === 0 && detects === 0 && !preview.isOpen(), 'No project must not start a server');
      check(document.querySelector('#notifications').textContent.includes('Nothing to preview yet'), 'Feedback must be in visible notifications');
      preview.setWorkspace('/fixture');
      next = {...stopped, error:'Dev server failed'};
      await preview.open();
      check(notices.at(-1).includes('Dev server failed') && !preview.isOpen(), 'Startup failure must be reported');
      failure = 'Connection lost'; await preview.open();
      check(notices.at(-1).includes('Connection lost'), 'Rejected startup must be reported');
      failure = null; detectionFailure = true; await preview.open();
      check(notices.at(-1).includes('Disconnected'), 'Detection failure must be reported');
      detectionFailure = false; next = stopped; await preview.open();
      check(notices.at(-1).includes('Nothing to preview yet'), 'Idle startup must explain there is no preview');
      next = {...stopped, running:true, url:'http://localhost:9999/'};
      const before = notices.length; await preview.open();
      check(preview.isOpen() && !document.querySelector('.preview-pane').hidden && notices.length === before, 'Successful startup must show the pane without a warning');
      await preview.close();
      check(!preview.isOpen(), 'Preview must still close');
      for (const icon of Object.values(Fixture.WEB_ICON)) {
        const svg = Fixture.createIcon(icon);
        check(svg.getAttribute('viewBox') === '0 0 24 24' && svg.classList.contains('lucide') && svg.getAttribute('aria-hidden') === 'true' && svg.childElementCount > 0, 'Icons must retain official Lucide geometry and accessibility');
      }
      return {empty:true,visibleFeedback:true,startError:true,connectionError:true,detectError:true,idle:true,success:true,close:true,lucide:true};
    })()`);
    console.log('PREVIEW_FEEDBACK_RESULTS=' + JSON.stringify(results));
    win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
