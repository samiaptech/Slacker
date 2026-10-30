import test from "node:test";
import assert from "node:assert/strict";
import type { NotificationDocument } from "../model.js";
import type { NotificationStorage } from "../storage.js";
import { createNotificationService } from "../service.js";

const createHarness = () => {
  const documents: NotificationDocument[] = [];
  const events: Readonly<Record<string, unknown>>[] = [];
  const threadReplyEvents: Readonly<Record<string, unknown>>[] = [];
  const storage: NotificationStorage = {
    initialize: () => Promise.resolve(),
    createForChannel: (event, mentionedUserIds) => {
      const members = ["actor-1", "mention-1", "member-2"];
      const created: NotificationDocument[] = [];
      for (const recipientId of members) {
        if (recipientId === event.actor.id || documents.some((item) =>
          item.recipientId === recipientId && item.eventId === event.eventId)) continue;
        const item: NotificationDocument = Object.freeze({
          _id: `${event.eventId}:${recipientId}`,
          eventId: event.eventId,
          recipientId,
          workspaceId: event.workspaceId,
          type: mentionedUserIds.includes(recipientId) ? "mention" : event.type,
          resourceType: event.resource.type,
          resourceId: event.resource.id,
          actorId: event.actor.id,
          actorName: event.actor.name,
          createdAt: event.createdAt,
          readAt: null,
          ...(event.threadRootId ? { threadRootId: event.threadRootId } : {})
        });
        documents.push(item);
        created.push(item);
      }
      return Promise.resolve(Object.freeze(created));
    },
    createForChannelThreadReply: (event, rootMessageId, mentionedUserIds) => {
      threadReplyEvents.push({ event, rootMessageId, mentionedUserIds });
      const item: NotificationDocument = {
        _id: `${event.eventId}:participant`,
        eventId: event.eventId,
        recipientId: "participant",
        workspaceId: event.workspaceId,
        type: "channel_thread_reply",
        resourceType: "channel",
        resourceId: event.resource.id,
        actorId: event.actor.id,
        actorName: event.actor.name,
        createdAt: event.createdAt,
        readAt: null,
        threadRootId: rootMessageId
      };
      documents.push(item);
      return Promise.resolve([item]);
    },
    createForDirectMessage: (event) => {
      const recipientId = event.actor.id === "actor-1" ? "dm-recipient" : "actor-1";
      const item: NotificationDocument = Object.freeze({
        _id: `${event.eventId}:${recipientId}`,
        eventId: event.eventId,
        recipientId,
        workspaceId: event.workspaceId,
        type: event.type,
        resourceType: event.resource.type,
        resourceId: event.resource.id,
        actorId: event.actor.id,
        actorName: event.actor.name,
        createdAt: event.createdAt,
        readAt: null
      });
      documents.push(item);
      return Promise.resolve([item]);
    },
    listForUser: (userId) => Promise.resolve(documents.filter(({ recipientId }) => recipientId === userId)),
    unreadCount: (userId) => Promise.resolve(documents.filter(({ recipientId, readAt }) =>
      recipientId === userId && readAt === null).length),
    markRead: (userId, notificationId, readAt) => {
      const existing = documents.find((item) => item._id === notificationId && item.recipientId === userId);
      if (!existing) return Promise.resolve(false);
      const index = documents.indexOf(existing);
      documents[index] = Object.freeze({ ...existing, readAt });
      return Promise.resolve(true);
    },
    markResourceRead: (userId, resource, readAt) => {
      let count = 0;
      for (const [index, item] of documents.entries()) {
        if (item.recipientId === userId && item.resourceType === resource.type
          && item.resourceId === resource.id && item.readAt === null) {
          documents[index] = Object.freeze({ ...item, readAt });
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    markThreadRead: (userId, channelId, rootMessageId, readAt) => {
      let count = 0;
      for (const [index, item] of documents.entries()) {
        if (item.recipientId === userId && item.resourceType === "channel"
          && item.resourceId === channelId && item.threadRootId === rootMessageId
          && item.readAt === null) {
          documents[index] = Object.freeze({ ...item, readAt });
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    findCursor: (userId, notificationId) => Promise.resolve(documents.find((item) =>
      item._id === notificationId && item.recipientId === userId) ?? null)
  };
  const service = createNotificationService({
    storage,
    createId: () => "event-generated",
    now: () => new Date("2026-10-26T10:00:00.000Z"),
    realtime: {
      publishNew: (userId, notification) => { events.push({ kind: "new", userId, notification }); },
      publishUnreadCount: (userId, unreadCount) => { events.push({ kind: "count", userId, unreadCount }); }
    }
  });
  return { service, documents, events, threadReplyEvents };
};

void test("persists channel notifications once, upgrades explicit mentions, and suppresses the actor", async () => {
  const { service, documents, events } = createHarness();
  const message = {
    workspaceId: "workspace-1",
    channelId: "channel-1",
    messageId: "message-1",
    actor: { id: "actor-1", name: "Actor" },
    text: "hello @[mention-1] @[unknown-user]",
    createdAt: new Date("2026-10-26T09:00:00.000Z")
  };
  await service.notifyChannelMessage(message);
  await service.notifyChannelMessage(message);

  assert.equal(documents.length, 2);
  assert.deepEqual(documents.map(({ recipientId, type }) => [recipientId, type]), [
    ["mention-1", "mention"],
    ["member-2", "channel_message"]
  ]);
  assert.equal(events.filter(({ kind }) => kind === "new").length, 2);
  assert.equal(events.some(({ userId }) => userId === "actor-1"), false);
});

void test("creates one incoming DM notification and marks a resource read for only its owner", async () => {
  const { service, documents, events } = createHarness();
  await service.notifyDirectMessage({
    workspaceId: "workspace-1",
    conversationId: "conversation-1",
    messageId: "dm-1",
    actor: { id: "actor-1", name: "   " },
    createdAt: new Date("2026-10-26T09:00:00.000Z")
  });
  const notification = documents[0];
  assert.ok(notification);
  assert.equal(notification.recipientId, "dm-recipient");
  assert.equal(notification.type, "direct_message");
  assert.equal(notification.actorName, "Former member");
  await service.markResourceRead("dm-recipient", { type: "direct_message", id: "conversation-1" });
  assert.equal(documents[0]?.readAt?.toISOString(), "2026-10-26T10:00:00.000Z");
  assert.equal(events.at(-1)?.kind, "count");
  assert.deepEqual(await service.markRead("another-user", notification._id), { kind: "not-found" });
});

void test("creates channel activity notifications for remaining members without notifying its actor", async () => {
  const { service, documents } = createHarness();
  await service.notifyChannelActivity({
    workspaceId: "workspace-1",
    channelId: "channel-1",
    type: "channel_member_left",
    actor: { id: "actor-1", name: "Actor" },
    eventId: "departure-1",
    createdAt: new Date("2026-10-26T09:00:00.000Z")
  });

  void test("creates thread reply notification events with the root ID and stable reply event ID", async () => {
    const { service, documents, threadReplyEvents } = createHarness();
    await service.notifyChannelThreadReply({
      workspaceId: "workspace-1",
      channelId: "channel-1",
      rootMessageId: "root-1",
      messageId: "reply-1",
      actor: { id: "actor-1", name: "Actor" },
      text: "answer @[member-2]",
      createdAt: new Date("2026-10-26T09:00:00.000Z")
    });
    assert.deepEqual(threadReplyEvents[0], {
      event: {
        eventId: "reply-1",
        workspaceId: "workspace-1",
        resource: { type: "channel", id: "channel-1" },
        type: "channel_thread_reply",
        actor: { id: "actor-1", name: "Actor" },
        createdAt: new Date("2026-10-26T09:00:00.000Z"),
        threadRootId: "root-1"
      },
      rootMessageId: "root-1",
      mentionedUserIds: ["member-2"]
    });
    assert.equal(documents[0]?.threadRootId, "root-1");
  });
  assert.deepEqual(documents.map(({ recipientId, type }) => [recipientId, type]), [
    ["mention-1", "channel_member_left"],
    ["member-2", "channel_member_left"]
  ]);
});
