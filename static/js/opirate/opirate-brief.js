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
 */

const API_BASE = (typeof window !== 'undefined' && window.location)
  ? window.location.origin
  : 'http://localhost:7000';


/** Build the POST URL for the /api/opirate/brief endpoint. */
export function buildBriefEndpoint(workspaceId, sessionDir) {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (sessionDir) params.set('session_dir', sessionDir);
  return `${API_BASE}/api/opirate/brief?${params.toString()}`;
}


/** Parse a single JSON line from the Pi RPC SSE stream into a structured event. */
export function parsePiEvent(rawLine) {
  if (!rawLine || !rawLine.trim()) return null;

  let data;
  try {
    data = JSON.parse(rawLine);
  } catch (_) {
    return null;
  }
  const eventType = data.event;
  if (eventType === 'thinking_delta') {
    return { type: 'thinking', delta: data.delta || '' };
  }
  if (eventType === 'text_delta') {
    return { type: 'text', delta: data.delta || '' };
  }
  if (eventType === 'message_stop') {
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
      <textarea id="opirate-brief-input" placeholder="Describe what you want Pi to do..."></textarea>
      <button id="opirate-brief-send">Send</button>
      <div id="opirate-brief-stream" class="opirate-stream"></div>
    </div>
  `;

  const input = container.querySelector('#opirate-brief-input');
  const sendBtn = container.querySelector('#opirate-brief-send');
  const stream = container.querySelector('#opirate-brief-stream');
  if (!input || !sendBtn || !stream) return;

  sendBtn.addEventListener('click', async () => {
    const prompt = input.value.trim();
    if (!prompt) return;

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    stream.innerHTML = '';

    // Determine workspace from page context.
    const wsEl = document.querySelector('[data-workspace-id]');
    const workspaceId = wsEl ? wsEl.dataset.workspaceId : 'default';
    const url = `${API_BASE}/api/opirate/brief`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, prompt }),
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
          const event = parsePiEvent(json);
          if (event) renderPiEvent(event, stream);
        }
      }
    } catch (err) {
      stream.innerHTML = `<div class="opirate-error">Stream error: ${err.message}</div>`;
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
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
