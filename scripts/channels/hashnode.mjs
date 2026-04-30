// Hashnode channel.
// API: https://gql.hashnode.com (GraphQL)
// Auth: Authorization header with Personal Access Token.
//
// Configuration:
//   HASHNODE_TOKEN          - required (Settings → Developer)
//   HASHNODE_PUBLICATION_ID - optional; auto-discovered from `me.publications` if not set

const API = 'https://gql.hashnode.com';

export const name = 'Hashnode';

export function isConfigured() {
  return !!process.env.HASHNODE_TOKEN;
}

export function missingConfig() {
  return ['HASHNODE_TOKEN'];
}

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.HASHNODE_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Hashnode HTTP ${res.status}: ${text}`);
  const body = JSON.parse(text);
  if (body.errors) throw new Error(`Hashnode GraphQL: ${JSON.stringify(body.errors)}`);
  return body.data;
}

// Resolves the publication ID. Uses HASHNODE_PUBLICATION_ID if set, else
// queries `me.publications` and picks the first one. Caches in-process so
// multiple posts in the same run only resolve once.
let cachedPublicationId = null;
async function resolvePublicationId() {
  if (cachedPublicationId) return cachedPublicationId;
  if (process.env.HASHNODE_PUBLICATION_ID) {
    cachedPublicationId = process.env.HASHNODE_PUBLICATION_ID;
    return cachedPublicationId;
  }
  const data = await gql(`
    query Me {
      me {
        publications(first: 50) {
          edges { node { id title url } }
        }
      }
    }
  `);
  const edges = data?.me?.publications?.edges || [];
  if (edges.length === 0) {
    throw new Error('Hashnode: account has no publications. Create one or set HASHNODE_PUBLICATION_ID.');
  }
  if (edges.length > 1) {
    const list = edges.map((e) => `${e.node.id} (${e.node.title})`).join(', ');
    console.log(`  ! Hashnode: multiple publications found (${list}); using the first. Set HASHNODE_PUBLICATION_ID to pin.`);
  }
  cachedPublicationId = edges[0].node.id;
  return cachedPublicationId;
}

// Looks up an existing post by slug within the publication. Returns
// { url } if found, else null.
// Pages through the publication's posts and matches on `canonicalUrl`
// (Hashnode's read-side name for the input field `originalArticleURL`).
// Slug-based matching breaks when Hashnode appends `-1`, `-2`, etc. on
// publish (e.g. when the desired slug collides with a soft-deleted post),
// but the canonicalUrl always equals our `article.canonical_url`.
export async function findExisting(article) {
  const publicationId = await resolvePublicationId();
  let cursor = null;
  while (true) {
    const data = await gql(
      `
      query PubPosts($id: ObjectId!, $first: Int!, $after: String) {
        publication(id: $id) {
          posts(first: $first, after: $after) {
            edges { node { slug url canonicalUrl } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
      `,
      { id: publicationId, first: 50, after: cursor },
    );
    const conn = data?.publication?.posts;
    if (!conn) return null;
    const match = (conn.edges || []).find((e) => e.node.canonicalUrl === article.canonical_url);
    if (match) return { url: match.node.url };
    if (!conn.pageInfo?.hasNextPage) return null;
    cursor = conn.pageInfo.endCursor;
  }
}

// Hashnode tag input requires { slug, name }. Slugs are lowercase-hyphenated.
export function transformTags(tags) {
  return (tags || []).slice(0, 5).map((t) => {
    const slug = String(t).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const name = String(t)
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    return { slug, name };
  });
}

export async function post(article) {
  const publicationId = await resolvePublicationId();
  const data = await gql(
    `
    mutation Publish($input: PublishPostInput!) {
      publishPost(input: $input) {
        post { id url slug }
      }
    }
    `,
    {
      input: {
        publicationId,
        title: article.title,
        contentMarkdown: article.body_markdown,
        slug: article.slug,
        tags: transformTags(article.tags),
        originalArticleURL: article.canonical_url,
        metaTags: {
          description: article.description,
        },
      },
    },
  );
  const url = data?.publishPost?.post?.url;
  if (!url) throw new Error(`Hashnode: missing url in response: ${JSON.stringify(data)}`);
  return { url };
}
