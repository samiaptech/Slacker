import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import type { Logger } from "@workspace/logging";
import type { ApiConfig } from "../../../types/index.js";
import { createMongoDbIntegration } from "../../mongodb/index.js";
import { createAuthenticationIntegration } from "../index.js";
import {
  CHANNELS_COLLECTION,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNEL_MESSAGES_COLLECTION,
  type ChannelDocument,
  type ChannelMembershipDocument,
  type ChannelMessageDocument,
  createMongoChannelMessageStorage,
  createMongoChannelStorage,
  decodeChannelListCursor,
  createChannelMessageRepository,
  createChannelRepository,
  createChannelMessageService,
  createChannelService
} from "../../../features/channels/index.js";
import {
  createMongoWorkspaceStorage,
  createWorkspaceRepository,
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  WORKSPACES_COLLECTION,
  type WorkspaceDocument,
  type WorkspaceMembershipDocument
} from "../../../features/workspaces/index.js";

const mongoTestUri = process.env.MONGODB_TEST_URI;

void test("enforces channel browse and membership contracts against a MongoDB replica set", {
  skip: !mongoTestUri
}, async () => {
  if (!mongoTestUri) return;

  const databaseName = decodeURIComponent(new URL(mongoTestUri).pathname.slice(1));
  if (!/^nutshyll_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("MONGODB_TEST_URI must target a database named nutshyll_test_<name>.");
  }

  const auditEvents: Readonly<Record<string, unknown>>[] = [];
  const logger: Logger = {
    info: (_message, context) => { if (context) auditEvents.push(context); },
    warn: () => undefined,
    error: () => undefined
  };
  const mongo = createMongoDbIntegration({ uri: mongoTestUri, logger });
  await mongo.connect();
  const database = mongo.getDatabase();

  try {
    await database.dropDatabase();

    const channelStorage = createMongoChannelStorage(database, mongo.withTransaction);
    const messageStorage = createMongoChannelMessageStorage(database, mongo.withTransaction);
    const channelRepository = createChannelRepository(channelStorage);
    const messageRepository = createChannelMessageRepository(messageStorage);
    await channelRepository.initialize();
    await messageRepository.initialize();

    const authConfig: ApiConfig = {
      environment: "test",
      host: "127.0.0.1",
      port: 4000,
      webOrigin: "http://localhost:3000",
      mongodbUri: mongoTestUri,
      betterAuthUrl: "http://localhost:4000",
      betterAuthSecret: "integration-test-secret-with-more-than-32-characters",
      googleClientId: "integration-test-client",
      googleClientSecret: "integration-test-client-secret",
      logLevel: "error"
    };
    const authentication = createAuthenticationIntegration({ config: authConfig, database });
    const ownerObjectId = new Types.ObjectId();
    const memberObjectId = new Types.ObjectId();
    const outsideObjectId = new Types.ObjectId();
    const users = database.collection<{
      _id: Types.ObjectId;
      name: string;
      email: string;
      image: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>("user");
    const createdAt = new Date("2026-10-15T00:00:00.000Z");
    await users.insertMany([
      { _id: ownerObjectId, name: "Workspace Owner", email: "owner@example.test", image: null, createdAt, updatedAt: createdAt },
      { _id: memberObjectId, name: "Workspace Member", email: "member@example.test", image: null, createdAt, updatedAt: createdAt },
      { _id: outsideObjectId, name: "Other Workspace Member", email: "outside@example.test", image: null, createdAt, updatedAt: createdAt }
    ]);
    const ownerIdentity = await authentication.findUserByEmail("owner@example.test");
    const memberIdentity = await authentication.findUserByEmail("member@example.test");
    const outsideIdentity = await authentication.findUserByEmail("outside@example.test");
    assert.ok(ownerIdentity);
    assert.ok(memberIdentity);
    assert.ok(outsideIdentity);
    assert.equal(ownerIdentity.id, ownerObjectId.toHexString());
    assert.equal(memberIdentity.id, memberObjectId.toHexString());
    assert.equal(outsideIdentity.id, outsideObjectId.toHexString());
    const owner = ownerIdentity.id;
    const member = memberIdentity.id;
    const outside = outsideIdentity.id;

    const workspaceStorage = createMongoWorkspaceStorage(database, mongo.withTransaction);
    const workspaceRepository = createWorkspaceRepository(workspaceStorage);
    await workspaceStorage.initialize();
    await database.collection<WorkspaceDocument>(WORKSPACES_COLLECTION).insertMany([
      { _id: "workspace-1", name: "Workspace One", createdBy: owner, createdAt },
      { _id: "workspace-2", name: "Workspace Two", createdBy: owner, createdAt }
    ]);
    await database.collection<WorkspaceMembershipDocument>(WORKSPACE_MEMBERSHIPS_COLLECTION).insertMany([
      { _id: `workspace-1:${owner}`, workspaceId: "workspace-1", userId: owner, role: "admin", joinedAt: createdAt },
      { _id: `workspace-1:${member}`, workspaceId: "workspace-1", userId: member, role: "member", joinedAt: createdAt },
      { _id: `workspace-2:${owner}`, workspaceId: "workspace-2", userId: owner, role: "admin", joinedAt: createdAt },
      { _id: `workspace-2:${outside}`, workspaceId: "workspace-2", userId: outside, role: "member", joinedAt: createdAt }
    ]);
    let id = 0;
    let timestamp = Date.parse("2026-10-16T00:00:00.000Z");
    const nextDate = (): Date => new Date(timestamp++);
    const channelService = createChannelService({
      repository: channelRepository,
      logger,
      createId: () => `channel-${String(++id)}`,
      now: nextDate,
      findWorkspaceMemberByEmail: async (workspaceId, email) => {
        const identity = await authentication.findUserByEmail(email);
        if (!identity) return { kind: "not-found" };
        try {
          const membership = await workspaceRepository.findMembership(workspaceId, identity.id);
          return membership ? { kind: "found", member: identity } : { kind: "not-found" };
        } catch (error: unknown) {
          if (typeof error === "object" && error !== null
            && "kind" in error && error.kind === "workspace-storage-unavailable") {
            return { kind: "unavailable" };
          }
          throw error;
        }
      },
      findWorkspaceMembersByIds: (userIds) => authentication.findUsersByIds(userIds)
    });
    const messageService = createChannelMessageService({
      repository: messageRepository,
      createId: () => `message-${String(++id)}`,
      now: nextDate,
      findUsersByIds: async (userIds) => (await authentication.findUsersByIds(userIds))
        .map(({ id: memberId, name, image }) => ({ id: memberId, name, image }))
    });
    const createChannel = async (
      workspaceId: string,
      name: string,
      visibility: "public" | "private"
    ): Promise<string> => {
      const result = await channelService.create({ workspaceId, creatorId: owner, name, visibility });
      assert.equal(result.kind, "created");
      return result.result.channel.id;
    };

    const generalId = await createChannel("workspace-1", "general", "public");
    assert.deepEqual(await channelService.ensureGeneralChannel("workspace-1", member), {
      kind: "ready",
      channelId: generalId
    });
    const alphaId = await createChannel("workspace-1", "alpha", "public");
    const bravoId = await createChannel("workspace-1", "bravo", "public");
    await createChannel("workspace-1", "charlie", "public");
    await createChannel("workspace-1", "delta", "public");
    const privateId = await createChannel("workspace-1", "secret", "private");
    await createChannel("workspace-2", "foreign", "public");
    await database.collection<ChannelDocument>(CHANNELS_COLLECTION).insertOne({
      _id: "archived-channel",
      workspaceId: "workspace-1",
      name: "archived",
      description: null,
      visibility: "public",
      lifecycleState: "archived",
      createdBy: owner,
      createdAt: new Date("2026-10-15T00:00:00.000Z"),
      updatedAt: new Date("2026-10-16T00:00:00.000Z"),
      archivedAt: new Date("2026-10-16T00:00:00.000Z")
    });
    await database.collection<ChannelMembershipDocument>(CHANNEL_MEMBERSHIPS_COLLECTION).insertOne({
      _id: `archived-channel:${member}`,
      channelId: "archived-channel",
      userId: member,
      role: "member",
      joinedAt: new Date("2026-10-15T00:00:00.000Z")
    });

    assert.equal((await channelService.joinPublicChannel("workspace-1", bravoId, member)).kind, "joined");
    const firstPage = await channelService.listChannels("workspace-1", member, {
      scope: "discoverable",
      pageSize: 2,
      cursor: null
    });
    assert.deepEqual(firstPage.channels.map(({ name }) => name), ["alpha", "charlie"]);
    assert.ok(firstPage.nextCursor);
    const decodedCursor = decodeChannelListCursor(firstPage.nextCursor, "discoverable");
    assert.ok(decodedCursor.ok);
    const secondPage = await channelService.listChannels("workspace-1", member, {
      scope: "discoverable",
      pageSize: 2,
      cursor: decodedCursor.cursor
    });
    assert.deepEqual(secondPage.channels.map(({ name }) => name), ["delta"]);
    assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(await channelService.listChannels("workspace-2", member, {
      scope: "joined",
      pageSize: 25,
      cursor: null
    }), { channels: [], nextCursor: null });
    const joinedChannels = await channelService.listChannels("workspace-1", member, {
      scope: "joined",
      pageSize: 25,
      cursor: null
    });
    assert.equal(joinedChannels.channels.some(({ id: channelId }) => channelId === privateId), false);
    assert.equal(joinedChannels.channels.some(({ id: channelId }) => channelId === "archived-channel"), false);

    const concurrentJoins = await Promise.all([
      channelService.joinPublicChannel("workspace-1", alphaId, member),
      channelService.joinPublicChannel("workspace-1", alphaId, member)
    ]);
    assert.deepEqual(concurrentJoins.map(({ kind }) => kind).sort(), ["already-joined", "joined"]);
    assert.equal(await database.collection("channel_memberships").countDocuments({
      channelId: alphaId,
      userId: member
    }), 1);

    const persistedMessage = await messageService.send("workspace-1", bravoId, member, "Retained after leaving.");
    assert.equal(persistedMessage.kind, "sent");
    const ownerLeft = await channelService.leaveChannel("workspace-1", bravoId, owner);
    assert.equal(ownerLeft.kind, "left");
    assert.equal(await channelService.getForMember("workspace-1", bravoId, owner), null);
    assert.ok(await channelService.getForMember("workspace-1", bravoId, member));
    const remainingMemberLeft = await channelService.leaveChannel("workspace-1", bravoId, member);
    assert.equal(remainingMemberLeft.kind, "left");
    assert.deepEqual(await messageRepository.findForMember("workspace-1", bravoId, member, {
      pageSize: 20,
      before: null
    }), { kind: "channel-unavailable" });
    assert.equal(await database.collection<ChannelMessageDocument>(CHANNEL_MESSAGES_COLLECTION)
      .countDocuments({ channelId: bravoId }), 1);

    assert.equal(await channelService.getForMember("workspace-1", privateId, member), null);
    assert.equal((await channelService.inviteMember(
      "workspace-1",
      privateId,
      owner,
      "member@example.test"
    )).kind, "added");
    assert.equal((await channelService.inviteMember(
      "workspace-1",
      privateId,
      owner,
      "member@example.test"
    )).kind, "already-member");
    assert.equal((await channelService.inviteMember(
      "workspace-1",
      privateId,
      member,
      "outside@example.test"
    )).kind, "not-manager");
    assert.equal((await channelService.inviteMember(
      "workspace-1",
      privateId,
      owner,
      "outside@example.test"
    )).kind, "target-unavailable");
    assert.ok(await channelService.getForMember("workspace-1", privateId, member));
    assert.equal((await channelService.removeMember(
      "workspace-1",
      privateId,
      owner,
      owner
    )).kind, "protected-admin");

    const privateMessage = await messageService.send("workspace-1", privateId, member, "Private history remains.");
    assert.equal(privateMessage.kind, "sent");
    assert.equal((await channelService.removeMember(
      "workspace-1",
      privateId,
      owner,
      member
    )).kind, "removed");
    assert.equal(await channelService.getForMember("workspace-1", privateId, member), null);
    assert.deepEqual(await messageRepository.findForMember("workspace-1", privateId, member, {
      pageSize: 20,
      before: null
    }), { kind: "channel-unavailable" });
    assert.equal(await database.collection<ChannelMessageDocument>(CHANNEL_MESSAGES_COLLECTION)
      .countDocuments({ channelId: privateId }), 1);

    const membershipAuditEvents = auditEvents.filter(({ event }) =>
      typeof event === "string" && event.startsWith("channel."));
    for (const event of membershipAuditEvents) {
      assert.equal(typeof event.actorId, "string");
      assert.equal(typeof event.targetId, "string");
      assert.equal(typeof event.workspaceId, "string");
      assert.equal(typeof event.channelId, "string");
      assert.equal(typeof event.outcome, "string");
      assert.equal(typeof event.occurredAt, "string");
      assert.equal("text" in event, false);
      assert.equal("email" in event, false);
    }
  } finally {
    await database.dropDatabase();
    await mongo.disconnect();
  }
});
