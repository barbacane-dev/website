// dev.to channel.
// API: https://developers.forem.com/api/v1
// Auth: api-key header.

const API_BASE = 'https://dev.to/api';

export const name = 'dev.to';

export function isConfigured() {
  return !!process.env.DEV_TO_API_KEY;
}

export function missingConfig() {
  return ['DEV_TO_API_KEY'];
}

// dev.to tags must be lowercase alphanumeric, no separators, max 4.
export function transformTags(tags) {
  return (tags || [])
    .map((t) => String(t).toLowerCase().replace(/-/g, ''))
    .filter((t) => /^[a-z0-9]+$/.test(t))
    .slice(0, 4);
}

// Returns { id, url } if a post with the same canonical_url already exists
// on the authenticated user's account, else null. The id is needed by
// update() to PUT a refreshed body.
export async function findExisting(article) {
  const apiKey = process.env.DEV_TO_API_KEY;
  let page = 1;
  while (true) {
    const res = await fetch(`${API_BASE}/articles/me/all?per_page=1000&page=${page}`, {
      headers: { 'api-key': apiKey },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`dev.to GET ${res.status}: ${text}`);
    const items = JSON.parse(text);
    const match = items.find((a) => a.canonical_url === article.canonical_url);
    if (match) return { id: match.id, url: match.url };
    if (items.length < 1000) return null;
    page++;
  }
}

export async function post(article) {
  const payload = {
    article: {
      title: article.title,
      body_markdown: article.body_markdown,
      published: true,
      tags: transformTags(article.tags),
      canonical_url: article.canonical_url,
      description: article.description,
    },
  };
  const res = await fetch(`${API_BASE}/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.DEV_TO_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dev.to POST ${res.status}: ${text}`);
  const result = JSON.parse(text);
  return { url: result.url };
}

// Re-pushes the current article body to an existing post. Only fields
// that may have drifted (title, body, description, tags) are sent;
// canonical_url and published state are intentionally not touched.
export async function update(article, existing) {
  const payload = {
    article: {
      title: article.title,
      body_markdown: article.body_markdown,
      tags: transformTags(article.tags),
      description: article.description,
    },
  };
  const res = await fetch(`${API_BASE}/articles/${existing.id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.DEV_TO_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`dev.to PUT ${res.status}: ${text}`);
  const result = JSON.parse(text);
  return { url: result.url };
}
