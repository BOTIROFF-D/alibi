import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

test('keeps distinct items', () => {
  const out = dedupe([{ id: 'a' }, { id: 'b' }]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 'a');
  assert.equal(out[1].id, 'b');
});
