import {
  encodeDirectMessageCursor,
  type DirectConversation,
  type DirectMessage,
  type DirectMessageDeleteScope,
  type DirectMessagePageQuery
} from "../domain/index.js";
import type { DirectConversationDocument, DirectMessageDocument } from "../models/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";

export type DirectMessageOpenStorageResult =
  Readonly<{ kind: "opened"; conversation: DirectConversationDocument; created: boolean }>;

export type DirectMessageDeleteResult =
  | Readonly<{ kind: "deleted"; attachments: readonly ChatAttachmentRecord[] }>
  | Readonly<{ kind: "not-found" }>
  | Readonly<{ kind: "forbidden" }>;

export type DirectMessageStorage = Readonly<{
  initialize: () => Promise<void>;
  openForMember: (
    workspaceId: string,
    conversation: DirectConversationDocument
  ) => Promise<DirectMessageOpenStorageResult>;
  listForMember: (
    workspaceId: string,
    userId: string
  ) => Promise<readonly DirectConversationDocument[]>;
  findForMember: (
    workspaceId: string,
    conversationId: string,
    userId: string
  ) => Promise<DirectConversationDocument | null>;
  listMessagesForMember: (
    workspaceId: string,
    conversationId: string,
    userId: string,
    query: DirectMessagePageQuery
  ) => Promise<readonly DirectMessageDocument[] | null>;
  createMessageForMember: (
    workspaceId: string,
    conversationId: string,
    userId: string,
    message: DirectMessageDocument
  ) => Promise<boolean>;
  deleteMessageForMember: (
    workspaceId: string,
    conversationId: string,
    userId: string,
    messageId: string,
    scope: DirectMessageDeleteScope,
    isWorkspaceAdmin: boolean
  ) => Promise<DirectMessageDeleteResult>;
  findAttachmentForMember?: (
    workspaceId: string,
    conversationId: string,
    userId: string,
    messageId: string,
    attachmentId: string
  ) => Promise<ChatAttachmentRecord | null>;
}>;

export type DirectMessageRepository = ReturnType<typeof createDirectMessageRepository>;

const toConversation = (document: DirectConversationDocument): DirectConversation => Object.freeze({
  id: document._id,
  workspaceId: document.workspaceId,
  pairKey: document.pairKey,
  participantIds: document.participantIds,
  createdAt: document.createdAt,
  lastActivityAt: document.lastActivityAt
});

const toMessage = (document: DirectMessageDocument): DirectMessage => Object.freeze({
  id: document._id,
  workspaceId: document.workspaceId,
  conversationId: document.conversationId,
  senderId: document.senderId,
  text: document.text,
  createdAt: document.createdAt,
  ...(document.attachments && document.attachments.length > 0
    ? { attachments: document.attachments }
    : {})
});

const toConversationDocument = (conversation: DirectConversation): DirectConversationDocument => Object.freeze({
  _id: conversation.id,
  workspaceId: conversation.workspaceId,
  pairKey: conversation.pairKey,
  participantIds: conversation.participantIds,
  createdAt: conversation.createdAt,
  lastActivityAt: conversation.lastActivityAt
});

const toMessageDocument = (message: DirectMessage): DirectMessageDocument => Object.freeze({
  _id: message.id,
  workspaceId: message.workspaceId,
  conversationId: message.conversationId,
  senderId: message.senderId,
  text: message.text,
  createdAt: message.createdAt,
  ...(message.attachments && message.attachments.length > 0
    ? { attachments: message.attachments }
    : {})
});

export const createDirectMessageRepository = (storage: DirectMessageStorage) => Object.freeze({
  initialize: storage.initialize,
  openForMember: async (workspaceId: string, conversation: DirectConversation) => {
    const result = await storage.openForMember(
      workspaceId,
      toConversationDocument(conversation)
    );
    return Object.freeze({
      kind: "opened" as const,
      conversation: toConversation(result.conversation),
      created: result.created
    });
  },
  listForMember: async (workspaceId: string, userId: string) => {
    const result = await storage.listForMember(workspaceId, userId);
    return result.map(toConversation);
  },
  findForMember: async (workspaceId: string, conversationId: string, userId: string) => {
    const result = await storage.findForMember(workspaceId, conversationId, userId);
    return result ? toConversation(result) : null;
  },
  listMessagesForMember: async (workspaceId: string, conversationId: string, userId: string, query: DirectMessagePageQuery) => {
    const result = await storage.listMessagesForMember(workspaceId, conversationId, userId, query);
    if (!result) return null;
    const hasMore = result.length > query.pageSize;
    const newestFirst = result.slice(0, query.pageSize);
    const messages = Object.freeze(newestFirst.map(toMessage).reverse());
    const oldest = messages[0];
    return Object.freeze({
      messages,
      nextCursor: hasMore && oldest
        ? encodeDirectMessageCursor({ createdAt: oldest.createdAt, id: oldest.id })
        : null
    });
  },
  createMessageForMember: (
    workspaceId: string,
    conversationId: string,
    userId: string,
    message: DirectMessage
  ): Promise<boolean> => storage.createMessageForMember(
    workspaceId,
    conversationId,
    userId,
    toMessageDocument(message)
  ),
  deleteMessageForMember: storage.deleteMessageForMember,
  ...(storage.findAttachmentForMember
    ? { findAttachmentForMember: storage.findAttachmentForMember }
    : {})
});
