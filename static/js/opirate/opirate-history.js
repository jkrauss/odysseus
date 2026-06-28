/**
 * opirate-history.js — Deployment timeline view (S5).
 */
const API_BASE = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost:7000';

export function buildTimelineEndpoint(project) { return `${API_BASE}/api/opirate/timeline/${encodeURIComponent(project)}`; }
export function buildHistoryEndpoint(project) { return buildTimelineEndpoint(project); }

export function formatEvent(e) {
  const ts = e.timestamp ? new Date(e.timestamp).toLocaleString() : 'unknown time';
  const status = e.result === 'success' ? '✓' : '✗';
  const err = e.error ? ` — ${e.error}` : '';
  return `[${ts}] ${e.action} ${status}${err}`;
}
