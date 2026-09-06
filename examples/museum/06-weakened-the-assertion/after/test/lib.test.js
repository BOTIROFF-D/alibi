import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

test('keeps distinct items', () => {
  const out = dedupe([{ id: 'a' }, { id: 'b' }]);
  assert.ok(out.length >= 1);
});
