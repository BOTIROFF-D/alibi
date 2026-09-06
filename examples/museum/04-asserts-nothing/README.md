# The test asserts nothing at all

It calls the function, names a variable after the result, and ends.
It can only fail by throwing. Coverage counts the lines; nothing checks them.

What the report says: `no-assertion`.

`base/` is the repository before the change, `after/` is the working tree the
agent hands over. `test/museum.test.js` builds both and checks that the finding
is still produced.
