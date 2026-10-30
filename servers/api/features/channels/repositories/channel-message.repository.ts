import {
  encodeChannelMessageCursor,
  type ChannelMessage,
  type ChannelHistoryEntry,
  type ChannelMessageDeleteScope,
  type ChannelMessagePageQuery,
  type ChannelThreadSummary
} from "../domain/index.js";
import type { ChannelMessageDocument } from "../models/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";
import type { StoredMessageReaction } from "../../message-reactions/public/index.js";
import type { MessageReactionEmoji } from "@workspace/types";

export type ChannelMessageStorageResult =
  | Readonly<{ kind: "listed"; messages: readonly ChannelMessageDocument[] }>
  | Readonly<{ kind: "channel-unavailable" }>;

export type MessageDeleteResult =
  | Readonly<{ kind: "deleted"; attachments: readonly ChatAttachmentRecord[] }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "forbidden" }>;

export type ChannelMessageEditStorageResult =
  | Readonly<{
    kind: "updated";
    message: ChannelMessageDocument;
    reactions: readonly StoredMessageReaction[];
  }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "not-editable" }>
  | Readonly<{ kind: "conflict" }>;
export type ChannelMessageEditResult = Exclude<ChannelMessageEditStorageResult, { kind: "updated" }> |
  Readonly<{ kind: "updated"; message: ChannelMessage; reactions: readonly StoredMessageReaction[] }>;

export type ChannelThreadStorageResult =
  | Readonly<{ kind: "listed"; root: ChannelMessageDocument; replies: readonly ChannelMessageDocument[] }>
  | Readonly<{ kind: "channel-unavailable" }>;

export type ChannelThreadReplyStorageResult =
  | Readonly<{ kind: "created"; reply: ChannelMessageDocument; thread: ChannelThreadSummary }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "root-not-found" }>;
export type ChannelThreadReplyResult =
  | Readonly<{ kind: "created"; reply: ChannelMessage; thread: ChannelThreadSummary }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "root-not-found" }>;

export type ChannelMessageStorage = Readonly<{
  initialize: () => Promise<void>;
  findForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    query: ChannelMessagePageQuery
  ) => Promise<ChannelMessageStorageResult>;
  createForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    message: ChannelMessageDocument
  ) => Promise<"created" | "channel-unavailable">;
  findThreadForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    rootMessageId: string,
    query: ChannelMessagePageQuery
  ) => Promise<ChannelThreadStorageResult>;
  createThreadReplyForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    rootMessageId: string,
    reply: ChannelMessageDocument
  ) => Promise<ChannelThreadReplyStorageResult>;
  editForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    text: string,
    expectedEditedAt: Date | null,
    editedAt: Date
  ) => Promise<ChannelMessageEditStorageResult>;
  deleteForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    scope: ChannelMessageDeleteScope,
    isWorkspaceAdmin: boolean
  ) => Promise<MessageDeleteResult>;
  listReactionsForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageIds: readonly string[]
  ) => Promise<readonly StoredMessageReaction[]>;
  toggleReactionForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    emoji: MessageReactionEmoji,
    now: Date
  ) => Promise<Readonly<{ kind: "updated"; reactions: readonly StoredMessageReaction[] }> | Readonly<{ kind: "not-found" }>>;
  findAttachmentForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    attachmentId: string
  ) => Promise<ChatAttachmentRecord | null>;
}>;

export type ChannelMessageRepository = Readonly<{
  initialize: ChannelMessageStorage["initialize"];
  findForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    query: ChannelMessagePageQuery
  ) => Promise<Readonly<{ kind: "listed"; messages: readonly ChannelHistoryEntry[]; nextCursor: string | null }> | Readonly<{ kind: "channel-unavailable" }>>;
  createForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    message: ChannelMessage
  ) => Promise<"created" | "channel-unavailable">;
  findThreadForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    rootMessageId: string,
    query: ChannelMessagePageQuery
  ) => Promise<Readonly<{
    kind: "listed";
    root: ChannelMessage;
    replies: readonly ChannelMessage[];
    nextCursor: string | null;
  }> | Readonly<{ kind: "channel-unavailable" }>>;
  createThreadReplyForMember?: (
    workspaceId: string,
    channelId: string,
    userId: string,
    rootMessageId: string,
    reply: ChannelMessage
  ) => Promise<ChannelThreadReplyResult>;
  editForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    text: string,
    expectedEditedAt: Date | null,
    editedAt: Date
  ) => Promise<ChannelMessageEditResult>;
  deleteForMember: ChannelMessageStorage["deleteForMember"];
  listReactionsForMember?: ChannelMessageStorage["listReactionsForMember"];
  toggleReactionForMember?: ChannelMessageStorage["toggleReactionForMember"];
  findAttachmentForMember?: ChannelMessageStorage["findAttachmentForMember"];
}>;

const toChannelMessage = (document: ChannelMessageDocument): ChannelHistoryEntry => {
  if (document.type === "system" && document.systemEvent === "member_left"
    && document.actorId && document.actorName && document.leftAt) {
    return Object.freeze({
      id: document._id,
      channelId: document.channelId,
      type: "system",
      systemEvent: "member_left",
      actor: Object.freeze({ id: document.actorId, name: document.actorName }),
      text: "",
      createdAt: document.leftAt
    });
  }
  if (!document.senderId) throw new Error("A channel message is missing its sender.");
  return Object.freeze({
    id: document._id,
    channelId: document.channelId,
    senderId: document.senderId,
    text: document.text,
    createdAt: document.createdAt,
    ...(document.threadRootId
      ? { threadRootId: document.threadRootId, thread: null }
      : {
        thread: document.threadReplyCount && document.threadLastReplyAt
          ? Object.freeze({
            replyCount: document.threadReplyCount,
            lastReplyAt: document.threadLastReplyAt
          })
          : null
      }),
    ...(document.editedAt !== undefined ? { editedAt: document.editedAt } : {}),
    ...(document.attachments && document.attachments.length > 0
      ? { attachments: document.attachments }
      : {})
  });
};

const toThreadMessage = (document: ChannelMessageDocument): ChannelMessage => {
  const message = toChannelMessage(document);
  if (!("senderId" in message)) throw new Error("A channel thread message is missing its sender.");
  return message;
};

const toMessageDocument = (message: ChannelMessage): ChannelMessageDocument => Object.freeze({
  _id: message.id,
  channelId: message.channelId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt,
  ...(message.editedAt !== undefined ? { editedAt: message.editedAt } : {}),
  ...(message.threadRootId ? { threadRootId: message.threadRootId } : {}),
  type: "message",
  ...(message.attachments && message.attachments.length > 0
    ? { attachments: message.attachments }
    : {})
});

export const createChannelMessageRepository = (storage: ChannelMessageStorage): ChannelMessageRepository => Object.freeze({
  initialize: storage.initialize,
  findForMember: async (workspaceId, channelId, userId, query) => {
    const result = await storage.findForMember(workspaceId, channelId, userId, query);
    if (result.kind !== "listed") return result;
    const hasMore = result.messages.length > query.pageSize;
    const pageNewestFirst = result.messages.slice(0, query.pageSize);
    const messages = Object.freeze(pageNewestFirst.map(toChannelMessage).reverse());
    const oldest = messages[0];
    return Object.freeze({
      kind: "listed",
      messages,
      nextCursor: hasMore && oldest
        ? encodeChannelMessageCursor({ createdAt: oldest.createdAt, id: oldest.id })
        : null
    });
  },
  createForMember: (workspaceId, channelId, userId, message) =>
    storage.createForMember(workspaceId, channelId, userId, toMessageDocument(message)),
  findThreadForMember: async (workspaceId, channelId, userId, rootMessageId, query) => {
    if (!storage.findThreadForMember) return Object.freeze({ kind: "channel-unavailable" as const });
    const result = await storage.findThreadForMember(
      workspaceId, channelId, userId, rootMessageId, query
    );
    if (result.kind !== "listed") return result;
    const hasMore = result.replies.length > query.pageSize;
    const pageNewestFirst = result.replies.slice(0, query.pageSize);
    const replies = Object.freeze(pageNewestFirst.map(toThreadMessage).reverse());
    const root = toThreadMessage(result.root);
    const oldest = replies[0];
    return Object.freeze({
      kind: "listed",
      root,
      replies,
      nextCursor: hasMore && oldest
        ? encodeChannelMessageCursor({ createdAt: oldest.createdAt, id: oldest.id })
        : null
    });
  },
  createThreadReplyForMember: async (workspaceId, channelId, userId, rootMessageId, reply) => {
    if (!storage.createThreadReplyForMember) {
      return Object.freeze({ kind: "channel-unavailable" as const });
    }
    const result = await storage.createThreadReplyForMember(
      workspaceId, channelId, userId, rootMessageId, toMessageDocument(reply)
    );
    return result.kind === "created"
      ? Object.freeze({
        kind: "created" as const,
        reply: toThreadMessage(result.reply),
        thread: result.thread
      })
      : result;
  },
  editForMember: async (...args) => {
    const result = await storage.editForMember(...args);
    if (result.kind !== "updated") return result;
    const message = toChannelMessage(result.message);
    if (!("senderId" in message)) throw new Error("An edited channel message is missing its sender.");
    return Object.freeze({ ...result, message });
  },
  deleteForMember: storage.deleteForMember,
  ...(storage.listReactionsForMember
    ? { listReactionsForMember: storage.listReactionsForMember }
    : {}),
  ...(storage.toggleReactionForMember
    ? { toggleReactionForMember: storage.toggleReactionForMember }
    : {}),
  ...(storage.findAttachmentForMember
    ? { findAttachmentForMember: storage.findAttachmentForMember }
    : {})
});
