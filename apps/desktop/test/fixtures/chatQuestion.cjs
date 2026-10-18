/* Real question-card events and DOM through the chat widget; the fixture never reads the user's profile or project. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-chat-question-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1040, height: 760, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.setPosition(-4000, 0); win.showInactive();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const root = resolve(__dirname, '../../../..');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = [...readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^"]+)"/g)].map(match => readFileSync(join(renderer, 'styles', match[1]), 'utf8')).join('\n');
    const bundle = esbuild.buildSync({ stdin: { contents: `export { createChatWidget } from './ai/chatWidget.ts';`, resolveDir: renderer }, tsconfig: join(root, 'tsconfig.json'), bundle: true, write: false, format: 'iife', globalName: 'ChatQuestion', platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
    const results = await win.webContents.executeJavaScript(`(async () => {
      const errors = []; window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
      window.addEventListener('error', event => { if (event.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(event.message); });
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} + 'body{display:block;margin:0;background:var(--bg-app)}#fixture{height:100vh}.chat-card{position:relative!important;animation:none!important}.chat-transcript{scroll-behavior:auto!important}' }));
      document.documentElement.dataset.theme = 'dark'; document.body.dataset.workspaceMode = 'vibe';
      document.body.innerHTML = '<main id="fixture" class="vibe-workspace"></main><aside id="history"></aside>';
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (test, label) => { const deadline = Date.now() + 4000; while (!test()) { if (Date.now() >= deadline) throw new Error(label + ' did not settle'); await pause(20); } };
      const listeners = new Map();
      const group = (name, values = {}) => new Proxy(values, { get(target, key) { return target[key] ?? (String(key).startsWith('on') ? listener => { const label = name + '.' + key; const entries = listeners.get(label) ?? []; entries.push(listener); listeners.set(label, entries); return () => {}; } : async () => null); } });
      const emit = (key, event) => { for (const listener of listeners.get(key) ?? []) listener(event); };
      const asked = [];
      const settings = { 'adcode.ai.provider': 'tagflow', 'adcode.ai.model': 'tagflow-code-27b' };
      const chatA = { id: 'chat-a', title: 'First chat', messages: [{ role: 'user', text: 'Hello', at: 1000 }, { role: 'assistant', text: 'Hi there.', at: 2000 }], createdAt: 1000, updatedAt: 2000 };
      const chatB = { id: 'chat-b', title: 'Second chat', messages: [{ role: 'user', text: 'A server?', at: 3000 }, { role: 'assistant', text: 'Tell me more.', at: 4000 }], createdAt: 3000, updatedAt: 4000 };
      const api = {
        settings: group('settings', { read: async () => settings }),
        ai: group('ai', {
          status: async () => ({ ready: true, activeProvider: 'tagflow', activeModel: 'tagflow-code-27b', providers: [], connections: [] }),
          contextUsage: async () => ({ tokens: 1000, contextWindow: 262144 }),
          checkpoints: async () => [],
          answerQuestion: async (id, answers) => { asked.push({ id, answers }); },
        }),
        chat: group('chat', { sessions: async () => [chatA, chatB], current: async () => chatA, resume: async id => (id === chatB.id ? chatB : chatA) }),
        aiWorkspace: group('aiWorkspace', { list: async () => [], current: async () => null }),
        aiTeam: group('aiTeam', { list: async () => [] }), aiAutomation: group('aiAutomation', { list: async () => [], due: async () => [] }),
        aiUsage: group('aiUsage', { read: async () => ({ inputTokens: 0, outputTokens: 0, requests: 0, totalTokens: 0, models: [], entries: [] }), allowance: async () => ({ available: false }) }),
      };
      window.adcode = new Proxy(api, { get(target, key) { return target[key] ?? group(String(key)); } });
      ${bundle}
      const widget = ChatQuestion.createChatWidget({ openExternalPath() {}, openConnect() {}, saveAllOpenFiles() {}, requestOpen: () => widget.shown(false), requestClose: () => widget.hidden(), askForName: async () => null, mentionFiles: async () => [] });
      document.querySelector('#fixture').append(widget.element); widget.setDocked(true, document.querySelector('#history')); widget.setWorkspace('/fixture-project'); widget.shown(false); await pause(220);
      const transcript = document.querySelector('.chat-transcript');
      const page = (card, position) => card.querySelectorAll('.chat-question-page')[position - 1];
      const shownPage = card => [...card.querySelectorAll('.chat-question-page')].find(one => !one.hidden);
      const pick = (card, position, value) => { const item = [...page(card, position).querySelectorAll('.chat-question-option')].find(one => one.querySelector('input').value === value); if (!item) throw new Error('Missing option ' + value); item.click(); };
      const typeOwn = (card, position, text) => { const field = page(card, position).querySelector('.chat-question-input'); field.value = text; field.dispatchEvent(new Event('input', { bubbles: true })); };
      const pressEnter = (field, ctrlKey) => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: ctrlKey === true, bubbles: true, cancelable: true }));
      const countText = card => card.querySelector('.chat-question-count').textContent;
      const nextButton = card => card.querySelector('.chat-question-next');
      const dashStates = card => [...card.querySelectorAll('.chat-question-dash')].map(dash => dash.dataset.state).join();
      const checkbox = (card, position, value) => page(card, position).querySelector('input[value="' + value + '"]');
      const keysHint = navigator.userAgent.includes('Mac') ? '⌘↵' : 'Ctrl+↵';

      /* ── In the chat the question belongs to: paging, picks, typing, the record ── */
      emit('ai.onQuestion', { id: 'ask-1', sessionId: 'chat-a', questions: [
        { id: 'q1', header: 'Routing', question: 'Where should the work happen?', options: [
          { id: 'q1o1', label: 'On this machine', description: 'The local model' },
          { id: 'q1o2', label: 'In the cloud', description: 'Tagflow' },
        ], multiSelect: false },
        { id: 'q2', header: 'Scope', question: 'Which parts should change?', options: [
          { id: 'q2o1', label: 'The app shell', description: 'index.html' },
          { id: 'q2o2', label: 'The styling', description: 'styles.css' },
        ], multiSelect: true },
      ] });
      await waitFor(() => transcript.querySelector('.chat-question') !== null, 'Question card');
      const cardA = transcript.querySelector('.chat-question');
      const firstPage = shownPage(cardA);
      const startsBlank = transcript.lastElementChild === cardA
        && countText(cardA) === '1 of 2 questions' && dashStates(cardA) === 'current,todo'
        && firstPage.querySelector('.chat-question-kicker').textContent === 'Routing'
        && firstPage.querySelector('.chat-question-title').textContent === 'Where should the work happen?'
        && firstPage.querySelector('.chat-question-hint').textContent === 'Select one answer'
        && firstPage.querySelector('.chat-question-own-label').textContent === 'Or type your own answer'
        && firstPage.querySelector('.chat-question-input').placeholder === 'Type your own answer...'
        && firstPage.querySelectorAll('.chat-question-option-description').length === 2
        && page(cardA, 2).hidden === true
        && nextButton(cardA).disabled === true && nextButton(cardA).querySelector('.chat-question-next-label').textContent === 'Next'
        && nextButton(cardA).querySelector('.chat-question-keys').textContent === keysHint
        && cardA.querySelector('.chat-question-dismiss').textContent === 'Dismiss';
      const collapse = cardA.querySelector('.chat-question-collapse');
      collapse.click();
      const collapses = cardA.dataset.collapsed === 'true' && collapse.getAttribute('aria-expanded') === 'false' && getComputedStyle(firstPage.parentElement).display === 'none';
      collapse.click();
      const expands = cardA.dataset.collapsed === 'false' && collapse.getAttribute('aria-expanded') === 'true' && getComputedStyle(firstPage.parentElement).display !== 'none';
      pick(cardA, 1, 'q1o1');
      const pickedEnablesNext = checkbox(cardA, 1, 'q1o1').checked === true && nextButton(cardA).disabled === false;
      typeOwn(cardA, 1, 'Somewhere else');
      const typingClearsPick = checkbox(cardA, 1, 'q1o1').checked === false && nextButton(cardA).disabled === false;
      pick(cardA, 1, 'q1o2');
      const pickingClearsTyping = page(cardA, 1).querySelector('.chat-question-input').value === '' && checkbox(cardA, 1, 'q1o2').checked === true;
      typeOwn(cardA, 1, 'Somewhere else');
      pressEnter(page(cardA, 1).querySelector('.chat-question-input'), true);
      const ctrlEnterAdvances = countText(cardA) === '2 of 2 questions' && dashStates(cardA) === 'done,current'
        && firstPage.hidden === true && page(cardA, 2).hidden === false
        && nextButton(cardA).querySelector('.chat-question-next-label').textContent === 'Submit'
        && shownPage(cardA).querySelector('.chat-question-hint').textContent === 'Choose one or more, or type your own answer'
        && shownPage(cardA).querySelector('.chat-question-own-label').textContent === 'Or add your own words';
      pick(cardA, 2, 'q2o1'); pick(cardA, 2, 'q2o2');
      typeOwn(cardA, 2, 'and a README');
      const checkboxesKeepBoth = page(cardA, 2).querySelectorAll('input[type="checkbox"]:checked').length === 2 && page(cardA, 2).querySelector('.chat-question-input').value === 'and a README';
      pressEnter(page(cardA, 2).querySelector('.chat-question-input'), false);
      await waitFor(() => asked.length === 1, 'First answer');
      const sentA = asked[0];
      const answerSent = sentA.id === 'ask-1' && sentA.answers.length === 2
        && sentA.answers[0].questionId === 'q1' && sentA.answers[0].optionIds.length === 0 && sentA.answers[0].text === 'Somewhere else'
        && sentA.answers[1].questionId === 'q2' && sentA.answers[1].optionIds.join() === 'q2o1,q2o2' && sentA.answers[1].text === 'and a README';
      const sentLocks = nextButton(cardA).disabled === true && page(cardA, 2).querySelector('.chat-question-input').disabled === true && page(cardA, 2).querySelectorAll('.chat-question-options input[disabled]').length === 2;
      emit('ai.onQuestionDone', { id: 'ask-1', answers: sentA.answers });
      await pause(30);
      const labels = [...cardA.querySelectorAll('.chat-question-answer-label')].map(node => node.textContent).join();
      const values = [...cardA.querySelectorAll('.chat-question-answer-value')].map(node => node.textContent).join('|');
      const answeredRecord = cardA.dataset.outcome === 'answered' && countText(cardA) === 'Answered' && dashStates(cardA) === 'done,done'
        && labels === 'Routing,Scope' && values === 'Somewhere else|The app shell · The styling · and a README'
        && cardA.querySelector('.chat-question-feet') === null;

      /* ── A question for a chat that is not on screen waits for it ── */
      emit('ai.onQuestion', { id: 'ask-2', sessionId: 'chat-b', questions: [{
        id: 'p1', header: 'Server', question: 'Which port should the server listen on?', options: [
          { id: 'p1o1', label: 'Port 3000', description: 'The dev default' },
          { id: 'p1o2', label: 'Port 8080' },
        ], multiSelect: false,
      }] });
      await pause(60);
      const rowB = document.querySelector('.chat-history-row[data-session-id="chat-b"]');
      const waitsUnseen = transcript.querySelectorAll('.chat-question').length === 1 && !transcript.textContent.includes('Which port')
        && rowB.querySelector('.chat-history-status').dataset.status === 'attention'
        && rowB.querySelector('.chat-history-status').title === 'The assistant is waiting for your answer';
      rowB.querySelector('.chat-history-open').click();
      await waitFor(() => transcript.textContent.includes('Which port'), 'Card of the opened chat');
      const cardB = transcript.querySelector('.chat-question');
      const waitsUntilOpened = transcript.querySelectorAll('.chat-question').length === 1 && !transcript.textContent.includes('The app shell')
        && transcript.textContent.indexOf('Tell me more.') < transcript.textContent.indexOf('Which port')
        && document.querySelector('.chat-history-row[data-session-id="chat-b"] .chat-history-status').dataset.status === 'idle'
        && countText(cardB) === '1 of 1 question';
      cardB.querySelector('.chat-question-dismiss').click();
      await waitFor(() => asked.length === 2, 'A dismissal');
      const dismissed = asked[1];
      const dismissSendsNothing = dismissed.id === 'ask-2' && dismissed.answers.length === 0;
      emit('ai.onQuestionDone', { id: 'ask-2', answers: null });
      await pause(30);
      const dismissedRecord = cardB.dataset.outcome === 'dismissed' && countText(cardB) === 'Dismissed' && dashStates(cardB) === 'done'
        && cardB.querySelector('.chat-question-answer-label').textContent === 'Server'
        && cardB.querySelector('.chat-question-answer-value').textContent === 'No answer'
        && getComputedStyle(cardB.querySelector('.chat-question-answer-value')).fontStyle === 'italic'
        && cardB.querySelector('.chat-question-feet') === null;

      /* ── One question, answered with the button ── */
      emit('ai.onQuestion', { id: 'ask-3', sessionId: 'chat-b', questions: [{
        id: 'c1', question: 'Ready to build?', options: [
          { id: 'c1o1', label: 'Yes', description: 'Start now' },
          { id: 'c1o2', label: 'Not yet' },
        ], multiSelect: false,
      }] });
      await waitFor(() => transcript.textContent.includes('Ready to build'), 'Third question');
      const cardC = [...transcript.querySelectorAll('.chat-question')].at(-1);
      const noHeader = cardC.querySelector('.chat-question-kicker') === null;
      pick(cardC, 1, 'c1o1');
      nextButton(cardC).click();
      await waitFor(() => asked.length === 3, 'Third answer');
      const sentC = asked[2];
      const buttonSubmits = sentC.id === 'ask-3' && sentC.answers.length === 1 && sentC.answers[0].questionId === 'c1' && sentC.answers[0].optionIds.join() === 'c1o1' && sentC.answers[0].text === '';
      emit('ai.onQuestionDone', { id: 'ask-3', answers: sentC.answers });
      await pause(30);
      const optionRecord = cardC.dataset.outcome === 'answered' && countText(cardC) === 'Answered'
        && cardC.querySelector('.chat-question-answer-label').textContent === 'Ready to build?'
        && cardC.querySelector('.chat-question-answer-value').textContent === 'Yes';
      return { startsBlank, collapses, expands, pickedEnablesNext, typingClearsPick, pickingClearsTyping, ctrlEnterAdvances, checkboxesKeepBoth, answerSent, sentLocks, answeredRecord, waitsUnseen, waitsUntilOpened, dismissSendsNothing, dismissedRecord, noHeader, buttonSubmits, optionRecord, errors };
    })()`);
    console.log('CHAT_QUESTION_RESULTS=' + JSON.stringify(results)); win.destroy(); app.exit(0);
  } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
