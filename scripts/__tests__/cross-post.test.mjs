import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processArticle } from '../cross-post.mjs';

const SAMPLE_ARTICLE = {
  slug: 'sample',
  title: 'Sample',
  description: 'A sample',
  canonical_url: 'https://example.com/blog/sample/',
  body_markdown: 'body',
  tags: [],
};

function fakeChannel({ name, configured = true, findExisting, post }) {
  const calls = { findExisting: 0, post: 0 };
  return {
    calls,
    obj: {
      name,
      isConfigured: () => configured,
      missingConfig: () => ['SOME_VAR'],
      findExisting: async (a) => {
        calls.findExisting += 1;
        return findExisting ? findExisting(a) : null;
      },
      post: async (a) => {
        calls.post += 1;
        return post ? post(a) : { url: `https://${name}/post` };
      },
    },
  };
}

test('processArticle continues to next channel when findExisting throws', async () => {
  const a = fakeChannel({
    name: 'A',
    findExisting: () => {
      throw new Error('A boom');
    },
  });
  const b = fakeChannel({ name: 'B' });
  const c = fakeChannel({ name: 'C' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj, c.obj], false);

  assert.equal(result.anyFailed, true);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.post, 0);
  assert.equal(b.calls.findExisting, 1);
  assert.equal(b.calls.post, 1);
  assert.equal(c.calls.findExisting, 1);
  assert.equal(c.calls.post, 1);
});

test('processArticle continues to next channel when post throws', async () => {
  const a = fakeChannel({
    name: 'A',
    post: () => {
      throw new Error('A boom');
    },
  });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, true);
  assert.equal(a.calls.post, 1);
  assert.equal(b.calls.post, 1);
});

test('processArticle returns anyFailed=false when every channel succeeds', async () => {
  const a = fakeChannel({ name: 'A' });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.post, 1);
  assert.equal(b.calls.post, 1);
});

test('processArticle skips not-configured channels and does not mark failed', async () => {
  const a = fakeChannel({ name: 'A', configured: false });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 0);
  assert.equal(a.calls.post, 0);
  assert.equal(b.calls.post, 1);
});

test('processArticle does not call post when channel reports an existing post', async () => {
  const a = fakeChannel({
    name: 'A',
    findExisting: () => ({ url: 'https://x.com/p' }),
  });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.post, 0);
});

test('processArticle dry-run still calls findExisting but never post', async () => {
  const a = fakeChannel({ name: 'A' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj], true);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.post, 0);
});
