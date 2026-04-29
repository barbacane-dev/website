// Bluesky channel.
// API: ATProto on https://bsky.social
// Auth: app password (Settings → Privacy and security → App passwords).
//
// Configuration:
//   BSKY_HANDLE       - your handle (e.g. yourname.bsky.social)
//   BSKY_APP_PASSWORD - app password (xxxx-xxxx-xxxx-xxxx)

const HOST = 'https://bsky.social';
const POST_TEXT_LIMIT = 290;

export const name = 'Bluesky';

export function isConfigured() {
  return !!process.env.BSKY_HANDLE && !!process.env.BSKY_APP_PASSWORD;
}

export function missingConfig() {
  const missing = [];
  if (!process.env.BSKY_HANDLE) missing.push('BSKY_HANDLE');
  if (!process.env.BSKY_APP_PASSWORD) missing.push('BSKY_APP_PASSWORD');
  return missing;
}

let cachedSession = null;
async function getSession() {
  if (cachedSession) return cachedSession;
  const res = await fetch(`${HOST}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: process.env.BSKY_HANDLE,
      password: process.env.BSKY_APP_PASSWORD,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bluesky auth ${res.status}: ${text}`);
  cachedSession = JSON.parse(text);
  return cachedSession;
}

// Builds the post text. Bluesky caps at 300 graphemes; we use 290 as a
// safety margin. The link itself goes in the embed card, not the text.
export function buildPostText(article, limit = POST_TEXT_LIMIT) {
  const title = article.title || '';
  const description = article.description || '';
  if (!description) return truncate(title, limit);

  const separator = '\n\n';
  const room = limit - title.length - separator.length;
  if (room < 15) return truncate(title, limit);

  return `${title}${separator}${truncate(description, room)}`;
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max - 30 ? cut.slice(0, lastSpace) : cut) + '…';
}

// Looks at the last 100 posts on the authenticated user's feed and
// returns { url } if any of them link to the same canonical URL via an
// external embed.
export async function findExisting(article) {
  const session = await getSession();
  const url = `${HOST}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(session.did)}&limit=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bluesky feed ${res.status}: ${text}`);
  const data = JSON.parse(text);
  const match = (data.feed || []).find(
    (item) => item?.post?.record?.embed?.external?.uri === article.canonical_url,
  );
  if (!match) return null;
  // Convert at://did:plc:.../app.bsky.feed.post/<rkey> to web URL.
  const rkey = match.post.uri.split('/').pop();
  return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
}

export async function post(article) {
  const session = await getSession();
  const record = {
    $type: 'app.bsky.feed.post',
    text: buildPostText(article),
    createdAt: new Date().toISOString(),
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: article.canonical_url,
        title: article.title,
        description: article.description || '',
      },
    },
  };
  const res = await fetch(`${HOST}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Bluesky create ${res.status}: ${text}`);
  const data = JSON.parse(text);
  const rkey = data.uri.split('/').pop();
  return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
}
