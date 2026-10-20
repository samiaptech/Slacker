import test from "node:test";
import assert from "node:assert/strict";
import { workspaceAccessSchema, workspaceMemberRoleSchema } from "../features/identity";

void test("parses the API workspace access contract", () => {
  const result = workspaceAccessSchema.parse({
    workspace: { id: "squid", name: "Squid" },
    user: { id: "google-subject-1", name: "Workspace Member", title: null, email: "member@example.test", image: null }
  });
  assert.equal(result.workspace.id, "squid");
  assert.equal(result.user.email, "member@example.test");
});

void test("rejects malformed workspace access responses", () => {
  assert.throws(() => workspaceAccessSchema.parse({ workspace: { id: "squid" }, user: {} }));
});

void test("parses workspace member role mutation responses", () => {
  assert.deepEqual(workspaceMemberRoleSchema.parse({ userId: "member-1", role: "admin" }), {
    userId: "member-1",
    role: "admin"
  });
  assert.equal(workspaceMemberRoleSchema.safeParse({ userId: "member-1", role: "owner" }).success, false);
});
