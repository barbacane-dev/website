#!/usr/bin/env node
// Re-publish the current source markdown to existing Hashnode posts.
// Use this when the source article has been edited after cross-posting.
//
// Usage:
//   node scripts/update-hashnode.mjs --slug=foo
//   node scripts/update-hashnode.mjs --slug=foo --slug=bar
//   node scripts/update-hashnode.mjs --slug=foo --dry-run

import { loadArticle, resolvePosts } from './lib/post-source.mjs';

const API = 'https://gql.hashnode.com';

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

async function resolvePublicationId() {
  if (process.env.HASHNODE_PUBLICATION_ID) return process.env.HASHNODE_PUBLICATION_ID;
  const data = await gql(`
    query Me { me { publications(first: 50) { edges { node { id } } } } }
  `);
  const edges = data?.me?.publications?.edges || [];
  if (edges.length === 0) throw new Error('No Hashnode publications found');
  return edges[0].node.id;
}

async function findPost(publicationId, canonicalUrl) {
  let cursor = null;
  while (true) {
    const data = await gql(
      `
      query PubPosts($id: ObjectId!, $first: Int!, $after: String) {
        publication(id: $id) {
          posts(first: $first, after: $after) {
            edges { node { id url canonicalUrl } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `,
      { id: publicationId, first: 50, after: cursor },
    );
    const conn = data?.publication?.posts;
    if (!conn) return null;
    const match = (conn.edges || []).find((e) => e.node.canonicalUrl === canonicalUrl);
    if (match) return { id: match.node.id, url: match.node.url };
    if (!conn.pageInfo?.hasNextPage) return null;
    cursor = conn.pageInfo.endCursor;
  }
}

async function updatePost(id, article) {
  const data = await gql(
    `
    mutation Update($input: UpdatePostInput!) {
      updatePost(input: $input) { post { id url } }
    }
    `,
    {
      input: {
        id,
        contentMarkdown: article.body_markdown,
      },
    },
  );
  const post = data?.updatePost?.post;
  if (!post?.url) throw new Error(`updatePost returned no post: ${JSON.stringify(data)}`);
  return post;
}

function parseArgs(argv) {
  const out = { slugs: [], dryRun: false };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--slug=')) out.slugs.push(a.slice(7));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    console.error('Usage: node scripts/update-hashnode.mjs --slug=<slug> [--slug=<slug>...] [--dry-run]');
    process.exit(1);
  }
  if (!process.env.HASHNODE_TOKEN) {
    console.error('HASHNODE_TOKEN not set');
    process.exit(1);
  }

  const pubId = await resolvePublicationId();
  let failed = false;

  for (const slug of args.slugs) {
    console.log(`\n=== ${slug} ===`);
    const files = resolvePosts({ slug });
    const article = loadArticle(files[0]);
    console.log(`  canonical: ${article.canonical_url}`);
    console.log(`  body:      ${article.body_markdown.length} chars`);

    const existing = await findPost(pubId, article.canonical_url);
    if (!existing) {
      console.error(`  no existing Hashnode post matching canonicalUrl`);
      failed = true;
      continue;
    }
    console.log(`  found:     ${existing.url}`);

    if (args.dryRun) {
      console.log(`  [dry-run] would update`);
      continue;
    }

    try {
      const updated = await updatePost(existing.id, article);
      console.log(`  ✓ updated: ${updated.url}`);
    } catch (e) {
      console.error(`  ✗ failed: ${e.message}`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
