/**
 * opirate-brief.js — OPirate Brief Dev Panel UI (S1).
 *
 * Provides the client-side wiring for the "write a brief → watch Pi stream"
 * experience. The module is a pure ES module (no bundler) following the
 * same conventions as Odysseus's existing static/js/ modules.
 *
 * Exports:
 *   buildBriefEndpoint(workspaceId, sessionDir?) → URL string
 *   parsePiEvent(rawLine) → {type, delta} | null
 *   renderPiEvent(event, destElement) — append + scroll
 *   initBriefPanel(containerId) — full DOM wiring
 *   openBriefPanel() — show the brief panel, hide chat
 *   closeBriefPanel() — hide the brief panel, restore chat
 *   toggleBriefPanel() — toggle between brief panel and chat
 */

const API_BASE = (typeof window !== 'undefined' && window.location)
  ? window.location.origin
  : 'http://localhost:7000';

let _briefOpen = false;
let _loopMode = false;

export function buildLoopEndpoint() { return `${API_BASE}/api/opirate/loop`; }


/** Build the POST URL for the /api/opirate/brief endpoint. */
export function buildBriefEndpoint(workspaceId, sessionDir) {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (sessionDir) params.set('session_dir', sessionDir);
  return `${API_BASE}/api/opirate/brief?${params.toString()}`;
}


/** Parse a single JSON line from the Pi RPC SSE stream into a structured event.
 *
 * Wire format (Pi v0.81+ RPC mode, observed 2026-06-27):
 *   { "type": "message_update",
 *     "assistantMessageEvent": { "type": "thinking_delta"|"text_delta", "delta": "..." } }
 *   { "type": "turn_end" }                              // end of one assistant turn
 *   { "type": "agent_end" }                             // end of the whole session
 *
 * Anything else returns null — renderPiEvent only consumes the three
 * shapes the panel can actually show.
 */
export function parsePiEvent(rawLine) {
  if (!rawLine || !rawLine.trim()) return null;

  let data;
  try {
    data = JSON.parse(rawLine);
  } catch (_) {
    return null;
  }
  const outerType = data.type;
  const inner = data.assistantMessageEvent;
  if (outerType === 'message_update' && inner && typeof inner === 'object') {
    if (inner.type === 'thinking_delta') {
      return { type: 'thinking', delta: inner.delta || '' };
    }
    if (inner.type === 'text_delta') {
      return { type: 'text', delta: inner.delta || '' };
    }
    return null;
  }
  if (outerType === 'turn_end' || outerType === 'agent_end') {
    return { type: 'stop' };
  }
  return null;
}


/** Append a rendered Pi event to the destination element, scrolling to bottom. */
export function renderPiEvent(event, dest) {
  if (!dest) return;

  // The ownerDocument is the real document when running in a browser; in a
  // Node test environment we provide a shim so the pure functions stay
  // testable without jsdom.
  const doc = (dest.ownerDocument || globalThis.document);
  const makeElement = (tag) => {
    if (doc && typeof doc.createElement === 'function') return doc.createElement(tag);
    // Minimal shim so tests pass without a full DOM.
    const el = { appendChild() {}, children: [], className: '' };
    el.classList = { add() {}, contains() { return false; } };
    return el;
  };
  if (event.type === 'thinking') {
    const span = makeElement('span');
    span.className = 'opirate-thinking';
    span.textContent = event.delta;
    dest.appendChild(span);
} else if (event.type === 'text') {
    const children = dest.children;
    const last = children.length > 0 ? children[children.length - 1] : null;
    if (last && last.className === 'opirate-text') {
      last.textContent += event.delta;
    } else {
      const div = makeElement('div');
      div.className = 'opirate-text';
      div.textContent = event.delta;
      dest.appendChild(div);
    }
  } else if (event.type === 'stop') {
    const br = makeElement('br');
    dest.appendChild(br);
    const sep = makeElement('div');
    sep.className = 'opirate-done';
    dest.appendChild(sep);
  }

  // Auto-scroll to the latest content.
  if (typeof dest.scrollTo === 'function') {
    dest.scrollTo(0, dest.scrollHeight);
  } else {
    dest.scrollTop = dest.scrollHeight;
  }
}


/** Full DOM wiring: input listener, fetch + SSE streaming, rendering. */
export function initBriefPanel(containerId) {
  if (typeof document === 'undefined') return;  // server-side / test guard

  const container = document.getElementById(containerId);
  if (!container) return;

  // Build a minimal Dev Panel inside the container.
  container.innerHTML = `
    <div class="opirate-dev-panel">
      <div class="opirate-mode-toggle">
        <button id="opirate-mode-brief" class="opirate-mode-btn active">Brief</button>
        <button id="opirate-mode-loop" class="opirate-mode-btn">Feedback Loop</button>
      </div>
      <textarea id="opirate-brief-input" placeholder="Describe what you want Pi to do..."></textarea>
      <button id="opirate-brief-send">Send</button>
      <div id="opirate-brief-stream" class="opirate-stream"></div>
    </div>
  `;

  const input = container.querySelector('#opirate-brief-input');
  const sendBtn = container.querySelector('#opirate-brief-send');
  const stream = container.querySelector('#opirate-brief-stream');
  const modeBrief = container.querySelector('#opirate-mode-brief');
  const modeLoop = container.querySelector('#opirate-mode-loop');
  if (!input || !sendBtn || !stream) return;

  // Mode toggle
  if (modeBrief && modeLoop) {
    modeBrief.addEventListener('click', () => {
      _loopMode = false;
      modeBrief.classList.add('active');
      modeLoop.classList.remove('active');
      input.placeholder = 'Describe what you want Pi to do...';
      sendBtn.textContent = 'Send';
    });
    modeLoop.addEventListener('click', () => {
      _loopMode = true;
      modeLoop.classList.add('active');
      modeBrief.classList.remove('active');
      input.placeholder = 'Describe the feature to build (full feedback loop)...';
      sendBtn.textContent = 'Run Loop';
    });
  }

  sendBtn.addEventListener('click', async () => {
    const prompt = input.value.trim();
    if (!prompt) return;

    sendBtn.disabled = true;
    sendBtn.textContent = _loopMode ? 'Running...' : 'Sending...';
    stream.innerHTML = '';

    const wsEl = document.querySelector('[data-workspace-id]');
    const workspaceId = wsEl ? wsEl.dataset.workspaceId : 'default';

    // Choose endpoint based on mode
    const url = _loopMode ? buildLoopEndpoint() : `${API_BASE}/api/opirate/brief`;
    const body = _loopMode
      ? JSON.stringify({ brief: prompt })
      : JSON.stringify({ workspace_id: workspaceId, prompt });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
      });

      if (!res.ok) {
        stream.innerHTML = `<div class="opirate-error">Brief failed (${res.status})</div>`;
        return;
      }

      // Stream the SSE response line by line.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // incomplete line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6); // strip "data: " prefix
          if (_loopMode) {
            // Loop mode: deploy-style output (plain text lines)
            let text;
            try { text = JSON.parse(json).line || json; } catch (_) { text = json; }
            const div = document.createElement('div');
            div.textContent = text;
            div.className = 'opirate-text';
            stream.appendChild(div);
            stream.scrollTop = stream.scrollHeight;
          } else {
            // Brief mode: Pi events
            const event = parsePiEvent(json);
            if (event) renderPiEvent(event, stream);
          }
        }
      }
    } catch (err) {
      stream.innerHTML = `<div class="opirate-error">Stream error: ${err.message}</div>`;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = _loopMode ? 'Run Loop' : 'Send';
      input.value = '';
      input.focus();
    }
  });

  // Ctrl+Enter shortcut.
  input.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendBtn.click();
    }
  });
}

export function openBriefPanel() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('opirate-brief-panel');
  const chat = document.getElementById('chat-container');
  if (!panel || !chat) return;
  chat.style.display = 'none';
  panel.style.display = '';
  _briefOpen = true;
  const btn = document.getElementById('tool-opirate-brief-btn');
  if (btn) btn.classList.add('active');
}

export function closeBriefPanel() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('opirate-brief-panel');
  const chat = document.getElementById('chat-container');
  if (!panel || !chat) return;
  panel.style.display = 'none';
  chat.style.display = '';
  _briefOpen = false;
  const btn = document.getElementById('tool-opirate-brief-btn');
  if (btn) btn.classList.remove('active');
}

export function toggleBriefPanel() {
  if (_briefOpen) closeBriefPanel();
  else openBriefPanel();
}
