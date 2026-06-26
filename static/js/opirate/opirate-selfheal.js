/**
 * opirate-selfheal.js — Self-heal SSE banner UI (S4).
 */
const API_BASE = (typeof window !== 'undefined' && window.location) ? window.location.origin : 'http://localhost:7000';

export function buildSelfHealEndpoint() { return `${API_BASE}/api/opirate/selfheal`; }
export function parseSelfHealStatus(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}
