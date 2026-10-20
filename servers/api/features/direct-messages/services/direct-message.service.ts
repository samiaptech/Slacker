import {
  createDirectMessagePairKey,
  validateDirectMessageText,
  type DirectConversation,
  type DirectMessage,
  type DirectMessagePageQuery
} from "../domain/index.js";
import type { DirectMessageRepository } from "../repositories/index.js";

export type DirectParticipant = Readonly<{ id: string; name: string; image: string | null }>;
export type DirectConversationWithParticipant = DirectConversation & Readonly<{ otherParticipant: DirectParticipant }>;
export type DirectMessageWithSender = DirectMessage & Readonly<{ sender: DirectParticipant }>;

export type DirectMessageService = ReturnType<typeof createDirectMessageService>;

type DirectMessageServiceDependencies = Readonly<{
  repository: DirectMessageRepository;
  isWorkspaceMember: (
    workspaceId: string,
    userId: string
  ) => Promise<"member" | "not-member" | "unavailable">;
  createId: () => string;
  now: () => Date;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly DirectParticipant[]>;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const isStorageUnavailable = (error: unknown): boolean =>
  isRecord(error) && error.kind === "direct-message-storage-unavailable";

const withParticipant = async (
  conversation: DirectConversation,
  userId: string,
  findUsersByIds: DirectMessageServiceDependencies["findUsersByIds"]
): Promise<DirectConversationWithParticipant> => {
  const otherParticipantId = conversation.participantIds.find((participantId) => participantId !== userId);
  if (!otherParticipantId) throw new Error("Direct conversation has no other participant.");
  const profiles = await findUsersByIds([otherParticipantId]);
  const profile = profiles.find(({ id }) => id === otherParticipantId);
  return Object.freeze({
    ...conversation,
    otherParticipant: Object.freeze({
      id: otherParticipantId,
      name: profile?.name || "Former member",
      image: profile?.image ?? null
    })
  });
};

export const createDirectMessageService = ({
  repository,
  isWorkspaceMember,
  createId,
  now,
  findUsersByIds
}: DirectMessageServiceDependencies) => Object.freeze({
  initialize: repository.initialize,
  open: async (workspaceId: string, creatorId: string, recipientId: string) => {
    if (creatorId === recipientId) return Object.freeze({ kind: "self" as const });
    const participantIds: readonly [string, string] = creatorId < recipientId
      ? [creatorId, recipientId]
      : [recipientId, creatorId];
    try {
      const creatorMembership = await isWorkspaceMember(workspaceId, creatorId);
      const recipientMembership = await isWorkspaceMember(workspaceId, recipientId);
      if (creatorMembership === "unavailable" || recipientMembership === "unavailable") {
        return Object.freeze({ kind: "workspace-unavailable" as const });
      }
      if (creatorMembership !== "member" || recipientMembership !== "member") {
        return Object.freeze({ kind: "recipient-unavailable" as const });
      }
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
    const createdAt = now();
    const conversation: DirectConversation = Object.freeze({
      id: createId(),
      workspaceId,
      pairKey: createDirectMessagePairKey(creatorId, recipientId),
      participantIds,
      createdAt,
      lastActivityAt: createdAt
    });
    try {
      const result = await repository.openForMember(workspaceId, conversation);
      return Object.freeze({
        kind: "opened" as const,
        conversation: await withParticipant(result.conversation, creatorId, findUsersByIds),
        created: result.created
      });
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
  },
  list: async (workspaceId: string, userId: string) => {
    try {
      const conversations = await repository.listForMember(workspaceId, userId);
      const listed = await Promise.all(conversations.map((conversation) =>
        withParticipant(conversation, userId, findUsersByIds)));
      return Object.freeze({ kind: "listed" as const, conversations: Object.freeze(listed) });
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
  },
  get: async (workspaceId: string, conversationId: string, userId: string) => {
    try {
      const conversation = await repository.findForMember(workspaceId, conversationId, userId);
      return conversation
        ? Object.freeze({
          kind: "found" as const,
          conversation: await withParticipant(conversation, userId, findUsersByIds)
        })
        : Object.freeze({ kind: "not-found" as const });
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
  },
  listMessages: async (
    workspaceId: string,
    conversationId: string,
    userId: string,
    query: DirectMessagePageQuery
  ) => {
    try {
      const result = await repository.listMessagesForMember(workspaceId, conversationId, userId, query);
      if (!result) return Object.freeze({ kind: "not-found" as const });
      const senderIds = [...new Set(result.messages.map(({ senderId }) => senderId))];
      const profiles = await findUsersByIds(senderIds);
      const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
      return Object.freeze({
        kind: "listed" as const,
        messages: Object.freeze(result.messages.map((message) => {
          const profile = profilesById.get(message.senderId);
          return Object.freeze({
            ...message,
            sender: Object.freeze({
              id: message.senderId,
              name: profile?.name || "Former member",
              image: profile?.image ?? null
            })
          });
        })),
        nextCursor: result.nextCursor
      });
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
  },
  send: async (workspaceId: string, conversationId: string, userId: string, text: string) => {
    const validated = validateDirectMessageText(text);
    if (!validated.ok) return Object.freeze({ kind: "invalid" as const, error: validated.error });
    const message: DirectMessage = Object.freeze({
      id: createId(),
      workspaceId,
      conversationId,
      senderId: userId,
      text: validated.text,
      createdAt: now()
    });
    try {
      const created = await repository.createMessageForMember(workspaceId, conversationId, userId, message);
      if (!created) return Object.freeze({ kind: "not-found" as const });
      const profiles = await findUsersByIds([userId]);
      const profile = profiles.find(({ id }) => id === userId);
      return Object.freeze({
        kind: "sent" as const,
        message: Object.freeze({
          ...message,
          sender: Object.freeze({
            id: userId,
            name: profile?.name || "Former member",
            image: profile?.image ?? null
          })
        })
      });
    } catch (error: unknown) {
      if (isStorageUnavailable(error)) return Object.freeze({ kind: "unavailable" as const });
      throw error;
    }
  }
});
