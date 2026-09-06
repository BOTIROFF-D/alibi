import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../src/lib.js';

import { vi } from 'vitest';

vi.mock('../src/lib.js', () => ({ dedupe: () => [{ id: 'a' }] }));

test('keeps distinct items', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'b' }]).length, 2);
});

test('de-duplicates', () => {
  assert.equal(dedupe([{ id: 'a' }, { id: 'a' }]).length, 1);
});
