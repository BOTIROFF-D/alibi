# The test mocks the thing that changed

The subject is replaced by a stub that returns what the assertion
expects. The test is green for the same reason a photograph of a bridge holds
no weight.

What the report says: `subject-mocked`, and only that.

This exhibit is caught by reading, never by running, so the finding is
`unproven` rather than a lie — a mock of a neighbouring module with a similar
name would look identical from the outside. It is the clearest case of the
severity ladder in `DESIGN.md`: the tool says what it saw and leaves the
reading to a person.

`base/` is the repository before the change, `after/` is the working tree the
agent hands over. `test/museum.test.js` builds both and checks that the finding
is still produced.
