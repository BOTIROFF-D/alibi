import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

test('keeps distinct items', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'b' }]).length, 2);
});

test.skip('drops repeated ids', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'a' }]).length, 1);
});
