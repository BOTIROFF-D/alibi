# The assertion was softened until it agreed

The test still exists, still runs, still has its name. It used to
check the contents; now it checks the length. Nothing in a green suite reports
the difference.

What the report says: `assertion-weakened`.

`base/` is the repository before the change, `after/` is the working tree the
agent hands over. `test/museum.test.js` builds both and checks that the finding
is still produced.
