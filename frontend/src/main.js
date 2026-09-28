import * as monaco from 'monaco-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import './style.css';

const app = document.querySelector('#app');
let editor = null;
let lastError = '';
let lastDiagnostic = null;
let currentTab = 'out';
let pendingSelection = '';
let currentTheme = 'night';

app.innerHTML = `
<div class="shell">
  <aside class="side">
    <div class="brand">
      <div class="mark">L</div>
      <div><b>LocalMind</b><small>Private AI workspace</small></div>
    </div>
    <nav>
      <button class="nav active" data-view="home">⌂ <span>Home</span></button>
      <button class="nav" data-view="editor">▣ <span>Code Studio</span></button>
      <button class="nav" data-view="ai">✦ <span>AI Assistant</span></button>
    </nav>
    <div class="side-bottom">
      <div class="local"><i></i>Local runtime</div>
      <small>Qwen3 8B · Ollama</small>
    </div>
  </aside>

  <main class="main">
    <section id="homeView" class="view">
      <div class="hero">
        <div class="badge">LOCAL · PRIVATE · OFFLINE</div>
        <h1>Build with AI.<br><em>Run it locally.</em></h1>
        <p>Write code, run it locally, inspect structured errors, and ask your private Qwen3 8B agent for help.</p>
      </div>
      <div class="choices">
        <button class="choice" data-open="editor">
          <div class="ico blue">▣</div>
          <div><small>DEVELOP</small><h2>Code Studio</h2><p>Monaco editor, readable errors, live markers, selection-aware AI and local execution.</p><b>Open Code Studio →</b></div>
        </button>
        <button class="choice" data-open="ai">
          <div class="ico purple">✦</div>
          <div><small>ASSIST</small><h2>AI Assistant</h2><p>Use Qwen3 8B locally for explanations, debugging, planning and learning.</p><b>Open AI Assistant →</b></div>
        </button>
      </div>
    </section>

    <section id="editorView" class="view hidden">
      <header class="head">
        <div><small>WORKSPACE / CODE STUDIO</small><h2>Python Workspace</h2></div>
        <div class="actions">
          <div class="theme-control">
            <button id="themeBtn" class="theme-btn" aria-expanded="false"><span id="themeSwatch" class="swatch"></span>Theme <span class="chev">⌄</span></button>
            <div id="themeMenu" class="theme-menu hidden">
              <div class="menu-title">Editor theme</div>
              <div class="preset-grid">
                <button data-theme-preset="night"><span class="theme-dot" style="background:#070b14"></span>Night Blue</button>
                <button data-theme-preset="black"><span class="theme-dot" style="background:#000000"></span>Pure Black</button>
                <button data-theme-preset="navy"><span class="theme-dot" style="background:#071321"></span>Deep Navy</button>
                <button data-theme-preset="graphite"><span class="theme-dot" style="background:#111318"></span>Graphite</button>
                <button data-theme-preset="midnight"><span class="theme-dot" style="background:#081116"></span>Midnight Cyan</button>
              </div>
              <div class="menu-divider"></div>
              <div class="menu-title">Custom colors</div>
              <div class="color-row">
                <label>Background<input id="bgPicker" type="color" value="#070b14"></label>
                <label>Text<input id="textPicker" type="color" value="#9ed9ff"></label>
              </div>
              <div class="hex-row">
                <label>BG <input id="bgHex" value="#070b14" maxlength="7"></label>
                <label>Text <input id="textHex" value="#9ed9ff" maxlength="7"></label>
              </div>
              <div class="theme-menu-actions"><button id="resetTheme" class="subtle-btn">Reset</button><button id="applyTheme" class="primary mini">Apply custom</button></div>
            </div>
          </div>
          <button id="run" class="primary">▶ Run</button>
        </div>
      </header>

      <div class="studio">
        <section class="editor">
          <div class="filebar"><span>●</span>&nbsp; main.py <span class="lang">Python</span><span id="cursorStatus" class="cursor-status">Ln 1, Col 1</span></div>
          <div class="editor-area">
            <div id="monaco"></div>
            <button id="askSelection" class="ask-selection hidden">✦ Ask AI</button>
          </div>
        </section>

        <aside class="agent">
          <div class="agent-head"><b>Code Agent<small>Qwen3 8B · local</small></b><i></i></div>
          <div id="agentMsgs" class="agent-msgs">
            <div class="note"><b>Ask about your code.</b><span>Select code to attach it, or ask me about the current file, errors, performance or structure.</span></div>
          </div>
          <div id="selectionBar" class="selection-bar hidden"><span>Selection attached</span><button id="clearSelection">Clear</button></div>
          <div class="agent-input"><textarea id="agentInput" placeholder="Ask about your code…"></textarea><button id="agentSend">↑</button></div>
        </aside>
      </div>

      <section class="output">
        <div class="output-head">
          <div><button class="tab active" data-tab="out">Output</button><button class="tab" data-tab="err">Errors</button></div>
          <button id="copyError" class="copy">Copy error</button>
        </div>
        <div id="outputBody" class="output-body"></div>
      </section>
    </section>

    <section id="aiView" class="view hidden">
      <div class="ai">
        <div class="badge">LOCAL QWEN3 8B</div>
        <h1>AI Assistant</h1>
        <p>Private local conversation powered by Ollama.</p>
        <div id="chat" class="chat"></div>
        <div class="chat-input"><textarea id="chatInput" placeholder="Ask LocalMind anything…"></textarea><button id="chatSend">↑</button></div>
      </div>
    </section>
  </main>
  <div id="toast" class="toast"></div>
</div>`;

const starter = `# LocalMind Code Studio
# Select any lines to ask the AI about them.

def greet(name):
    return f"Hello, {name}!"

print(greet("LocalMind"))
`;

const presets = {
  night: { bg: '#070b14', fg: '#9ed9ff', line: '#0d1726' },
  black: { bg: '#000000', fg: '#a8ddff', line: '#0c1620' },
  navy: { bg: '#071321', fg: '#a9dcff', line: '#0d2033' },
  graphite: { bg: '#111318', fg: '#b8d9ff', line: '#191d26' },
  midnight: { bg: '#081116', fg: '#95e5ff', line: '#0d2128' },
};

function toast(message) {
  const t = document.querySelector('#toast');
  t.textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function validHex(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function theme(name, bg, fg, line = '#0d1726', persist = true) {
  const themeName = `localmind-${name}`;
  monaco.editor.defineTheme(themeName, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6f8499' },
      { token: 'keyword', foreground: 'c4a7ff' },
      { token: 'string', foreground: '9fe3b0' },
      { token: 'number', foreground: '8fd8ff' },
      { token: 'type', foreground: '7fdcff' },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': '#43516b',
      'editorLineNumber.activeForeground': '#78d2ff',
      'editorCursor.foreground': '#78d2ff',
      'editor.selectionBackground': '#264765',
      'editor.lineHighlightBackground': line,
      'editor.lineHighlightBorder': '#1d78a022',
      // Deliberately amber instead of red for error markers.
      'editorError.foreground': '#ffb454',
      'editorError.border': '#ffb454',
      'editorOverviewRuler.errorForeground': '#ffb454',
      'editorOverviewRuler.border': '#00000000',
      'editorBracketHighlight.foreground1': '#78d2ff',
      'editorBracketHighlight.foreground2': '#b5a3ff',
      'editorBracketHighlight.foreground3': '#8fe1b2',
    },
  });
  if (editor) monaco.editor.setTheme(themeName);
  currentTheme = name;
  if (persist) localStorage.setItem('localmind-theme', JSON.stringify({ name, bg, fg, line }));
  updateThemeUI(bg);
}

function updateThemeUI(bg) {
  document.querySelector('#themeSwatch').style.background = bg;
}

Object.entries(presets).forEach(([name, p]) => {
  theme(name, p.bg, p.fg, p.line, false);
});
currentTheme = 'night';
updateThemeUI(presets.night.bg);

function loadSavedTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem('localmind-theme') || 'null');
    if (!saved || !validHex(saved.bg) || !validHex(saved.fg)) return;
    theme(saved.name || 'custom', saved.bg, saved.fg, saved.line || '#0d1726');
    document.querySelector('#bgPicker').value = saved.bg;
    document.querySelector('#textPicker').value = saved.fg;
    document.querySelector('#bgHex').value = saved.bg;
    document.querySelector('#textHex').value = saved.fg;
  } catch {
    // Ignore malformed local settings.
  }
}

function setThemeByName(name) {
  const p = presets[name];
  if (!p) return;
  theme(name, p.bg, p.fg, p.line);
  monaco.editor.setTheme(`localmind-${name}`);
  document.querySelector('#themeMenu').classList.add('hidden');
  document.querySelector('#themeBtn').setAttribute('aria-expanded', 'false');
  document.querySelector('#bgPicker').value = p.bg;
  document.querySelector('#textPicker').value = p.fg;
  document.querySelector('#bgHex').value = p.bg;
  document.querySelector('#textHex').value = p.fg;
  toast(`${name.replace(/^./, c => c.toUpperCase())} theme applied`);
}

function show(view) {
  document.querySelectorAll('.view').forEach((x) => x.classList.add('hidden'));
  document.querySelector(`#${view}View`).classList.remove('hidden');
  document.querySelectorAll('.nav').forEach((x) => x.classList.toggle('active', x.dataset.view === view));
  if (view === 'editor') initEditor();
}

document.querySelectorAll('.nav').forEach((x) => (x.onclick = () => show(x.dataset.view)));
document.querySelectorAll('[data-open]').forEach((x) => (x.onclick = () => show(x.dataset.open)));

function initEditor() {
  if (editor) {
    editor.layout();
    return;
  }
  editor = monaco.editor.create(document.querySelector('#monaco'), {
    value: starter,
    language: 'python',
    theme: `localmind-${currentTheme}`,
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'Cascadia Code,Consolas,monospace',
    smoothScrolling: true,
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    padding: { top: 14, bottom: 14 },
    bracketPairColorization: { enabled: true },
    renderLineHighlight: 'all',
    renderWhitespace: 'selection',
    guides: { indentation: true, bracketPairs: true },
    fixedOverflowWidgets: true,
  });

  editor.onDidChangeCursorPosition((event) => {
    document.querySelector('#cursorStatus').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`;
  });

  editor.onDidChangeCursorSelection(updateSelectionButton);

  editor.onDidChangeModelContent(() => {
    // A previous runtime error may be stale once the user starts typing again.
    if (lastDiagnostic) {
      clearDiagnostics();
      lastDiagnostic = null;
      lastError = '';
      if (currentTab === 'err') renderOutput();
    }
  });

  loadSavedTheme();
  updateSelectionButton();
  renderOutput();
}

function updateSelectionButton() {
  if (!editor) return;
  const button = document.querySelector('#askSelection');
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    button.classList.add('hidden');
    return;
  }
  const position = editor.getScrolledVisiblePosition(selection.getStartPosition());
  if (!position) {
    button.classList.add('hidden');
    return;
  }
  const host = document.querySelector('.editor-area');
  const left = Math.min(host.clientWidth - 105, Math.max(10, position.left + 56));
  const top = Math.max(8, Math.min(host.clientHeight - 38, position.top - 3));
  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  button.classList.remove('hidden');
}

function attachSelectionToAgent() {
  const selection = editor?.getSelection();
  if (!selection || selection.isEmpty()) return;
  pendingSelection = editor.getModel().getValueInRange(selection);
  document.querySelector('#selectionBar').classList.remove('hidden');
  document.querySelector('#agentInput').placeholder = 'Ask AI about the selected code…';
  document.querySelector('#agentInput').focus();
  toast('Selected code attached to the agent');
  updateSelectionButton();
}

document.querySelector('#askSelection').onclick = attachSelectionToAgent;
document.querySelector('#clearSelection').onclick = () => {
  pendingSelection = '';
  document.querySelector('#selectionBar').classList.add('hidden');
  document.querySelector('#agentInput').placeholder = 'Ask about your code…';
};

function clearDiagnostics() {
  if (!editor) return;
  monaco.editor.setModelMarkers(editor.getModel(), 'localmind-runtime', []);
}

function applyDiagnostics(diagnostic) {
  clearDiagnostics();
  if (!editor || !diagnostic?.line) return;
  const line = Math.max(1, diagnostic.line);
  const model = editor.getModel();
  const maxColumn = model.getLineMaxColumn(line);
  const column = Math.max(1, Math.min(diagnostic.column || 1, maxColumn));
  monaco.editor.setModelMarkers(model, 'localmind-runtime', [{
    severity: monaco.MarkerSeverity.Error,
    message: `${diagnostic.type}: ${diagnostic.message}`,
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: Math.min(maxColumn, Math.max(column + 1, column + 1)),
    source: 'LocalMind',
  }]);
  editor.revealLineInCenter(line);
}

function setResultOutput(text) {
  return `<div class="plain-output"><div class="result-label">Program output</div><pre>${escapeHtml(text || '(no output)')}</pre></div>`;
}

function errorCard(d) {
  if (!d) return '<div class="empty-output"><span>✓</span><p>No errors yet.</p><small>Run your Python code to inspect diagnostics here.</small></div>';
  const location = d.line ? `${escapeHtml(d.file || 'main.py')} · line ${d.line}${d.column ? ` · col ${d.column}` : ''}` : 'Runtime result';
  return `<div class="error-card">
    <div class="error-title"><div class="error-icon">!</div><div><b>${escapeHtml(d.type || 'Error')}</b><span>${escapeHtml(d.message || 'Program exited with an error.')}</span></div></div>
    <div class="error-grid">
      <div><small>LOCATION</small><strong>${location}</strong></div>
      <div><small>STATUS</small><strong class="amber">Process exited with error</strong></div>
    </div>
    ${d.code ? `<div class="error-code"><span>${String(d.line || '')}</span><code>${escapeHtml(d.code)}</code></div>` : ''}
    <div class="error-actions"><button class="copy error-copy">Copy Error</button>${d.line ? '<button class="copy go-line">Go to Line</button>' : ''}<button class="copy show-raw">View raw traceback</button></div>
    <pre class="raw-trace hidden">${escapeHtml(d.raw || '')}</pre>
  </div>`;
}

function renderOutput() {
  const body = document.querySelector('#outputBody');
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === currentTab));
  body.innerHTML = currentTab === 'out'
    ? setResultOutput(window.__localmindOutput || '')
    : errorCard(lastDiagnostic);
  bindErrorCardActions();
}

function bindErrorCardActions() {
  const body = document.querySelector('#outputBody');
  body.querySelector('.error-copy')?.addEventListener('click', async () => {
    if (!lastError) return toast('No error to copy.');
    await navigator.clipboard.writeText(lastError);
    toast('Error copied to clipboard.');
  });
  body.querySelector('.go-line')?.addEventListener('click', () => {
    if (!lastDiagnostic?.line || !editor) return;
    editor.setPosition({ lineNumber: lastDiagnostic.line, column: lastDiagnostic.column || 1 });
    editor.revealLineInCenter(lastDiagnostic.line);
    editor.focus();
  });
  body.querySelector('.show-raw')?.addEventListener('click', (event) => {
    const raw = body.querySelector('.raw-trace');
    raw?.classList.toggle('hidden');
    if (raw) event.currentTarget.textContent = raw.classList.contains('hidden') ? 'View raw traceback' : 'Hide raw traceback';
  });
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    currentTab = tab.dataset.tab;
    renderOutput();
  };
});

document.querySelector('#copyError').onclick = async () => {
  if (!lastError) return toast('No error to copy.');
  await navigator.clipboard.writeText(lastError);
  toast('Error copied to clipboard.');
};

document.querySelector('#run').onclick = async () => {
  const button = document.querySelector('#run');
  button.disabled = true;
  button.textContent = 'Running…';
  lastError = '';
  lastDiagnostic = null;
  clearDiagnostics();
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: editor.getValue(), language: 'python' }),
    });
    const data = await r.json();
    if (data.ok) {
      window.__localmindOutput = data.stdout || '';
      currentTab = 'out';
      toast('Code executed successfully');
    } else {
      window.__localmindOutput = data.stdout || '';
      lastError = data.stderr || 'Program exited with an error.';
      lastDiagnostic = data.diagnostic || {
        type: 'RuntimeError',
        message: 'Program exited with an error.',
        file: 'main.py',
        line: null,
        column: null,
        code: '',
        raw: lastError,
      };
      currentTab = 'err';
      applyDiagnostics(lastDiagnostic);
    }
    renderOutput();
  } catch {
    window.__localmindOutput = '';
    lastError = 'Could not reach local code runner.';
    lastDiagnostic = { type: 'BackendError', message: lastError, file: 'main.py', line: null, column: null, code: '', raw: lastError };
    currentTab = 'err';
    renderOutput();
  } finally {
    button.disabled = false;
    button.textContent = '▶ Run';
  }
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[c]);
}

function renderMarkdown(text) {
  const html = marked.parse(text || '');
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

function decorateCodeBlocks(root) {
  root.querySelectorAll('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('ai-code')) return;
    const code = pre.querySelector('code');
    if (!code) return;
    const language = (code.className.match(/language-([\w-]+)/)?.[1] || 'code').toUpperCase();
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-code';
    const bar = document.createElement('div');
    bar.className = 'ai-code-bar';
    bar.innerHTML = `<span>${escapeHtml(language)}</span><button class="ai-code-copy">Copy</button>`;
    pre.replaceWith(wrapper);
    wrapper.append(bar, pre);
  });
}

function appendAgentMessage(role, content) {
  const box = document.querySelector('#agentMsgs');
  const m = document.createElement('div');
  m.className = `msg ${role}`;
  if (role === 'ai') {
    m.innerHTML = renderMarkdown(content);
    decorateCodeBlocks(m);
  } else {
    m.textContent = content;
  }
  box.appendChild(m);
  box.scrollTop = box.scrollHeight;
  return m;
}

async function agent() {
  const input = document.querySelector('#agentInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  appendAgentMessage('user', q);
  const response = appendAgentMessage('ai', 'Thinking…');
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q, code: editor?.getValue() || '', selection: pendingSelection }),
    });
    const data = await r.json();
    if (data.ok) {
      response.innerHTML = renderMarkdown(data.response || '');
      decorateCodeBlocks(response);
    } else {
      response.textContent = `⚠ ${data.error || 'Local agent failed.'}`;
    }
  } catch {
    response.textContent = '⚠ Local backend unavailable.';
  }
  pendingSelection = '';
  document.querySelector('#selectionBar').classList.add('hidden');
  input.placeholder = 'Ask about your code…';
  const box = document.querySelector('#agentMsgs');
  box.scrollTop = box.scrollHeight;
}

document.querySelector('#agentSend').onclick = agent;
document.querySelector('#agentInput').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    agent();
  }
};
document.querySelector('#agentMsgs').addEventListener('click', async (event) => {
  const button = event.target.closest('.ai-code-copy');
  if (!button) return;
  const code = button.closest('.ai-code')?.querySelector('code')?.textContent || '';
  await navigator.clipboard.writeText(code);
  button.textContent = 'Copied';
  setTimeout(() => (button.textContent = 'Copy'), 1200);
});

function appendChatMessage(role, content) {
  const c = document.querySelector('#chat');
  const m = document.createElement('div');
  m.className = `chat-b ${role === 'user' ? 'user' : ''}`;
  const label = document.createElement('b');
  label.textContent = role === 'user' ? 'You' : 'LocalMind';
  m.appendChild(label);
  if (role === 'user') {
    m.appendChild(document.createTextNode(content));
  } else {
    const answer = document.createElement('div');
    answer.innerHTML = renderMarkdown(content);
    decorateCodeBlocks(answer);
    m.appendChild(answer);
  }
  c.appendChild(m);
  c.scrollTop = c.scrollHeight;
  return m;
}

async function chatSend() {
  const input = document.querySelector('#chatInput');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  appendChatMessage('user', q);
  const response = appendChatMessage('ai', 'Thinking…');
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: q }),
    });
    const data = await r.json();
    response.querySelector('div').innerHTML = renderMarkdown(data.ok ? data.response : `⚠ ${data.error}`);
    decorateCodeBlocks(response.querySelector('div'));
  } catch {
    response.querySelector('div').textContent = '⚠ Backend unavailable.';
  }
  document.querySelector('#chat').scrollTop = document.querySelector('#chat').scrollHeight;
}

document.querySelector('#chatSend').onclick = chatSend;
document.querySelector('#chatInput').onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    chatSend();
  }
};
document.querySelector('#chat').addEventListener('click', async (event) => {
  const button = event.target.closest('.ai-code-copy');
  if (!button) return;
  const code = button.closest('.ai-code')?.querySelector('code')?.textContent || '';
  await navigator.clipboard.writeText(code);
  button.textContent = 'Copied';
  setTimeout(() => (button.textContent = 'Copy'), 1200);
});

// Theme popover and native color controls.
const themeBtn = document.querySelector('#themeBtn');
const themeMenu = document.querySelector('#themeMenu');
themeBtn.onclick = (event) => {
  event.stopPropagation();
  const open = !themeMenu.classList.contains('hidden');
  themeMenu.classList.toggle('hidden', open);
  themeBtn.setAttribute('aria-expanded', String(!open));
};
themeMenu.onclick = (event) => event.stopPropagation();
document.addEventListener('click', () => {
  themeMenu.classList.add('hidden');
  themeBtn.setAttribute('aria-expanded', 'false');
});
document.querySelectorAll('[data-theme-preset]').forEach((button) => {
  button.onclick = () => setThemeByName(button.dataset.themePreset);
});

const bgPicker = document.querySelector('#bgPicker');
const textPicker = document.querySelector('#textPicker');
const bgHex = document.querySelector('#bgHex');
const textHex = document.querySelector('#textHex');
bgPicker.oninput = () => (bgHex.value = bgPicker.value);
textPicker.oninput = () => (textHex.value = textPicker.value);
bgHex.oninput = () => { if (validHex(bgHex.value)) bgPicker.value = bgHex.value; };
textHex.oninput = () => { if (validHex(textHex.value)) textPicker.value = textHex.value; };
document.querySelector('#applyTheme').onclick = () => {
  if (!validHex(bgHex.value) || !validHex(textHex.value)) return toast('Use valid 6-digit hex colors.');
  theme('custom', bgHex.value, textHex.value, '#0f2436');
  monaco.editor.setTheme('localmind-custom');
  themeMenu.classList.add('hidden');
  themeBtn.setAttribute('aria-expanded', 'false');
  toast('Custom editor colors applied');
};
document.querySelector('#resetTheme').onclick = () => setThemeByName('night');

// Restore saved custom/preset theme after all controls are ready.
loadSavedTheme();
show('home');
