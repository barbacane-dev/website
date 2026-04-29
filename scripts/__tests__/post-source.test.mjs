import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { absolutizeLinks, loadArticle } from '../lib/post-source.mjs';

test('absolutizeLinks rewrites markdown link targets', () => {
  const out = absolutizeLinks('See [the docs](/docs/) for more.', 'https://example.com');
  assert.equal(out, 'See [the docs](https://example.com/docs/) for more.');
});

test('absolutizeLinks rewrites markdown image sources', () => {
  const out = absolutizeLinks('![diagram](/img/foo.png)', 'https://example.com');
  assert.equal(out, '![diagram](https://example.com/img/foo.png)');
});

test('absolutizeLinks rewrites HTML src and href attributes', () => {
  const input = '<img src="/a.png"><a href="/b/">link</a>';
  const out = absolutizeLinks(input, 'https://example.com');
  assert.equal(out, '<img src="https://example.com/a.png"><a href="https://example.com/b/">link</a>');
});

test('absolutizeLinks leaves absolute URLs untouched', () => {
  const input = '[external](https://other.com/x) and [absolute](http://other.com/y)';
  assert.equal(absolutizeLinks(input, 'https://example.com'), input);
});

test('absolutizeLinks leaves anchor and relative-without-slash links alone', () => {
  const input = '[anchor](#section) and [relative](other-post)';
  assert.equal(absolutizeLinks(input, 'https://example.com'), input);
});

test('loadArticle parses frontmatter and absolutizes links in body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cross-post-test-'));
  const filePath = join(dir, 'sample.md');
  writeFileSync(
    filePath,
    `---
title: "Sample title"
description: "A sample"
publishDate: 2026-01-01
tags: ["a", "b"]
draft: false
---

Body with [link](/docs/).
`,
  );

  try {
    const article = loadArticle(filePath);
    assert.equal(article.slug, 'sample');
    assert.equal(article.title, 'Sample title');
    assert.equal(article.description, 'A sample');
    assert.deepEqual(article.tags, ['a', 'b']);
    assert.equal(article.canonical_url, 'https://barbacane.dev/blog/sample/');
    assert.match(article.body_markdown, /\(https:\/\/barbacane\.dev\/docs\/\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadArticle defaults description to empty string when missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cross-post-test-'));
  const filePath = join(dir, 'no-desc.md');
  writeFileSync(filePath, `---\ntitle: "x"\n---\nBody.\n`);
  try {
    assert.equal(loadArticle(filePath).description, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadArticle handles missing tags as empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cross-post-test-'));
  const filePath = join(dir, 'no-tags.md');
  writeFileSync(filePath, `---\ntitle: "x"\n---\nBody.\n`);
  try {
    assert.deepEqual(loadArticle(filePath).tags, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
