import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacyWorkspaceMembers } from "../scripts/legacy-workspace-migration.js";

void test("uses the first existing legacy allowlisted account as workspace admin without channel-role escalation", () => {
  const migration = resolveLegacyWorkspaceMembers(
    ["second@example.test", "first@example.test"],
    [
      { _id: "first", email: "first@example.test" },
      { _id: "second", email: "second@example.test" }
    ],
    ["channel-admin", "second", "channel-admin"]
  );

  assert.equal(migration.adminUserId, "second");
  assert.deepEqual(migration.memberships, [
    { userId: "second", role: "admin" },
    { userId: "first", role: "member" },
    { userId: "channel-admin", role: "member" }
  ]);
});

void test("chooses a deterministic channel member admin when no allowlisted account exists", () => {
  const migration = resolveLegacyWorkspaceMembers([], [], ["z-user", "a-user"]);

  assert.equal(migration.adminUserId, "a-user");
  assert.deepEqual(migration.memberships, [
    { userId: "a-user", role: "admin" },
    { userId: "z-user", role: "member" }
  ]);
});

void test("refuses a legacy migration with no existing account to authorize", () => {
  assert.throws(
    () => resolveLegacyWorkspaceMembers(["not-found@example.test"], [], []),
    /found no existing member accounts/
  );
});
