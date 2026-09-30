export type SandboxPageOptions = {
	providerMode: "mock" | "live";
	repository: string;
};

export function sandboxPage(options: SandboxPageOptions): Response {
	const modeLabel =
		options.providerMode === "live" ? "Live providers" : "Mock providers";
	const providerDescription =
		options.providerMode === "live"
			? "OpenAI and GitHub use your local credentials. LINE delivery remains captured locally."
			: "OpenAI, GitHub, and LINE are mocked locally while production orchestration code runs end to end.";
	const page = html
		.replaceAll("{{MODE_LABEL}}", escapeHtml(modeLabel))
		.replaceAll("{{PROVIDER_DESCRIPTION}}", escapeHtml(providerDescription))
		.replaceAll("{{REPOSITORY}}", escapeHtml(options.repository));

	return new Response(page, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Security-Policy":
				"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
			"Content-Type": "text/html; charset=utf-8",
		},
	});
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		};
		return entities[character] ?? character;
	});
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LINE Coding Agent Sandbox</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f3f8fb;
      color: #10233f;
      font-synthesis: none;
    }
    * { box-sizing: border-box; }
    body {
      min-width: 320px;
      min-height: 100vh;
      margin: 0;
      background:
        radial-gradient(circle at 10% 0%, rgba(16, 185, 129, 0.12), transparent 30rem),
        radial-gradient(circle at 95% 5%, rgba(37, 99, 235, 0.14), transparent 34rem),
        #f3f8fb;
    }
    button, textarea { font: inherit; }
    button { cursor: pointer; }
    .shell { max-width: 1320px; margin: 0 auto; padding: 36px 28px 48px; }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      color: #087d6b;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0.13em;
      text-transform: uppercase;
    }
    .eyebrow::before { width: 24px; height: 2px; content: ""; background: #0ea58a; }
    h1 { max-width: 760px; margin: 0; font-size: clamp(32px, 4vw, 54px); line-height: 1.02; letter-spacing: -0.045em; }
    .subtitle { max-width: 700px; margin: 14px 0 0; color: #597089; font-size: 17px; line-height: 1.6; }
    .connection {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      flex: none;
      margin-top: 4px;
      padding: 9px 13px;
      border: 1px solid #cce6de;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.78);
      color: #176f60;
      font-size: 13px;
      font-weight: 750;
      box-shadow: 0 8px 24px rgba(23, 67, 83, 0.05);
    }
    .connection-dot { width: 9px; height: 9px; border-radius: 50%; background: #10b981; box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.14); }
    .connection[data-status="error"] { color: #b42318; border-color: #f4c7c3; }
    .connection[data-status="error"] .connection-dot { background: #ef4444; box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.13); }
    .layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(320px, 0.85fr); gap: 20px; align-items: stretch; }
    .panel {
      overflow: hidden;
      border: 1px solid rgba(133, 170, 189, 0.3);
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.9);
      box-shadow: 0 20px 50px rgba(26, 69, 91, 0.1);
      backdrop-filter: blur(14px);
    }
    .chat-panel { display: flex; min-height: 650px; flex-direction: column; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; border-bottom: 1px solid #e5eef3; }
    .panel-title { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
    .panel-kicker { margin-top: 5px; color: #7890a3; font-size: 12px; }
    .bot-mark { display: grid; width: 42px; height: 42px; place-items: center; border-radius: 14px; background: linear-gradient(145deg, #16a98f, #087d6b); color: white; font-size: 18px; font-weight: 900; box-shadow: 0 9px 22px rgba(8, 125, 107, 0.23); }
    .bot-heading { display: flex; align-items: center; gap: 12px; }
    .clear-button { padding: 8px 11px; border: 1px solid #dce8ee; border-radius: 10px; background: white; color: #587084; font-size: 12px; font-weight: 700; }
    .clear-button:hover { border-color: #b7cbd5; color: #14344a; }
    .messages { display: flex; flex: 1; flex-direction: column; gap: 18px; min-height: 300px; padding: 26px; overflow-y: auto; }
    .welcome { max-width: 560px; margin: auto; text-align: center; }
    .welcome-icon { display: grid; width: 64px; height: 64px; margin: 0 auto 18px; place-items: center; border: 1px solid #d3e7e5; border-radius: 20px; background: #edfaf7; color: #087d6b; font-size: 26px; }
    .welcome h2 { margin: 0 0 8px; font-size: 23px; letter-spacing: -0.025em; }
    .welcome p { margin: 0; color: #6b8192; line-height: 1.55; }
    .message { display: flex; gap: 11px; animation: enter 180ms ease-out; }
    .message.user { justify-content: flex-end; }
    .avatar { display: grid; width: 30px; height: 30px; flex: none; place-items: center; border-radius: 10px; background: #e9f7f4; color: #087d6b; font-size: 12px; font-weight: 900; }
    .bubble { max-width: min(82%, 680px); padding: 13px 15px; border-radius: 7px 17px 17px 17px; background: #eef5f8; color: #19364c; font-size: 14px; line-height: 1.58; white-space: pre-wrap; }
    .user .bubble { border-radius: 17px 7px 17px 17px; background: #153b58; color: white; }
    .composer { padding: 20px 22px 22px; border-top: 1px solid #e5eef3; background: rgba(248, 252, 253, 0.86); }
    .examples { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 11px; }
    .example { padding: 7px 10px; border: 1px solid #d9e8ed; border-radius: 999px; background: white; color: #486779; font-size: 11px; font-weight: 700; }
    .example:hover { border-color: #8bcfc3; background: #f0fbf8; color: #087d6b; }
    .input-wrap { display: flex; align-items: flex-end; gap: 10px; padding: 9px 9px 9px 15px; border: 1px solid #cbdde5; border-radius: 18px; background: white; box-shadow: 0 6px 18px rgba(28, 76, 98, 0.06); }
    textarea { width: 100%; min-height: 50px; max-height: 150px; resize: vertical; border: 0; outline: 0; background: transparent; color: #102b40; line-height: 1.5; }
    textarea::placeholder { color: #8ba0ae; }
    .send { min-width: 92px; padding: 13px 17px; border: 0; border-radius: 13px; background: linear-gradient(145deg, #16a98f, #087d6b); color: white; font-size: 13px; font-weight: 800; box-shadow: 0 8px 18px rgba(8, 125, 107, 0.22); }
    .send:hover { filter: brightness(1.04); }
    .send:disabled { cursor: wait; opacity: 0.55; }
    .hint { margin-top: 9px; color: #8a9dab; font-size: 11px; }
    .composer-meta { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 10px; }
    .memory-toggle { display: inline-flex; align-items: center; gap: 8px; color: #587084; font-size: 12px; font-weight: 750; cursor: pointer; }
    .memory-toggle input { width: 16px; height: 16px; margin: 0; accent-color: #0b927c; }
    .memory-toggle span { color: #8a9dab; font-size: 10px; font-weight: 600; }
    .trace-panel { display: flex; min-height: 650px; flex-direction: column; }
    .trace-body { display: flex; flex: 1; flex-direction: column; gap: 18px; padding: 22px; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; }
    .metric { padding: 14px 10px; border: 1px solid #e0ebef; border-radius: 14px; background: #f8fbfc; }
    .metric-value { display: block; color: #103b58; font-size: 22px; font-weight: 850; letter-spacing: -0.035em; }
    .metric-label { display: block; margin-top: 2px; color: #7c91a0; font-size: 10px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
    .flow { display: flex; flex-direction: column; }
    .step { position: relative; display: grid; grid-template-columns: 31px 1fr auto; gap: 11px; align-items: center; min-height: 58px; }
    .step:not(:last-child)::after { position: absolute; top: 43px; bottom: -2px; left: 15px; width: 1px; content: ""; background: #dbe7ec; }
    .step-icon { z-index: 1; display: grid; width: 31px; height: 31px; place-items: center; border: 1px solid #d8e7ec; border-radius: 10px; background: white; color: #6f8797; font-size: 12px; font-weight: 900; }
    .step[data-state="done"] .step-icon { border-color: #a9ddcf; background: #e9f9f4; color: #087d6b; }
    .step-title { font-size: 13px; font-weight: 800; }
    .step-detail { margin-top: 3px; color: #8295a2; font-size: 11px; }
    .step-state { padding: 5px 7px; border-radius: 7px; background: #f0f4f6; color: #8195a2; font-size: 9px; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; }
    .step[data-state="done"] .step-state { background: #e9f9f4; color: #087d6b; }
    .trace-log { flex: 1; min-height: 130px; padding: 14px; border-radius: 14px; background: #102b40; color: #c7e2ed; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; }
    .trace-empty { color: #7996a6; }
    .error { color: #b42318; }
    @keyframes enter { from { transform: translateY(5px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    @media (max-width: 900px) {
      .shell { padding: 26px 16px 36px; }
      .topbar { flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .chat-panel, .trace-panel { min-height: auto; }
      .messages { min-height: 370px; }
    }
    @media (max-width: 540px) {
      .panel-header, .messages, .trace-body { padding-left: 17px; padding-right: 17px; }
      .composer { padding: 15px; }
      .input-wrap { align-items: stretch; flex-direction: column; }
      .send { width: 100%; }
      .bubble { max-width: 90%; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <div class="eyebrow">Local full-loop environment · {{MODE_LABEL}}</div>
        <h1>LINE Coding Agent Sandbox</h1>
        <p class="subtitle">Ask a code question and watch the complete agent loop run through signed LINE webhooks, OpenAI tool calls, GitHub source access, and a captured LINE reply.</p>
      </div>
      <div id="connection" class="connection" data-status="checking"><span class="connection-dot"></span><span>Checking services</span></div>
    </header>

    <section class="layout">
      <section class="panel chat-panel" aria-label="Sandbox chat">
        <header class="panel-header">
          <div class="bot-heading">
            <div class="bot-mark">L</div>
            <div><h2 class="panel-title">LINE Assistant</h2><div class="panel-kicker">{{MODE_LABEL}} · {{REPOSITORY}}</div></div>
          </div>
          <button id="reset" class="clear-button" type="button">Reset session</button>
        </header>
        <div id="messages" class="messages" aria-live="polite">
          <div id="welcome" class="welcome">
            <div class="welcome-icon">⌘</div>
            <h2>Test the real agent loop</h2>
            <p>{{PROVIDER_DESCRIPTION}}</p>
          </div>
        </div>
        <form id="composer" class="composer">
          <div class="examples">
            <button class="example" type="button" data-question="Why does login fail?">Debug login</button>
            <button class="example" type="button" data-question="Explain the login business logic">Explain logic</button>
            <button class="example" type="button" data-question="Where is login implemented?">Find implementation</button>
          </div>
          <div class="input-wrap">
            <textarea id="question" name="question" rows="2" required placeholder="Ask about the sandbox codebase…"></textarea>
            <button id="send" class="send" type="submit">Run agent</button>
          </div>
          <div class="composer-meta">
            <label class="memory-toggle" for="use-memory">
              <input id="use-memory" type="checkbox">
              Use conversation memory
              <span>adds previous turns to token usage</span>
            </label>
            <div class="hint">Enter to send · Shift + Enter for a new line</div>
          </div>
        </form>
      </section>

      <aside class="panel trace-panel" aria-label="Execution trace">
        <header class="panel-header">
          <div><h2 class="panel-title">Execution trace</h2><div class="panel-kicker">Evidence from the latest request</div></div>
        </header>
        <div class="trace-body">
          <div class="metrics">
            <div class="metric"><span id="openai-count" class="metric-value">0</span><span class="metric-label">OpenAI</span></div>
            <div class="metric"><span id="github-count" class="metric-value">0</span><span class="metric-label">GitHub</span></div>
            <div class="metric"><span id="line-count" class="metric-value">0</span><span class="metric-label">LINE</span></div>
          </div>
          <div class="flow">
            <div class="step" data-step="webhook"><div class="step-icon">1</div><div><div class="step-title">Signed LINE webhook</div><div class="step-detail">HMAC-SHA256 verified</div></div><span class="step-state">Waiting</span></div>
            <div class="step" data-step="search"><div class="step-icon">2</div><div><div class="step-title">Search repository</div><div class="step-detail">search_code tool</div></div><span class="step-state">Waiting</span></div>
            <div class="step" data-step="read"><div class="step-icon">3</div><div><div class="step-title">Read source file</div><div class="step-detail">read_file tool</div></div><span class="step-state">Waiting</span></div>
            <div class="step" data-step="reply"><div class="step-icon">4</div><div><div class="step-title">Reply through LINE</div><div class="step-detail">Captured by mock API</div></div><span class="step-state">Waiting</span></div>
          </div>
          <div id="trace-log" class="trace-log"><span class="trace-empty">Run the agent to see request evidence.</span></div>
        </div>
      </aside>
    </section>
  </main>
  <script>
    const messages = document.querySelector('#messages');
    const welcome = document.querySelector('#welcome');
    const composer = document.querySelector('#composer');
    const question = document.querySelector('#question');
    const send = document.querySelector('#send');
    const reset = document.querySelector('#reset');
    const traceLog = document.querySelector('#trace-log');
    const connection = document.querySelector('#connection');
    const useMemory = document.querySelector('#use-memory');
    const memoryPreferenceKey = 'line-agent-sandbox-memory';
    useMemory.checked = sessionStorage.getItem(memoryPreferenceKey) === 'on';

    function setConnection(ok, providerMode) {
      connection.dataset.status = ok ? 'ok' : 'error';
      connection.querySelector('span:last-child').textContent = ok
        ? (providerMode === 'live' ? 'Live providers ready' : 'All mocks online')
        : 'Sandbox unavailable';
    }

    function addMessage(role, text) {
      if (welcome) welcome.remove();
      const row = document.createElement('div');
      row.className = 'message ' + role;
      if (role !== 'user') {
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = 'AI';
        row.appendChild(avatar);
      }
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      bubble.textContent = text;
      row.appendChild(bubble);
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
      return bubble;
    }

    function setStep(name, done) {
      const step = document.querySelector('[data-step="' + name + '"]');
      step.dataset.state = done ? 'done' : '';
      step.querySelector('.step-state').textContent = done ? 'Done' : 'Waiting';
    }

    function renderResult(result) {
      const replies = result.lineReplies || [];
      const latest = replies[replies.length - 1];
      const replyText = latest && latest.messages && latest.messages[0] && latest.messages[0].text;
      addMessage('assistant', replyText || 'The loop finished without a LINE text reply.');
      document.querySelector('#openai-count').textContent = String(result.responseRequestCount || 0);
      document.querySelector('#github-count').textContent = String((result.githubRequests || []).length);
      document.querySelector('#line-count').textContent = String(replies.length);
      setStep('webhook', result.status === 200);
      setStep('search', (result.githubRequests || []).some(function(path) { return path.includes('/search/code'); }));
      setStep('read', (result.githubRequests || []).some(function(path) { return path.includes('/contents/'); }));
      setStep('reply', Boolean(replyText));
      traceLog.textContent = [
        'webhook: HTTP ' + result.status,
        'memory: ' + (result.memoryEnabled ? 'on' : 'off'),
        'responses: ' + (result.responseRequestCount || 0) + ' requests',
        'github:',
        ...(result.githubRequests || []).map(function(path) { return '  ' + path; }),
        'line reply: ' + (replyText || 'none')
      ].join('\\n');
    }

    async function runAgent(text) {
      addMessage('user', text);
      const pending = addMessage('assistant', 'Running the full agent loop…');
      send.disabled = true;
      question.disabled = true;
      try {
        const response = await fetch('/sandbox/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text, useMemory: useMemory.checked })
        });
        const result = await response.json();
        pending.parentElement.remove();
        if (!response.ok) throw new Error(result.error || 'Sandbox request failed');
        renderResult(result);
      } catch (error) {
        pending.textContent = error instanceof Error ? error.message : 'Sandbox request failed';
        pending.classList.add('error');
        setConnection(false);
      } finally {
        send.disabled = false;
        question.disabled = false;
        question.focus();
      }
    }

    composer.addEventListener('submit', function(event) {
      event.preventDefault();
      const text = question.value.trim();
      if (!text) return;
      question.value = '';
      runAgent(text);
    });

    question.addEventListener('keydown', function(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        composer.requestSubmit();
      }
    });

    document.querySelectorAll('[data-question]').forEach(function(button) {
      button.addEventListener('click', function() {
        question.value = button.dataset.question || '';
        question.focus();
      });
    });

    reset.addEventListener('click', async function() {
      await fetch('/sandbox/reset', { method: 'POST' });
      sessionStorage.removeItem(memoryPreferenceKey);
      location.reload();
    });

    useMemory.addEventListener('change', function() {
      sessionStorage.setItem(memoryPreferenceKey, useMemory.checked ? 'on' : 'off');
    });

    fetch('/health')
      .then(async function(response) {
        const health = response.ok ? await response.json() : {};
        setConnection(response.ok, health.providerMode);
      })
      .catch(function() { setConnection(false); });
  </script>
</body>
</html>`;
