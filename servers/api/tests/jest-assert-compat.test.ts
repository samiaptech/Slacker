import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

void test("preserves strict deep equality across Jest VM realms", () => {
  const actual: unknown = runInNewContext('JSON.parse("{\\"members\\":[{\\"id\\":\\"member-1\\"}]}")');
  assert.deepEqual(actual, { members: [{ id: "member-1" }] });
  assert.throws(() => {
    assert.deepEqual({ value: undefined }, {});
  });
  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.throws(() => {
    assert.deepEqual(sparse, [undefined]);
  });
});
