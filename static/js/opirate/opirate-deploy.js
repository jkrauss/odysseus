/**
 * opirate-deploy.js — Deploy trigger + approval modal + live terminal (S2 + S3).
 *
 * Exports:
 *   buildDeployEndpoint() → URL string
 *   buildApproveEndpoint(tokenId) → URL string
 *   buildDeployRunEndpoint(tokenId) → URL string
 *   buildManifestEndpoint(project) → URL string
 *   buildActionEndpoint() → URL string
 *   parseDeployLine(line) → string
 *   formatCost(amount) → string
 *   initDeployPanel(containerId) — full DOM wiring
 *   openDeployPanel() — show the deploy panel, hide chat
 *   closeDeployPanel() — hide the deploy panel, restore chat
 *   toggleDeployPanel() — toggle between deploy panel and chat
 */
const API_BASE = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost:7000';

let _deployOpen = false;

export function buildDeployEndpoint() { return `${API_BASE}/api/opirate/deploy`; }
export function buildApproveEndpoint(tokenId) { return `${API_BASE}/api/opirate/approve/${tokenId}`; }
export function buildDeployRunEndpoint(tokenId) { return `${API_BASE}/api/opirate/deploy/${tokenId}/run`; }
export function buildManifestEndpoint(project) { return `${API_BASE}/api/opirate/manifest/${project}`; }
export function buildActionEndpoint() { return `${API_BASE}/api/opirate/action`; }

export function parseDeployLine(line) { return line; }

export function formatCost(amount) {
  if (amount == null) return 'Cost unknown (requires approval)';
  if (amount === 0) return 'free tier (no cost)';
  return `~€${Number(amount).toFixed(2)}/month`;
}

export const STATUS_LABELS = { provision: 'Provision', deprovision: 'Deprovision', status: 'Status' };

/**
 * initDeployPanel — wires the deploy trigger, approval modal, and streaming
 * terminal into the DOM inside `containerId`.
 */
export function initDeployPanel(containerId) {
  if (typeof document === 'undefined') return;
  const c = document.getElementById(containerId);
  if (!c) return;
  c.innerHTML = `
    <div class="opirate-deploy">
      <div class="opirate-palette">
        <button data-opirate-action="provision">Provision</button>
        <button data-opirate-action="deprovision">Deprovision</button>
        <button data-opirate-action="status">Status</button>
      </div>
      <div id="opirate-approval-modal" class="opirate-modal" style="display:none">
        <div class="opirate-modal-content">
          <h3>Deployment Approval</h3>
          <p id="opirate-approval-project"></p>
          <p id="opirate-approval-cost"></p>
          <button id="opirate-approval-cancel">Cancel</button>
          <button id="opirate-approval-confirm">Approve</button>
        </div>
      </div>
      <div id="opirate-terminal" class="opirate-terminal"></div>
    </div>
  `;

  const terminal = c.querySelector('#opirate-terminal');
  const modal = c.querySelector('#opirate-approval-modal');
  c.querySelectorAll('[data-opirate-action]').forEach(btn => {
    btn.addEventListener('click', () => _handleAction(btn.dataset.opirateAction, terminal, modal));
  });
  c.querySelector('#opirate-approval-cancel').addEventListener('click', () => { modal.style.display = 'none'; });
}

let _pendingToken = null;

async function _handleAction(action, terminal, modal) {
  const project = document.querySelector('[data-workspace-id]')?.dataset?.workspaceId || 'default';
  if (action === 'status') {
    _runStream(buildActionEndpoint(), { action, project }, terminal);
    return;
  }
  // Cost-bearing: fetch manifest, then show approval modal.
  try {
    const m = await (await fetch(buildManifestEndpoint(project))).json();
    const cost = m.cost_estimate;
    document.getElementById('opirate-approval-project').textContent = `Project: ${project} — ${STATUS_LABELS[action] || action}`;
    document.getElementById('opirate-approval-cost').textContent = `Cost: ${formatCost(cost)}`;
    modal.style.display = 'flex';
    document.getElementById('opirate-approval-confirm').onclick = async () => {
      modal.style.display = 'none';
      // Request approval token, then run.
      const t = await (await fetch(buildDeployEndpoint(), { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({project, manifest: m}) })).json();
      await fetch(buildApproveEndpoint(t.token_id), { method:'POST' });
      _runStream(buildDeployRunEndpoint(t.token_id), null, terminal);
    };
  } catch (e) {
    terminal.innerHTML = `<div class="opirate-error">Deploy error: ${e.message}</div>`;
  }
}

async function _runStream(url, body, terminal) {
  terminal.innerHTML = '';
  try {
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : null });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const l of lines) {
        if (!l.startsWith('data: ')) continue;
        const j = l.slice(6);
        let text; try { text = JSON.parse(j).line || j; } catch (_) { text = j; }
        const div = document.createElement('div'); div.textContent = parseDeployLine(text); terminal.appendChild(div);
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  } catch (e) {
    terminal.innerHTML += `<div class="opirate-error">${e.message}</div>`;
  }
}

export function openDeployPanel() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('opirate-deploy-panel');
  const chat = document.getElementById('chat-container');
  if (!panel || !chat) return;
  chat.style.display = 'none';
  panel.style.display = '';
  _deployOpen = true;
  const btn = document.getElementById('tool-opirate-deploy-btn');
  if (btn) btn.classList.add('active');
}

export function closeDeployPanel() {
  if (typeof document === 'undefined') return;
  const panel = document.getElementById('opirate-deploy-panel');
  const chat = document.getElementById('chat-container');
  if (!panel || !chat) return;
  panel.style.display = 'none';
  chat.style.display = '';
  _deployOpen = false;
  const btn = document.getElementById('tool-opirate-deploy-btn');
  if (btn) btn.classList.remove('active');
}

export function toggleDeployPanel() {
  if (_deployOpen) closeDeployPanel();
  else openDeployPanel();
}
