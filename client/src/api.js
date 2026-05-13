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

export async function triggerScrape() {
  const res = await fetch(`${BASE}/scrape`, { method: 'POST' });
  if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
  return res.json();
}
