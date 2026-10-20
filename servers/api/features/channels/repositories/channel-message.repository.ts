import { encodeChannelMessageCursor, type ChannelMessage, type ChannelMessagePageQuery } from "../domain/index.js";
import type { ChannelMessageDocument } from "../models/index.js";

export type ChannelMessageStorageResult =
  | Readonly<{ kind: "listed"; messages: readonly ChannelMessageDocument[] }>
  | Readonly<{ kind: "channel-unavailable" }>;

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
}>;

export type ChannelMessageRepository = Readonly<{
  initialize: ChannelMessageStorage["initialize"];
  findForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    query: ChannelMessagePageQuery
  ) => Promise<Readonly<{ kind: "listed"; messages: readonly ChannelMessage[]; nextCursor: string | null }> | Readonly<{ kind: "channel-unavailable" }>>;
  createForMember: (
    workspaceId: string,
    channelId: string,
    userId: string,
    message: ChannelMessage
  ) => Promise<"created" | "channel-unavailable">;
}>;

const toChannelMessage = (document: ChannelMessageDocument): ChannelMessage => Object.freeze({
  id: document._id,
  channelId: document.channelId,
  senderId: document.senderId,
  text: document.text,
  createdAt: document.createdAt
});

const toMessageDocument = (message: ChannelMessage): ChannelMessageDocument => Object.freeze({
  _id: message.id,
  channelId: message.channelId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt
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
    storage.createForMember(workspaceId, channelId, userId, toMessageDocument(message))
});
