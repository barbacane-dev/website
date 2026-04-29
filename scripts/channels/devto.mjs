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

// Returns { url } if a post with the same canonical_url already exists on
// the authenticated user's account, else null.
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
    if (match) return { url: match.url };
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
