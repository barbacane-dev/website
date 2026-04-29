#!/usr/bin/env node
// Cross-post a published blog post to one or more channels.
//
// Usage:
//   node scripts/cross-post.mjs                       # auto-detect from HEAD^..HEAD
//   node scripts/cross-post.mjs --slug=<slug>         # force a specific post
//   node scripts/cross-post.mjs --dry-run             # print payload, do not POST
//   node scripts/cross-post.mjs --channels=devto      # restrict to a subset
//
// Channels are auto-discovered from scripts/channels/. Each channel is
// active iff its env vars are set. The script always queries each channel
// for an existing post with the same canonical_url / slug before posting,
// so re-runs are idempotent.

import * as bluesky from './channels/bluesky.mjs';
import * as devto from './channels/devto.mjs';
import * as hashnode from './channels/hashnode.mjs';
import { detectNewlyPublished, loadArticle, resolvePosts } from './lib/post-source.mjs';

const ALL_CHANNELS = [devto, hashnode, bluesky];

function parseArgs(argv) {
  const out = { dryRun: false, slug: null, channels: null };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--slug=')) out.slug = a.slice(7);
    else if (a.startsWith('--channels=')) out.channels = a.slice(11).split(',').map((s) => s.trim());
  }
  return out;
}

function selectChannels(filter) {
  const wanted = filter ? new Set(filter) : null;
  return ALL_CHANNELS.filter((c) => {
    if (wanted && !wanted.has(c.name.toLowerCase().replace('.', ''))) return false;
    return true;
  });
}

async function processArticle(article, channels, dryRun) {
  console.log(`\n=== ${article.slug} ===`);
  console.log(`  title:     ${article.title}`);
  console.log(`  canonical: ${article.canonical_url}`);
  console.log(`  body:      ${article.body_markdown.length} chars`);

  for (const channel of channels) {
    const label = `[${channel.name}]`;
    if (!channel.isConfigured()) {
      console.log(`  ${label} skipped (missing: ${channel.missingConfig().join(', ')})`);
      continue;
    }

    let existing;
    try {
      existing = await channel.findExisting(article);
    } catch (e) {
      console.error(`  ${label} could not check for existing post: ${e.message}`);
      throw e;
    }
    if (existing) {
      console.log(`  ${label} already posted: ${existing.url} (skipping)`);
      continue;
    }

    if (dryRun) {
      console.log(`  ${label} [dry-run] would post`);
      continue;
    }

    try {
      const result = await channel.post(article);
      console.log(`  ${label} ✓ posted: ${result.url}`);
    } catch (e) {
      console.error(`  ${label} ✗ failed: ${e.message}`);
      throw e;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const channels = selectChannels(args.channels);

  if (channels.length === 0) {
    console.log('No channels selected.');
    return;
  }

  const files = args.slug
    ? resolvePosts({ slug: args.slug })
    : detectNewlyPublished();

  if (files.length === 0) {
    console.log('No newly-published posts to cross-post.');
    return;
  }

  console.log(`Cross-posting ${files.length} post(s) to ${channels.map((c) => c.name).join(', ')}`);

  let failed = false;
  for (const f of files) {
    try {
      await processArticle(loadArticle(f), channels, args.dryRun);
    } catch {
      failed = true;
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
