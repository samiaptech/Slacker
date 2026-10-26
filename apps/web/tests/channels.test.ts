import test from "node:test";
import assert from "node:assert/strict";
import {
  channelCreateResponseSchema,
  channelJoinResponseSchema,
  channelListResponseSchema,
  channelMemberMutationResponseSchema,
  channelMembersResponseSchema,
  channelMessageListResponseSchema,
  channelResponseSchema,
  validateCreateChannelForm
} from "../features/channels";

const channel = {
  id: "channel-1",
  workspaceId: "workspace-1",
  name: "general",
  description: "Team updates",
  visibility: "public",
  lifecycleState: "active",
  createdBy: "user-1",
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
  archivedAt: null
} as const;

void test("validates channel creation response and channel details from the API", () => {
  const created = channelCreateResponseSchema.parse({
    channel,
    creatorMembership: {
      channelId: "channel-1",
      userId: "user-1",
      role: "admin",
      joinedAt: "2026-10-13T00:00:00.000Z"
    }
  });
  assert.equal(created.channel.name, "general");
  assert.equal(channelResponseSchema.parse(channel).description, "Team updates");
  assert.deepEqual(channelListResponseSchema.parse({ channels: [channel], nextCursor: null }).channels.map((item) => item.id), ["channel-1"]);
  assert.equal(channelListResponseSchema.safeParse({ channels: [{ ...channel, visibility: "unknown" }], nextCursor: null }).success, false);
  assert.equal(channelResponseSchema.safeParse({ ...channel, visibility: "secret" }).success, false);
});

void test("validates the membership envelope returned when joining a channel", () => {
  const membership = {
    channelId: "channel-1",
    userId: "user-2",
    role: "member",
    joinedAt: "2026-10-13T00:00:00.000Z"
  } as const;
  assert.deepEqual(channelJoinResponseSchema.parse({ membership }), { membership });
  assert.equal(channelJoinResponseSchema.safeParse(membership).success, false);
});

void test("validates channel member lists and member invitation results", () => {
  const member = {
    channelId: "channel-1",
    userId: "user-2",
    role: "member",
    joinedAt: "2026-10-13T00:00:00.000Z",
    name: "Workspace Member",
    email: "member@example.test",
    image: null
  } as const;

  assert.deepEqual(channelMembersResponseSchema.parse({ members: [member], canManage: true }), {
    members: [member],
    canManage: true
  });
  assert.equal(channelMembersResponseSchema.safeParse({
    members: [{ ...member, role: "owner" }],
    canManage: true
  }).success, false);
  assert.deepEqual(channelMemberMutationResponseSchema.parse({
    membership: {
      channelId: "channel-1",
      userId: "user-2",
      role: "member",
      joinedAt: "2026-10-13T00:00:00.000Z"
    },
    alreadyMember: false
  }).membership.userId, "user-2");
});

void test("validates channel message pages and rejects email fields from sender data", () => {
  const message = {
    id: "message-1",
    channelId: "channel-1",
    senderId: "user-1",
    text: "Hello 🙂",
    createdAt: "2026-10-15T12:00:00.000Z",
    sender: { id: "user-1", name: "Workspace Member", image: null }
  } as const;
  assert.deepEqual(channelMessageListResponseSchema.parse({
    messages: [message],
    nextCursor: "opaque-cursor"
  }).messages[0], { ...message, type: "message", attachments: [] });
  assert.equal(channelMessageListResponseSchema.safeParse({
    messages: [{ ...message, sender: { ...message.sender, email: "private@example.test" } }],
    nextCursor: null
  }).success, false);
  assert.equal(channelMessageListResponseSchema.safeParse({
    messages: [{ ...message, text: "x".repeat(4_001) }],
    nextCursor: null
  }).success, false);
});

void test("validates channel form fields with the server's name and description limits", () => {
  assert.deepEqual(validateCreateChannelForm({ name: "  Team_1 ", description: " Updates ", visibility: "public" }), {});
  assert.deepEqual(validateCreateChannelForm({ name: "", description: "", visibility: "private" }), {
    name: "Enter a channel name."
  });
  assert.deepEqual(validateCreateChannelForm({ name: "bad name", description: "x".repeat(501), visibility: "public" }), {
    name: "Use letters, numbers, hyphens, or underscores only.",
    description: "Use no more than 500 characters."
  });
});
