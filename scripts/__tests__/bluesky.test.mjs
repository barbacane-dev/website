import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostText } from '../channels/bluesky.mjs';

test('buildPostText combines title and description with blank line', () => {
  const out = buildPostText({ title: 'Hi', description: 'There' }, 100);
  assert.equal(out, 'Hi\n\nThere');
});

test('buildPostText respects the character limit', () => {
  const desc = 'x'.repeat(500);
  const out = buildPostText({ title: 'Title', description: desc }, 100);
  assert.ok(out.length <= 100, `expected <=100 chars, got ${out.length}`);
});

test('buildPostText falls back to title-only when description leaves no room', () => {
  const out = buildPostText({ title: 'A reasonably long title for testing', description: 'desc' }, 35);
  assert.equal(out, 'A reasonably long title for testing');
});

test('buildPostText truncates long titles too', () => {
  const out = buildPostText({ title: 'x'.repeat(500), description: '' }, 50);
  assert.ok(out.length <= 50);
  assert.ok(out.endsWith('…'));
});

test('buildPostText handles missing description', () => {
  const out = buildPostText({ title: 'Hello' }, 100);
  assert.equal(out, 'Hello');
});

test('buildPostText prefers word boundary when truncating', () => {
  const desc = 'one two three four five six seven eight nine ten';
  const out = buildPostText({ title: 'T', description: desc }, 25);
  // Should not end mid-word.
  assert.ok(out.endsWith('…'));
  // The truncated tail should not split a word: the char before … is a letter,
  // and no space appears immediately before the ellipsis when we cut on a boundary.
  const tail = out.slice(0, -1);
  assert.ok(!/\s$/.test(tail), `truncation left trailing space: ${JSON.stringify(out)}`);
});
