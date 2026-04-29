import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformTags } from '../channels/hashnode.mjs';

test('transformTags produces { slug, name } objects', () => {
  assert.deepEqual(transformTags(['api-gateway']), [{ slug: 'api-gateway', name: 'Api Gateway' }]);
});

test('transformTags lowercases slug and capitalizes name parts', () => {
  assert.deepEqual(transformTags(['MCP-Gateway']), [{ slug: 'mcp-gateway', name: 'MCP Gateway' }]);
});

test('transformTags caps at 5 entries', () => {
  const out = transformTags(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(out.length, 5);
});

test('transformTags returns empty array for null/undefined', () => {
  assert.deepEqual(transformTags(undefined), []);
  assert.deepEqual(transformTags(null), []);
});

test('transformTags rewrites disallowed slug characters to hyphens', () => {
  assert.deepEqual(transformTags(['hello world']), [{ slug: 'hello-world', name: 'Hello world' }]);
});
