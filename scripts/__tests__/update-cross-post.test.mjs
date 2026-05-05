import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processArticle } from '../update-cross-post.mjs';

const SAMPLE_ARTICLE = {
  slug: 'sample',
  title: 'Sample',
  description: 'A sample',
  canonical_url: 'https://example.com/blog/sample/',
  body_markdown: 'body',
  tags: [],
};

function fakeChannel({ name, configured = true, findExisting, update }) {
  const calls = { findExisting: 0, update: 0 };
  return {
    calls,
    obj: {
      name,
      isConfigured: () => configured,
      missingConfig: () => ['SOME_VAR'],
      findExisting: async (a) => {
        calls.findExisting += 1;
        return findExisting ? findExisting(a) : { id: 'id-1', url: `https://${name}/post` };
      },
      update: async (a, existing) => {
        calls.update += 1;
        return update ? update(a, existing) : { url: existing.url };
      },
    },
  };
}

test('processArticle calls update when an existing post is found', async () => {
  const a = fakeChannel({ name: 'A' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.update, 1);
});

test('processArticle skips update when no existing post is found and does not fail', async () => {
  const a = fakeChannel({ name: 'A', findExisting: () => null });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.update, 0);
});

test('processArticle passes the existing object (with id) to update', async () => {
  let receivedExisting = null;
  const a = fakeChannel({
    name: 'A',
    findExisting: () => ({ id: 'post-42', url: 'https://A/p/42' }),
    update: (_a, existing) => {
      receivedExisting = existing;
      return { url: existing.url };
    },
  });

  await processArticle(SAMPLE_ARTICLE, [a.obj], false);

  assert.deepEqual(receivedExisting, { id: 'post-42', url: 'https://A/p/42' });
});

test('processArticle continues to next channel when findExisting throws', async () => {
  const a = fakeChannel({
    name: 'A',
    findExisting: () => {
      throw new Error('A boom');
    },
  });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, true);
  assert.equal(a.calls.update, 0);
  assert.equal(b.calls.update, 1);
});

test('processArticle continues to next channel when update throws', async () => {
  const a = fakeChannel({
    name: 'A',
    update: () => {
      throw new Error('A boom');
    },
  });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, true);
  assert.equal(a.calls.update, 1);
  assert.equal(b.calls.update, 1);
});

test('processArticle skips not-configured channels and does not mark failed', async () => {
  const a = fakeChannel({ name: 'A', configured: false });
  const b = fakeChannel({ name: 'B' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj, b.obj], false);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 0);
  assert.equal(a.calls.update, 0);
  assert.equal(b.calls.update, 1);
});

test('processArticle dry-run still calls findExisting but never update', async () => {
  const a = fakeChannel({ name: 'A' });

  const result = await processArticle(SAMPLE_ARTICLE, [a.obj], true);

  assert.equal(result.anyFailed, false);
  assert.equal(a.calls.findExisting, 1);
  assert.equal(a.calls.update, 0);
});
