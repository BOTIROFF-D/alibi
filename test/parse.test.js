import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTests } from '../dist/parse.js';

test('finds nested javascript tests and their suite chain', () => {
  const source = `
describe('SessionStore', () => {
  describe('flush', () => {
    it('writes on close', () => {
      expect(store.closed).toBe(true);
    });
    it.skip('retries once', () => {});
  });
});
`;
  const tests = findTests('a.test.js', source, 'js');
  assert.equal(tests.length, 2);
  assert.deepEqual(tests[0].suite, ['SessionStore', 'flush']);
  assert.equal(tests[0].name, 'writes on close');
  assert.equal(tests[0].skipped, false);
  assert.equal(tests[1].skipped, true);
});

test('a describe block does not swallow the test after it', () => {
  const source = `
describe('one', () => {
  it('inside', () => {});
});

it('outside', () => {});
`;
  const tests = findTests('a.test.js', source, 'js');
  assert.deepEqual(
    tests.map((t) => [t.name, t.suite.join('/')]),
    [
      ['inside', 'one'],
      ['outside', ''],
    ],
  );
});

test('braces inside string literals do not end a test body', () => {
  const source = `
it('handles json', () => {
  const payload = '{"a": 1}';
  expect(parse(payload)).toEqual({ a: 1 });
});
it('second', () => { expect(1).toBe(1); });
`;
  const tests = findTests('a.test.js', source, 'js');
  assert.equal(tests.length, 2);
  assert.match(tests[0].body, /toEqual/);
});

test('finds python tests with their class', () => {
  const source = `
import pytest

class TestSessions:
    @pytest.mark.skip(reason="flaky")
    def test_dedupes(self):
        assert dedupe([1, 1]) == [1]

    def test_counts(self):
        assert count([]) == 0

def test_module_level():
    assert True
`;
  const tests = findTests('test_a.py', source, 'python');
  assert.deepEqual(
    tests.map((t) => t.name),
    ['test_dedupes', 'test_counts', 'test_module_level'],
  );
  assert.deepEqual(tests[0].suite, ['TestSessions']);
  assert.equal(tests[0].skipped, true);
  assert.deepEqual(tests[2].suite, []);
});

test('finds go tests and sees t.Skip', () => {
  const source = `
package store

func TestDedupe(t *testing.T) {
	if got := Dedupe(ids); got != 2 {
		t.Fatalf("got %d", got)
	}
}

func TestSkipped(t *testing.T) {
	t.Skip("needs a database")
}
`;
  const tests = findTests('store_test.go', source, 'go');
  assert.deepEqual(
    tests.map((t) => [t.name, t.skipped]),
    [
      ['TestDedupe', false],
      ['TestSkipped', true],
    ],
  );
});

test('finds rust tests behind attributes', () => {
  const source = `
#[cfg(test)]
mod tests {
    #[test]
    fn dedupes() {
        assert_eq!(dedupe(vec![1, 1]).len(), 1);
    }

    #[test]
    #[ignore]
    fn slow() {
        assert!(true);
    }
}
`;
  const tests = findTests('lib.rs', source, 'rust');
  assert.deepEqual(
    tests.map((t) => [t.name, t.skipped]),
    [
      ['dedupes', false],
      ['slow', true],
    ],
  );
});

test('reads the characterization marker', () => {
  const source = `
// alibi: characterization — locks in the current output
it('renders the old way', () => {
  expect(render()).toMatchSnapshot();
});
`;
  const [only] = findTests('a.test.js', source, 'js');
  assert.equal(only.exempt, true);
});

test('returns nothing for a language it cannot read', () => {
  assert.deepEqual(findTests('a.txt', 'anything', 'unknown'), []);
});
