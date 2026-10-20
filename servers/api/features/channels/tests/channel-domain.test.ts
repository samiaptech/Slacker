import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_NAME_UNIQUENESS_SCOPE,
  normalizeChannelName,
  prepareCreateChannelCommand,
  validateChannelName
} from "../domain/index.js";

void test("normalizes channel names and allows only lowercase ASCII letters, numbers, hyphens, and underscores", () => {
  assert.equal(normalizeChannelName("  Release_1-Team  "), "release_1-team");
  assert.deepEqual(validateChannelName("  Release_1-Team  "), { ok: true, name: "release_1-team" });
  assert.deepEqual(validateChannelName("release team"), { ok: false, error: "channel_name_invalid" });
  assert.deepEqual(validateChannelName("release.team"), { ok: false, error: "channel_name_invalid" });
});

void test("rejects empty and overlong channel names", () => {
  assert.deepEqual(validateChannelName("   "), { ok: false, error: "channel_name_required" });
  assert.deepEqual(validateChannelName("a".repeat(81)), { ok: false, error: "channel_name_too_long" });
  assert.deepEqual(validateChannelName("a".repeat(80)), { ok: true, name: "a".repeat(80) });
});

void test("limits name uniqueness to active channels inside a single workspace", () => {
  assert.equal(CHANNEL_NAME_UNIQUENESS_SCOPE, "active_channels_within_workspace");
});

void test("prepares a canonical create command with an explicit visibility", () => {
  assert.deepEqual(prepareCreateChannelCommand({
    workspaceId: "workspace-1",
    creatorId: "member-1",
    name: "  General  ",
    visibility: "public"
  }), {
    ok: true,
    command: {
      workspaceId: "workspace-1",
      creatorId: "member-1",
      name: "general",
      description: null,
      visibility: "public"
    }
  });
  assert.deepEqual(prepareCreateChannelCommand({
    workspaceId: "workspace-1",
    creatorId: "member-1",
    name: "general",
    visibility: "private-ish"
  }), { ok: false, error: "channel_visibility_invalid" });
});

void test("trims optional descriptions and enforces the persisted description limit", () => {
  const prepared = prepareCreateChannelCommand({
    workspaceId: "workspace-1",
    creatorId: "member-1",
    name: "general",
    description: "  Team updates  ",
    visibility: "private"
  });
  assert.equal(prepared.ok ? prepared.command.description : null, "Team updates");
  assert.deepEqual(prepareCreateChannelCommand({
    workspaceId: "workspace-1",
    creatorId: "member-1",
    name: "general",
    description: "x".repeat(501),
    visibility: "private"
  }), { ok: false, error: "channel_description_too_long" });
});
