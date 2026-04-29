import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformTags } from '../channels/devto.mjs';

test('transformTags strips hyphens and lowercases', () => {
  assert.deepEqual(transformTags(['API-Gateway', 'MCP-Gateway']), ['apigateway', 'mcpgateway']);
});

test('transformTags caps at 4 entries', () => {
  assert.deepEqual(transformTags(['a', 'b', 'c', 'd', 'e']), ['a', 'b', 'c', 'd']);
});

test('transformTags drops entries that contain non-alphanumeric chars after normalization', () => {
  // Underscores and dots are not stripped, so they fail the alphanumeric filter.
  assert.deepEqual(transformTags(['valid', 'has_underscore', 'has.dot', 'fine']), ['valid', 'fine']);
});

test('transformTags returns empty array for null/undefined input', () => {
  assert.deepEqual(transformTags(undefined), []);
  assert.deepEqual(transformTags(null), []);
  assert.deepEqual(transformTags([]), []);
});

test('transformTags coerces non-string entries to string', () => {
  assert.deepEqual(transformTags([42, 'rust']), ['42', 'rust']);
});
