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

/**
 * Stream a scrape run via Server-Sent Events.
 * Calls `onEvent(type, data)` for every frame; throws on network error.
 * Returns a promise that resolves when the stream ends.
 *
 * Pass an AbortSignal to cancel the stream (e.g. on component unmount). When
 * aborted, the fetch is cancelled and the function returns quietly instead of
 * leaking a reader that calls setState on an unmounted component.
 */
export async function runSearchStream(id, onEvent, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/searches/${id}/run/stream`, {
      method: 'POST',
      headers: { 'Accept': 'text/event-stream' },
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
  if (!res.ok) throw new Error(`Run stream failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    if (signal?.aborted) { try { await reader.cancel(); } catch {} return; }
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) return;
      throw err;
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line ("\n\n")
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const lines = frame.split('\n');
      let event = 'message', data = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      onEvent(event, parsed);
    }
  }
}

export async function getSearchListings(id) {
  return fetchJson(`/searches/${id}/listings`);
}

export async function shutdownServer() {
  const res = await fetch(`${BASE}/shutdown`, { method: 'POST' });
  if (!res.ok) throw new Error(`Shutdown failed: ${res.status}`);
  return res.json();
}

export async function triggerScrape() {
  const res = await fetch(`${BASE}/scrape`, { method: 'POST' });
  if (!res.ok) throw new Error(`Scrape failed: ${res.status}`);
  return res.json();
}
