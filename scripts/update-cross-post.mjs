#!/usr/bin/env node
// Re-publish the current source markdown to existing cross-posts.
// Use this when an already-cross-posted article gets a substantive edit
// that needs to propagate to dev.to. The companion cross-post script is
// intentionally skip-if-exists, so edits do not flow through it.
//
// Usage:
//   node scripts/update-cross-post.mjs --slug=foo
//   node scripts/update-cross-post.mjs --slug=foo --slug=bar
//   node scripts/update-cross-post.mjs --slug=foo --dry-run
//   node scripts/update-cross-post.mjs --slug=foo --channels=devto
//
// Channels are auto-discovered. Only channels that export an `update`
// function are eligible (Bluesky is excluded - editing a feed item in
// place is rude / unsupported).

import * as devto from './channels/devto.mjs';
import { loadArticle, resolvePosts } from './lib/post-source.mjs';

const ALL_CHANNELS = [devto];

function parseArgs(argv) {
  const out = { slugs: [], dryRun: false, channels: null };
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--slug=')) out.slugs.push(a.slice(7));
    else if (a.startsWith('--channels=')) out.channels = a.slice(11).split(',').map((s) => s.trim());
  }
  return out;
}

function selectChannels(filter) {
  const wanted = filter ? new Set(filter) : null;
  return ALL_CHANNELS.filter((c) => {
    if (typeof c.update !== 'function') return false;
    if (wanted && !wanted.has(c.name.toLowerCase().replace('.', ''))) return false;
    return true;
  });
}

export async function processArticle(article, channels, dryRun) {
  console.log(`\n=== ${article.slug} ===`);
  console.log(`  canonical: ${article.canonical_url}`);
  console.log(`  body:      ${article.body_markdown.length} chars`);

  let anyFailed = false;
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
      console.error(`  ${label} could not look up existing post: ${e.message}`);
      anyFailed = true;
      continue;
    }
    if (!existing) {
      console.log(`  ${label} no existing post (skipping; run cross-post first)`);
      continue;
    }
    console.log(`  ${label} found: ${existing.url}`);

    if (dryRun) {
      console.log(`  ${label} [dry-run] would update`);
      continue;
    }

    try {
      const result = await channel.update(article, existing);
      console.log(`  ${label} ✓ updated: ${result.url}`);
    } catch (e) {
      console.error(`  ${label} ✗ failed: ${e.message}`);
      anyFailed = true;
    }
  }
  return { anyFailed };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.slugs.length === 0) {
    console.error('Usage: node scripts/update-cross-post.mjs --slug=<slug> [--slug=<slug>...] [--channels=devto] [--dry-run]');
    process.exit(1);
  }

  const channels = selectChannels(args.channels);
  if (channels.length === 0) {
    console.log('No updatable channels selected.');
    return;
  }

  console.log(`Updating on ${channels.map((c) => c.name).join(', ')}`);

  let failed = false;
  for (const slug of args.slugs) {
    const files = resolvePosts({ slug });
    const { anyFailed } = await processArticle(loadArticle(files[0]), channels, args.dryRun);
    if (anyFailed) failed = true;
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
