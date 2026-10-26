import test from "node:test";
import assert from "node:assert/strict";
import { encodeChannelListCursor, type Channel, type ChannelListQuery, type ChannelMembership } from "../domain/index.js";
import type { ChannelCreationRequestDocument, ChannelDocument, ChannelMembershipDocument, ChannelMessageDocument } from "../models/index.js";
import { createChannelRepository, type ChannelStorage } from "../repositories/index.js";

const channels = new Map<string, ChannelDocument>();
const memberships = new Map<string, ChannelMembershipDocument>();
const requests = new Map<string, ChannelCreationRequestDocument>();
const channelMessages: ChannelMessageDocument[] = [];
let failMembershipWrite = false;
let failCreationRequestWrite = false;

const storage: ChannelStorage = {
  initialize: () => Promise.resolve(),
  withTransaction: async (operation) => {
    const pendingChannels: ChannelDocument[] = [];
    const pendingMemberships: ChannelMembershipDocument[] = [];
    const pendingRequests: ChannelCreationRequestDocument[] = [];
    const pendingChannelMessages: ChannelMessageDocument[] = [];
    const pendingMembershipDeletes: string[] = [];
    const result = await operation({
      insertChannel: (document) => { pendingChannels.push(document); return Promise.resolve(); },
      insertMembership: (document) => {
        if (memberships.has(document._id) || pendingMemberships.some((existing) => existing._id === document._id)) {
          return Promise.reject(Object.assign(new Error("duplicate membership"), {
            kind: "channel-duplicate-key" as const,
            constraint: "other" as const
          }));
        }
        if (failMembershipWrite) return Promise.reject(new Error("membership write failed"));
        pendingMemberships.push(document);
        return Promise.resolve();
      },
      insertCreationRequest: (document) => {
        if (failCreationRequestWrite) return Promise.reject(new Error("idempotency record write failed"));
        pendingRequests.push(document);
        return Promise.resolve();
      },
      lockChannelForMembershipChange: (workspaceId, channelId) => {
        const existing = channels.get(channelId);
        if (!existing || existing.workspaceId !== workspaceId || existing.lifecycleState !== "active") return Promise.resolve(null);
        const updated = { ...existing, membershipRevision: (existing.membershipRevision ?? 0) + 1 };
        pendingChannels.push(updated);
        return Promise.resolve(updated);
      },
      findMembership: (channelId, userId) => Promise.resolve([...memberships.values()].find((item) =>
        item.channelId === channelId && item.userId === userId) ?? null),
      findChannel: (workspaceId, channelId) => Promise.resolve(channels.get(channelId)?.workspaceId === workspaceId
        ? channels.get(channelId) ?? null
        : null),
      updateChannelMetadata: (workspaceId, channelId, metadata) => {
        const existing = channels.get(channelId);
        if (!existing || existing.workspaceId !== workspaceId) return Promise.resolve(null);
        const updated = Object.freeze({ ...existing, ...metadata });
        pendingChannels.push(updated);
        return Promise.resolve(updated);
      },
      deleteMembership: (channelId, userId) => {
        pendingMembershipDeletes.push(`${channelId}:${userId}`);
        return Promise.resolve();
      },
      insertChannelMessage: (document) => { pendingChannelMessages.push(document); return Promise.resolve(); }
    });
    for (const document of pendingChannels) channels.set(document._id, document);
    for (const document of pendingMemberships) memberships.set(document._id, document);
    for (const document of pendingRequests) requests.set(document._id, document);
    channelMessages.push(...pendingChannelMessages);
    for (const membershipId of pendingMembershipDeletes) memberships.delete(membershipId);
    return result;
  },
  findByWorkspaceAndName: (workspaceId, name) => Promise.resolve([...channels.values()].find((channel) =>
    channel.workspaceId === workspaceId && channel.name === name && channel.lifecycleState === "active") ?? null),
  findById: (workspaceId, channelId) => {
    const channel = channels.get(channelId);
    return Promise.resolve(channel?.workspaceId === workspaceId ? channel : null);
  },
  findForMember: (workspaceId, userId) => Promise.resolve([...channels.values()].filter((candidate) =>
    candidate.workspaceId === workspaceId
    && candidate.lifecycleState === "active"
    && [...memberships.values()].some((membership) => membership.channelId === candidate._id && membership.userId === userId))),
  findChannels: (workspaceId, userId, query: ChannelListQuery) => Promise.resolve([...channels.values()].filter((candidate) =>
    candidate.workspaceId === workspaceId
    && candidate.lifecycleState === "active"
    && (query.scope === "joined"
      ? [...memberships.values()].some((membership) => membership.channelId === candidate._id && membership.userId === userId)
      : candidate.visibility === "public"
        && ![...memberships.values()].some((membership) => membership.channelId === candidate._id && membership.userId === userId))
    && (!query.cursor || candidate.name > query.cursor.name)
  ).sort((left, right) => left.name.localeCompare(right.name)).slice(0, query.pageSize + 1)),
  findMembership: (channelId, userId) => Promise.resolve([...memberships.values()].find((membership) =>
    membership.channelId === channelId && membership.userId === userId) ?? null),
  findMemberships: (channelId) => Promise.resolve([...memberships.values()].filter((membership) =>
    membership.channelId === channelId)),
  findCreationRequest: (workspaceId, actorId, key) => Promise.resolve([...requests.values()].find((request) =>
    request.workspaceId === workspaceId && request.actorId === actorId && request.key === key) ?? null)
};

const channel: Channel = Object.freeze({
  id: "channel-1",
  workspaceId: "workspace-1",
  name: "general",
  description: null,
  visibility: "public",
  lifecycleState: "active",
  createdBy: "user-1",
  createdAt: new Date("2026-10-12T00:00:00.000Z"),
  updatedAt: new Date("2026-10-12T00:00:00.000Z"),
  archivedAt: null
});
const creatorMembership: ChannelMembership = Object.freeze({
  channelId: channel.id,
  userId: "user-1",
  role: "admin",
  joinedAt: channel.createdAt
});

void test("persists channel and creator membership together and maps ids to public contracts", async () => {
  channels.clear();
  memberships.clear();
  requests.clear();
  failMembershipWrite = false;
  failCreationRequestWrite = false;
  const repository = createChannelRepository(storage);

  await repository.createAtomically(channel, creatorMembership);

  assert.deepEqual(await repository.findByWorkspaceAndName("workspace-1", "general"), channel);
  assert.deepEqual(await repository.findById("workspace-1", "channel-1"), channel);
  assert.deepEqual(await repository.findForMember("workspace-1", "user-1"), [channel]);
  assert.deepEqual(await repository.findForMember("workspace-1", "user-2"), []);
  assert.deepEqual(await repository.findChannels("workspace-1", "user-1", {
    scope: "joined",
    pageSize: 10,
    cursor: null
  }), { channels: [channel], nextCursor: null });
  assert.deepEqual(await repository.findMembership("channel-1", "user-1"), creatorMembership);
  const updatedAt = new Date("2026-10-13T00:00:00.000Z");
  const updateChannel = repository.updateChannel;
  assert.ok(updateChannel);
  assert.deepEqual(await updateChannel("workspace-1", channel.id, "user-1", {
    name: "general-updated",
    description: "Updated details",
    visibility: "private"
  }, updatedAt), {
    kind: "updated",
    channel: { ...channel, name: "general-updated", description: "Updated details", visibility: "private", updatedAt }
  });
  assert.deepEqual(await updateChannel("workspace-1", channel.id, "user-2", {
    name: "general",
    description: null,
    visibility: "public"
  }, updatedAt), { kind: "channel-unavailable" });
  assert.equal(await repository.findByWorkspaceAndName("workspace-2", "general"), null);
});

void test("encodes the last channel name only when a page has more results", async () => {
  channels.clear();
  memberships.clear();
  const first = { ...channel, name: "alpha" };
  const second = { ...channel, id: "channel-2", name: "beta" };
  const third = { ...channel, id: "channel-3", name: "gamma" };
  for (const item of [first, second, third]) {
    channels.set(item.id, { ...item, _id: item.id });
    memberships.set(`${item.id}:user-1`, {
      _id: `${item.id}:user-1`,
      channelId: item.id,
      userId: "user-1",
      role: "member",
      joinedAt: item.createdAt
    });
  }

  const repository = createChannelRepository(storage);
  const page = await repository.findChannels("workspace-1", "user-1", {
    scope: "joined",
    pageSize: 2,
    cursor: null
  });
  assert.deepEqual(page.channels.map((item) => item.name), ["alpha", "beta"]);
  assert.equal(page.nextCursor, encodeChannelListCursor({ scope: "joined", name: "beta" }));
});

void test("joins public channels once and leaves without deleting channel records", async () => {
  channels.clear();
  memberships.clear();
  const repository = createChannelRepository(storage);
  const privateChannel: Channel = { ...channel, id: "private-channel", name: "private", visibility: "private" };
  const publicDocument: ChannelDocument = { ...channel, _id: channel.id, membershipRevision: 0 };
  channels.set(channel.id, publicDocument);
  channels.set(privateChannel.id, { ...privateChannel, _id: privateChannel.id, membershipRevision: 0 });
  memberships.set(`${channel.id}:owner`, {
    _id: `${channel.id}:owner`,
    channelId: channel.id,
    userId: "owner",
    role: "admin",
    joinedAt: channel.createdAt
  });
  memberships.set(`${privateChannel.id}:owner`, {
    _id: `${privateChannel.id}:owner`,
    channelId: privateChannel.id,
    userId: "owner",
    role: "admin",
    joinedAt: channel.createdAt
  });

  const joinedAt = new Date("2026-10-13T00:00:00.000Z");
  const firstJoin = await repository.joinPublicChannel("workspace-1", channel.id, "member", joinedAt);
  const retry = await repository.joinPublicChannel("workspace-1", channel.id, "member", joinedAt);
  assert.equal(firstJoin.kind, "joined");
  assert.equal(retry.kind, "already-joined");
  assert.deepEqual(await repository.joinPublicChannel("workspace-1", privateChannel.id, "member", joinedAt), { kind: "not-public" });
  assert.deepEqual(await repository.joinPublicChannel("workspace-2", channel.id, "member", joinedAt), { kind: "channel-unavailable" });

  const invited = await repository.addMember("workspace-1", privateChannel.id, "owner", "invitee", joinedAt);
  assert.equal(invited.kind, "added");
  const duplicateInvite = await repository.addMember("workspace-1", privateChannel.id, "owner", "invitee", joinedAt);
  assert.equal(duplicateInvite.kind, "already-member");
  assert.deepEqual(await repository.addMember("workspace-1", privateChannel.id, "invitee", "other", joinedAt), { kind: "not-manager" });
  assert.deepEqual(await repository.addMember("workspace-1", channel.id, "owner", "other", joinedAt), { kind: "not-private" });
  const memberList = await repository.listMembers("workspace-1", privateChannel.id, "invitee");
  assert.equal(memberList.kind, "listed");
  assert.equal(memberList.canManage, false);
  assert.deepEqual(memberList.memberships.map((membership) => membership.userId), ["owner", "invitee"]);
  assert.deepEqual(await repository.removeMember("workspace-1", privateChannel.id, "owner", "owner"), { kind: "protected-admin" });
  assert.deepEqual(await repository.removeMember("workspace-1", privateChannel.id, "invitee", "owner"), { kind: "not-manager" });
  assert.deepEqual(await repository.removeMember("workspace-1", privateChannel.id, "owner", "invitee"), { kind: "removed" });
  assert.deepEqual(await repository.removeMember("workspace-1", privateChannel.id, "owner", "invitee"), { kind: "already-absent" });
  assert.deepEqual(await repository.removeMember("workspace-1", channel.id, "owner", "member"), { kind: "not-private" });

  const ownerDeparture = {
    id: "departure-owner",
    channelId: channel.id,
    type: "system" as const,
    systemEvent: "member_left" as const,
    actor: { id: "owner", name: "Owner" },
    text: "" as const,
    createdAt: new Date("2026-10-26T00:00:00.000Z")
  };
  const memberDeparture = { ...ownerDeparture, id: "departure-member", actor: { id: "member", name: "Member" } };
  assert.deepEqual(await repository.leaveChannel("workspace-1", channel.id, "owner", ownerDeparture), {
    kind: "left",
    entry: ownerDeparture
  });
  assert.deepEqual(await repository.leaveChannel("workspace-1", channel.id, "owner", ownerDeparture), { kind: "already-left" });
  assert.deepEqual(await repository.leaveChannel("workspace-1", channel.id, "member", memberDeparture), {
    kind: "left",
    entry: memberDeparture
  });
  assert.equal(channelMessages.length, 2);
  assert.equal(channelMessages[0]?.type, "system");
  assert.ok(await repository.findById("workspace-1", channel.id));
  assert.equal(await repository.findMembership(channel.id, "member"), null);
  assert.equal(await repository.findMembership(channel.id, "owner"), null);
});

void test("does not commit the channel when creator membership persistence fails", async () => {
  channels.clear();
  memberships.clear();
  failMembershipWrite = true;
  const repository = createChannelRepository(storage);

  await assert.rejects(repository.createAtomically(channel, creatorMembership), /membership write failed/);
  assert.equal(await repository.findById("workspace-1", "channel-1"), null);
  assert.equal(await repository.findMembership("channel-1", "user-1"), null);
  failMembershipWrite = false;
});

void test("rolls back channel and creator membership when idempotency persistence fails", async () => {
  channels.clear();
  memberships.clear();
  requests.clear();
  failMembershipWrite = false;
  failCreationRequestWrite = true;
  const repository = createChannelRepository(storage);
  const request: ChannelCreationRequestDocument = {
    _id: "request-1",
    workspaceId: channel.workspaceId,
    actorId: "user-1",
    key: "create-1",
    fingerprint: JSON.stringify([channel.name, null, channel.visibility]),
    channelId: channel.id,
    createdAt: channel.createdAt
  };

  await assert.rejects(
    repository.createAtomically(channel, creatorMembership, request),
    /idempotency record write failed/
  );
  assert.equal(await repository.findById(channel.workspaceId, channel.id), null);
  assert.equal(await repository.findMembership(channel.id, creatorMembership.userId), null);
  assert.equal(await repository.findCreationRequest(channel.workspaceId, "user-1", "create-1"), null);
  failCreationRequestWrite = false;
});
