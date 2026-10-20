import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import { decodeChannelListCursor, type Channel, type ChannelListQuery } from "../domain/index.js";
import type { ChannelRepository, ChannelCreationRequest } from "../repositories/index.js";
import { createChannelService } from "../services/index.js";

const createHarness = (workspaceMembershipUnavailable = false) => {
  const channels = new Map<string, Channel>();
  const memberships = new Map<string, Parameters<ChannelRepository["createAtomically"]>[1]>();
  const requests = new Map<string, ChannelCreationRequest>();
  let nextId = 0;
  const auditEvents: Readonly<Record<string, unknown>>[] = [];
  const logger: Logger = {
    info: (_message, context) => { if (context) auditEvents.push(context); },
    warn: () => undefined,
    error: () => undefined
  };
  const repository: ChannelRepository = {
    initialize: () => Promise.resolve(),
    createAtomically: (channel, membership, request) => {
      if ([...channels.values()].some((existing) => existing.workspaceId === channel.workspaceId && existing.name === channel.name && existing.lifecycleState === "active")) {
        return Promise.reject(Object.assign(new Error("duplicate channel name"), { kind: "channel-duplicate-key" as const, constraint: "active-name" as const }));
      }
      if (request && [...requests.values()].some((existing) => existing.workspaceId === request.workspaceId && existing.actorId === request.actorId && existing.key === request.key)) {
        return Promise.reject(Object.assign(new Error("duplicate idempotency key"), { kind: "channel-duplicate-key" as const, constraint: "idempotency-key" as const }));
      }
      channels.set(channel.id, channel);
      memberships.set(`${membership.channelId}:${membership.userId}`, membership);
      if (request) requests.set(request._id, request);
      return Promise.resolve();
    },
    findByWorkspaceAndName: (workspaceId, name) => Promise.resolve([...channels.values()].find((channel) => channel.workspaceId === workspaceId && channel.name === name && channel.lifecycleState === "active") ?? null),
    findById: (workspaceId, channelId) => {
      const channel = channels.get(channelId);
      return Promise.resolve(channel?.workspaceId === workspaceId ? channel : null);
    },
    findForMember: (workspaceId, userId) => Promise.resolve([...channels.values()].filter((channel) =>
      channel.workspaceId === workspaceId
      && channel.lifecycleState === "active"
      && memberships.has(`${channel.id}:${userId}`))),
    findChannels: (workspaceId, userId, query: ChannelListQuery) => {
      const matching = [...channels.values()].filter((channel) =>
        channel.workspaceId === workspaceId
        && channel.lifecycleState === "active"
        && (query.scope === "joined"
          ? memberships.has(`${channel.id}:${userId}`)
          : channel.visibility === "public" && !memberships.has(`${channel.id}:${userId}`))
        && (!query.cursor || channel.name > query.cursor.name)
      ).sort((left, right) => left.name.localeCompare(right.name));
      const page = matching.slice(0, query.pageSize + 1);
      const hasMore = page.length > query.pageSize;
      const channelsInPage = page.slice(0, query.pageSize);
      const last = channelsInPage.at(-1);
      return Promise.resolve({
        channels: channelsInPage,
        nextCursor: hasMore && last
          ? Buffer.from(JSON.stringify({ scope: query.scope, name: last.name }), "utf8").toString("base64url")
          : null
      });
    },
    findMembership: (channelId, userId) => Promise.resolve(memberships.get(`${channelId}:${userId}`) ?? null),
    listMembers: (workspaceId, channelId, userId) => {
      const channel = channels.get(channelId);
      const viewer = memberships.get(`${channelId}:${userId}`);
      if (!channel || channel.workspaceId !== workspaceId || !viewer) return Promise.resolve({ kind: "channel-unavailable" as const });
      return Promise.resolve({
        kind: "listed" as const,
        canManage: viewer.role === "admin",
        memberships: [...memberships.values()].filter((item) => item.channelId === channelId)
      });
    },
    addMember: (workspaceId, channelId, actorId, targetId, joinedAt) => {
      const channel = channels.get(channelId);
      const actor = memberships.get(`${channelId}:${actorId}`);
      if (!channel || channel.workspaceId !== workspaceId || !actor) return Promise.resolve({ kind: "channel-unavailable" as const });
      if (actor.role !== "admin") return Promise.resolve({ kind: "not-manager" as const });
      const existing = memberships.get(`${channelId}:${targetId}`);
      if (existing) return Promise.resolve({ kind: "already-member" as const, membership: existing });
      const membership = Object.freeze({ channelId, userId: targetId, role: "member" as const, joinedAt });
      memberships.set(`${channelId}:${targetId}`, membership);
      return Promise.resolve({ kind: "added" as const, membership });
    },
    removeMember: (workspaceId, channelId, actorId, targetId) => {
      const channel = channels.get(channelId);
      const actor = memberships.get(`${channelId}:${actorId}`);
      if (!channel || channel.workspaceId !== workspaceId || !actor) return Promise.resolve({ kind: "channel-unavailable" as const });
      if (actor.role !== "admin") return Promise.resolve({ kind: "not-manager" as const });
      const target = memberships.get(`${channelId}:${targetId}`);
      if (!target) return Promise.resolve({ kind: "already-absent" as const });
      if (target.role === "admin") return Promise.resolve({ kind: "protected-admin" as const });
      memberships.delete(`${channelId}:${targetId}`);
      return Promise.resolve({ kind: "removed" as const });
    },
    joinPublicChannel: (workspaceId, channelId, userId, joinedAt) => {
      const channel = channels.get(channelId);
      if (!channel || channel.workspaceId !== workspaceId || channel.lifecycleState !== "active") {
        return Promise.resolve({ kind: "channel-unavailable" as const });
      }
      if (channel.visibility !== "public") return Promise.resolve({ kind: "not-public" as const });
      const existing = memberships.get(`${channelId}:${userId}`);
      if (existing) return Promise.resolve({ kind: "already-joined" as const, membership: existing });
      const membership = Object.freeze({ channelId, userId, role: "member" as const, joinedAt });
      memberships.set(`${channelId}:${userId}`, membership);
      return Promise.resolve({ kind: "joined" as const, membership });
    },
    leaveChannel: (workspaceId, channelId, userId) => {
      const channel = channels.get(channelId);
      if (!channel || channel.workspaceId !== workspaceId || channel.lifecycleState !== "active") {
        return Promise.resolve({ kind: "channel-unavailable" as const });
      }
      const membership = memberships.get(`${channelId}:${userId}`);
      if (!membership) return Promise.resolve({ kind: "already-left" as const });
      memberships.delete(`${channelId}:${userId}`);
      return Promise.resolve({ kind: "left" as const });
    },
    findCreationRequest: (workspaceId, actorId, key) => Promise.resolve([...requests.values()].find((request) => request.workspaceId === workspaceId && request.actorId === actorId && request.key === key) ?? null)
  };
  const directoryMember = {
    id: "invitee",
    name: "Invited Member",
    email: "invitee@example.test",
    image: null
  };
  const service = createChannelService({
    repository,
    logger,
    createId: () => `generated-${String(++nextId)}`,
    now: () => new Date("2026-10-12T00:00:00.000Z"),
    findWorkspaceMemberByEmail: (_workspaceId, email) => Promise.resolve(
      workspaceMembershipUnavailable
        ? { kind: "unavailable" as const }
        : email === directoryMember.email
          ? { kind: "found" as const, member: directoryMember }
          : { kind: "not-found" as const }
    ),
    findWorkspaceMembersByIds: (userIds) => Promise.resolve(userIds.flatMap((id) =>
      id === directoryMember.id ? [directoryMember] : []))
  });
  return { service, channels, requests, auditEvents };
};

void test("creates the creator admin membership and replays an idempotent request", async () => {
  const { service, channels, auditEvents } = createHarness();
  const input = { workspaceId: "workspace-1", creatorId: "user-1", name: " General ", visibility: "public", idempotencyKey: "retry-1" };
  const created = await service.create(input);
  const replayed = await service.create(input);

  assert.equal(created.kind, "created");
  assert.equal(replayed.kind, "created");
  assert.ok("result" in created && "result" in replayed);
  if (!("result" in created) || !("result" in replayed)) throw new Error("Expected both requests to create or replay.");
  assert.equal(created.replayed, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.result.channel.id, created.result.channel.id);
  assert.equal(replayed.result.creatorMembership.role, "admin");
  assert.equal(channels.size, 1);
  assert.deepEqual(auditEvents, [{
    event: "channel.created",
    outcome: "created",
    actorId: "user-1",
    targetId: "user-1",
    workspaceId: "workspace-1",
    channelId: created.result.channel.id,
    occurredAt: created.result.channel.createdAt.toISOString()
  }]);
});

void test("rejects key reuse with different input and conflicts on duplicate active names", async () => {
  const { service, channels } = createHarness();
  await service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: "general", visibility: "public", idempotencyKey: "same-key" });
  assert.deepEqual(await service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: "random", visibility: "public", idempotencyKey: "same-key" }), {
    kind: "conflict", error: "idempotency_key_reused"
  });

  assert.deepEqual(await service.create({ workspaceId: "workspace-1", creatorId: "user-2", name: "general", visibility: "private" }), {
    kind: "conflict", error: "channel_name_conflict"
  });
  assert.equal(channels.size, 1);
});

void test("resolves concurrent normalized-name creation attempts to one channel and one conflict", async () => {
  const { service, channels } = createHarness();
  const results = await Promise.all([
    service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: " General ", visibility: "public" }),
    service.create({ workspaceId: "workspace-1", creatorId: "user-2", name: "general", visibility: "private" })
  ]);

  assert.deepEqual(results.map((result) => result.kind).sort(), ["conflict", "created"]);
  assert.equal(results.filter((result) => result.kind === "created").length, 1);
  assert.deepEqual([...channels.values()].map((channel) => channel.name), ["general"]);
});

void test("replays concurrent creates carrying the same idempotency key", async () => {
  const { service, channels } = createHarness();
  const input = {
    workspaceId: "workspace-1",
    creatorId: "user-1",
    name: "general",
    visibility: "public",
    idempotencyKey: "concurrent-retry"
  };
  const results = await Promise.all([service.create(input), service.create(input)]);

  assert.ok(results.every((result) => result.kind === "created"));
  const created = results.filter((result) => result.kind === "created");
  assert.equal(created.length, 2);
  const first = created[0];
  const second = created[1];
  if (!first || !second) throw new Error("Expected both concurrent requests to succeed or replay.");
  assert.equal(first.result.channel.id, second.result.channel.id);
  assert.deepEqual(created.map((result) => result.replayed).sort(), [false, true]);
  assert.equal(channels.size, 1);
});

void test("returns channel details only to a member in the selected workspace", async () => {
  const { service } = createHarness();
  const created = await service.create({
    workspaceId: "workspace-1",
    creatorId: "user-1",
    name: "general",
    description: "Team updates",
    visibility: "public"
  });
  assert.equal(created.kind, "created");
  assert.ok("result" in created);
  if (!("result" in created)) return;

  assert.deepEqual(await service.getForMember("workspace-1", created.result.channel.id, "user-1"), created.result.channel);
  assert.equal(await service.getForMember("workspace-2", created.result.channel.id, "user-1"), null);
  assert.equal(await service.getForMember("workspace-1", created.result.channel.id, "user-2"), null);
});

void test("lists every active channel the member belongs to in the selected workspace", async () => {
  const { service } = createHarness();
  const first = await service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: "general", visibility: "public" });
  const second = await service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: "design", visibility: "private" });
  assert.ok("result" in first && "result" in second);
  if (!("result" in first) || !("result" in second)) throw new Error("Expected both channels to be created.");

  assert.deepEqual(await service.listForMember("workspace-1", "user-1"), [
    first.result.channel,
    second.result.channel
  ]);
  assert.deepEqual(await service.listForMember("workspace-2", "user-1"), []);
  assert.deepEqual(await service.listForMember("workspace-1", "user-2"), []);
});

void test("paginates channel discovery by stable name and excludes private and joined channels", async () => {
  const { service } = createHarness();
  for (const [name, visibility] of [
    ["alpha", "public"],
    ["beta", "public"],
    ["gamma", "public"],
    ["secret", "private"]
  ] as const) {
    await service.create({ workspaceId: "workspace-1", creatorId: "owner", name, visibility });
  }
  await service.create({ workspaceId: "workspace-1", creatorId: "user-1", name: "joined", visibility: "public" });

  const firstPage = await service.listChannels("workspace-1", "user-1", {
    scope: "discoverable",
    pageSize: 2,
    cursor: null
  });

  void test("joins public channels idempotently and audits only a new membership", async () => {
    const { service, auditEvents } = createHarness();
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "general", visibility: "public" });
    assert.equal(created.kind, "created");

    const joined = await service.joinPublicChannel("workspace-1", created.result.channel.id, "user-1");
    const repeated = await service.joinPublicChannel("workspace-1", created.result.channel.id, "user-1");
    assert.equal(joined.kind, "joined");
    assert.equal(repeated.kind, "already-joined");
    assert.equal(await service.getForMember("workspace-1", created.result.channel.id, "user-1") !== null, true);
    assert.deepEqual(auditEvents.at(-1), {
      event: "channel.member_joined",
      outcome: "joined",
      actorId: "user-1",
      targetId: "user-1",
      workspaceId: "workspace-1",
      channelId: created.result.channel.id,
      occurredAt: created.result.channel.createdAt.toISOString()
    });
    assert.equal(auditEvents.filter((event) => event.event === "channel.member_joined").length, 1);
  });

  void test("provisions a public general channel and enrolls new workspace members", async () => {
    const { service, channels } = createHarness();

    const ownerResult = await service.ensureGeneralChannel("workspace-1", "owner");
    const memberResult = await service.ensureGeneralChannel("workspace-1", "member");

    assert.equal(ownerResult.kind, "ready");
    assert.equal(memberResult.kind, "ready");
    assert.equal(memberResult.channelId, ownerResult.channelId);
    assert.deepEqual([...channels.values()].map(({ name, visibility }) => ({ name, visibility })), [
      { name: "general", visibility: "public" }
    ]);
    assert.ok(await service.getForMember("workspace-1", ownerResult.channelId, "owner"));
    assert.ok(await service.getForMember("workspace-1", ownerResult.channelId, "member"));
  });

  void test("does not replace a private channel named general with automatic membership", async () => {
    const { service } = createHarness();
    await service.create({
      workspaceId: "workspace-1",
      creatorId: "owner",
      name: "general",
      visibility: "private"
    });

    await assert.rejects(service.ensureGeneralChannel("workspace-1", "member"), /private channel named general/);
  });

  void test("rejects private and cross-workspace joins without creating membership", async () => {
    const { service } = createHarness();
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "secret", visibility: "private" });
    assert.equal(created.kind, "created");

    assert.deepEqual(await service.joinPublicChannel("workspace-1", created.result.channel.id, "user-2"), { kind: "not-public" });
    assert.deepEqual(await service.joinPublicChannel("workspace-2", created.result.channel.id, "user-2"), { kind: "channel-unavailable" });
    assert.equal(await service.getForMember("workspace-1", created.result.channel.id, "user-2"), null);
  });

  void test("allows the last admin to leave while preserving the channel and its other members", async () => {
    const { service, channels, auditEvents } = createHarness();
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "general", visibility: "public" });
    assert.equal(created.kind, "created");

    const joined = await service.joinPublicChannel("workspace-1", created.result.channel.id, "member");
    assert.equal(joined.kind, "joined");
    assert.deepEqual(await service.leaveChannel("workspace-1", created.result.channel.id, "owner"), { kind: "left" });
    assert.equal(await service.getForMember("workspace-1", created.result.channel.id, "owner"), null);
    assert.ok(await service.getForMember("workspace-1", created.result.channel.id, "member"));
    assert.deepEqual(await service.leaveChannel("workspace-1", created.result.channel.id, "member"), { kind: "left" });
    assert.deepEqual(await service.leaveChannel("workspace-1", created.result.channel.id, "member"), { kind: "already-left" });
    assert.equal(await service.getForMember("workspace-1", created.result.channel.id, "member"), null);
    assert.equal(channels.has(created.result.channel.id), true);
    assert.equal(auditEvents.filter((event) => event.event === "channel.member_left").length, 2);
  });

  void test("invites only known workspace accounts idempotently and audits actor and target", async () => {
    const { service, auditEvents } = createHarness();
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "private", visibility: "private" });
    assert.equal(created.kind, "created");

    const invited = await service.inviteMember("workspace-1", created.result.channel.id, "owner", "invitee@example.test");
    const repeated = await service.inviteMember("workspace-1", created.result.channel.id, "owner", "invitee@example.test");
    assert.equal(invited.kind, "added");
    assert.equal(repeated.kind, "already-member");
    assert.deepEqual(await service.inviteMember("workspace-1", created.result.channel.id, "invitee", "invitee@example.test"), {
      kind: "not-manager"
    });
    const listed = await service.listMembers("workspace-1", created.result.channel.id, "owner");
    assert.equal(listed.kind, "listed");
    assert.equal(listed.canManage, true);
    assert.equal(listed.members.find((member) => member.userId === "invitee")?.email, "invitee@example.test");
    assert.deepEqual(await service.removeMember("workspace-1", created.result.channel.id, "owner", "invitee"), { kind: "removed" });
    assert.equal(auditEvents.filter((event) => event.event === "channel.member_invited").length, 2);
    assert.deepEqual(auditEvents.at(-1), {
      event: "channel.member_removed",
      outcome: "removed",
      actorId: "owner",
      targetId: "invitee",
      workspaceId: "workspace-1",
      channelId: created.result.channel.id,
      occurredAt: "2026-10-12T00:00:00.000Z"
    });
  });

  void test("reports workspace membership storage outages during private-channel invites", async () => {
    const { service } = createHarness(true);
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "private", visibility: "private" });
    assert.equal(created.kind, "created");

    assert.deepEqual(
      await service.inviteMember("workspace-1", created.result.channel.id, "owner", "invitee@example.test"),
      { kind: "workspace-unavailable" }
    );
  });

  void test("concurrent repeated membership commands converge on one membership state", async () => {
    const { service } = createHarness();
    const created = await service.create({ workspaceId: "workspace-1", creatorId: "owner", name: "general", visibility: "public" });
    assert.equal(created.kind, "created");

    const joined = await Promise.all([
      service.joinPublicChannel("workspace-1", created.result.channel.id, "member"),
      service.joinPublicChannel("workspace-1", created.result.channel.id, "member")
    ]);
    assert.deepEqual(joined.map((result) => result.kind).sort(), ["already-joined", "joined"]);
    const left = await Promise.all([
      service.leaveChannel("workspace-1", created.result.channel.id, "member"),
      service.leaveChannel("workspace-1", created.result.channel.id, "member")
    ]);
    assert.deepEqual(left.map((result) => result.kind).sort(), ["already-left", "left"]);
  });
  assert.deepEqual(firstPage.channels.map((channel) => channel.name), ["alpha", "beta"]);
  assert.ok(firstPage.nextCursor);
  const decoded = decodeChannelListCursor(firstPage.nextCursor, "discoverable");
  assert.ok(decoded.ok);

  const secondPage = await service.listChannels("workspace-1", "user-1", {
    scope: "discoverable",
    pageSize: 2,
    cursor: decoded.cursor
  });
  assert.deepEqual(secondPage.channels.map((channel) => channel.name), ["gamma"]);
  assert.equal(secondPage.nextCursor, null);
  assert.deepEqual(await service.listChannels("workspace-2", "user-1", {
    scope: "discoverable",
    pageSize: 2,
    cursor: null
  }), { channels: [], nextCursor: null });
});

void test("replays pre-description idempotency records when the request has no description", async () => {
  const { service, requests } = createHarness();
  const input = {
    workspaceId: "workspace-1",
    creatorId: "user-1",
    name: "general",
    visibility: "public",
    idempotencyKey: "legacy-retry"
  };
  const created = await service.create(input);
  assert.ok("result" in created);
  if (!("result" in created)) return;

  const [requestId, request] = [...requests.entries()][0] ?? [];
  assert.ok(requestId && request);
  requests.set(requestId, { ...request, fingerprint: JSON.stringify(["general", "public"]) });

  const replayed = await service.create(input);
  assert.ok("result" in replayed);
  if (!("result" in replayed)) return;
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.result.channel.id, created.result.channel.id);
});
