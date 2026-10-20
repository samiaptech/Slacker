import type { ChannelMessage, ChannelMessagePageQuery } from "../domain/index.js";
import { isChannelStorageUnavailableError } from "../repositories/index.js";
import type { ChannelMessageRepository } from "../repositories/index.js";
import { validateChannelMessageText } from "../domain/index.js";

export type ChannelMessageSender = Readonly<{
  id: string;
  name: string;
  image: string | null;
}>;

export type ChannelMessageWithSender = ChannelMessage & Readonly<{ sender: ChannelMessageSender }>;

export type ChannelMessagePageResult =
  | Readonly<{ kind: "listed"; messages: readonly ChannelMessageWithSender[]; nextCursor: string | null }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type SendChannelMessageResult =
  | Readonly<{ kind: "sent"; message: ChannelMessageWithSender }>
  | Readonly<{ kind: "invalid"; error: "message_required" | "message_too_long" }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type ChannelMessageService = ReturnType<typeof createChannelMessageService>;

type ChannelMessageServiceDependencies = Readonly<{
  repository: ChannelMessageRepository;
  createId: () => string;
  now: () => Date;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>[]>;
}>;

export const createChannelMessageService = ({
  repository,
  createId,
  now,
  findUsersByIds
}: ChannelMessageServiceDependencies) => Object.freeze({
  list: async (
    workspaceId: string,
    channelId: string,
    userId: string,
    query: ChannelMessagePageQuery
  ): Promise<ChannelMessagePageResult> => {
    try {
      const result = await repository.findForMember(workspaceId, channelId, userId, query);
      if (result.kind !== "listed") return result;
      const profiles = await findUsersByIds([...new Set(result.messages.map(({ senderId }) => senderId))]);
      const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
      return Object.freeze({
        kind: "listed",
        nextCursor: result.nextCursor,
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
        }))
      });
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  send: async (
    workspaceId: string,
    channelId: string,
    userId: string,
    text: string
  ): Promise<SendChannelMessageResult> => {
    const validated = validateChannelMessageText(text);
    if (!validated.ok) return Object.freeze({ kind: "invalid", error: validated.error });
    const message: ChannelMessage = Object.freeze({
      id: createId(),
      channelId,
      senderId: userId,
      text: validated.text,
      createdAt: now()
    });
    try {
      const result = await repository.createForMember(workspaceId, channelId, userId, message);
      if (result !== "created") return Object.freeze({ kind: "channel-unavailable" });
      const profiles = await findUsersByIds([userId]);
      const profile = profiles.find((candidate) => candidate.id === userId);
      return Object.freeze({
        kind: "sent",
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
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  }
});
