// Shared utilities for loading and detecting blog posts.
// Channel-agnostic: returns a normalized Article shape that each
// channel module then converts into its own API payload.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

export const POSTS_DIR = 'src/content/blog';
export const SITE_URL = 'https://barbacane.dev';

// Rewrites site-relative markdown links and HTML src/href attributes to
// absolute URLs so they don't break when the post is rendered off-site.
export function absolutizeLinks(body, siteUrl = SITE_URL) {
  return body
    .replace(/\]\((\/[^)]+)\)/g, `](${siteUrl}$1)`)
    .replace(/(src|href)="(\/[^"]+)"/g, `$1="${siteUrl}$2"`);
}

// Loads a post file and returns the channel-agnostic article shape.
export function loadArticle(filePath) {
  const slug = filePath.replace(/^.*\//, '').replace(/\.md$/, '');
  const { data, content } = matter(readFileSync(filePath, 'utf8'));
  return {
    slug,
    title: data.title,
    description: data.description || '',
    body_markdown: absolutizeLinks(content),
    tags: data.tags || [],
    canonical_url: `${SITE_URL}/blog/${slug}/`,
    publish_date: data.publishDate,
  };
}

// Returns paths under POSTS_DIR whose `draft` frontmatter transitioned
// from true to false between HEAD^ and HEAD (or that were newly added
// with `draft: false`). Used by the GitHub Action when triggered by a
// push to main.
export function detectNewlyPublished() {
  let changed;
  try {
    changed = execSync(`git diff --name-only HEAD^ HEAD -- '${POSTS_DIR}/*.md'`, {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }

  const published = [];
  for (const f of changed) {
    if (!existsSync(f)) continue;
    const current = matter(readFileSync(f, 'utf8'));
    if (current.data.draft !== false) continue;

    let prevDraft = true;
    try {
      const prevContent = execSync(`git show HEAD^:${f}`, { encoding: 'utf8' });
      prevDraft = matter(prevContent).data.draft !== false;
    } catch {
      prevDraft = true;
    }

    if (prevDraft) published.push(f);
  }
  return published;
}

// Resolves a slug or a list of file paths into existing post file paths.
export function resolvePosts({ slug, files }) {
  if (slug) {
    const path = join(POSTS_DIR, `${slug}.md`);
    if (!existsSync(path)) throw new Error(`Not found: ${path}`);
    return [path];
  }
  return files || [];
}
