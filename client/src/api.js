const BASE = '/api';

async function fetchJson(url) {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function getListings(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return fetchJson(`/listings?${qs}`);
}

export async function getListing(id) {
  return fetchJson(`/listings/${id}`);
}

export async function getPriceChanges() {
  return fetchJson('/price-changes');
}

export async function getStats() {
  return fetchJson('/stats');
}

export async function getScrapeLog() {
  return fetchJson('/scrape-log');
}

export async function getSearches() {
  return fetchJson('/searches');
}

export async function createSearch(payload) {
  const res = await fetch(`${BASE}/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create search failed: ${res.status}`);
  return res.json();
}

export async function renameSearch(id, name) {
  const res = await fetch(`${BASE}/searches/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
  return res.json();
}

export async function deleteSearch(id) {
  const res = await fetch(`${BASE}/searches/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return res.json();
}

export async function rerunSearch(id) {
  const res = await fetch(`${BASE}/searches/${id}/run`, { method: 'POST' });
  if (!res.ok) throw new Error(`Re-run failed: ${res.status}`);
  return res.json();
}

export async function getSearchListings(id) {
  return fetchJson(`/searches/${id}/listings`);
}

export async function triggerScrape() {
  const res = await fetch(`${BASE}/scrape`, { method: 'POST' });
  if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
  return res.json();
}
