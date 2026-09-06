# The failing test was deleted

Nothing was fixed. The test that disagreed is gone, and the suite
is green because there is less of it. This is the cheapest green in software
and the diff states it outright.

What the report says: `test-deleted`.

`base/` is the repository before the change, `after/` is the working tree the
agent hands over. `test/museum.test.js` builds both and checks that the finding
is still produced.
