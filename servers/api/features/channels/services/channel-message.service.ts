import {
  CHANNEL_MESSAGE_MAX_LENGTH,
  type ChannelMessage,
  type ChannelMessageDeleteScope,
  type ChannelMessagePageQuery
} from "../domain/index.js";
import type { ChatAttachmentRecord } from "../../../types/chat/index.js";
import type { ChatAttachmentIntegration, ChatAttachmentUpload } from "../../../integrations/index.js";
import { isChannelStorageUnavailableError } from "../repositories/index.js";
import type { ChannelMessageRepository } from "../repositories/index.js";
import { validateChannelMessageText } from "../domain/index.js";
import {
  CHAT_ATTACHMENT_MAX_FILES,
  isChatAttachmentValidationError
} from "../../../integrations/cloudinary/index.js";

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

export type DeleteChannelMessageResult =
  | Readonly<{ kind: "deleted" }>
  | Readonly<{ kind: "attachment-cleanup-failed" }>
  | Readonly<{ kind: "not-found" | "forbidden" | "unavailable" }>;

export type SendChannelMessageResult =
  | Readonly<{ kind: "sent"; message: ChannelMessageWithSender }>
  | Readonly<{
    kind: "invalid";
    error: "message_required" | "message_too_long" | "attachment_limit_exceeded"
      | "unsupported_file_type" | "invalid_file_content" | "file_too_large";
  }>
  | Readonly<{ kind: "channel-unavailable" }>
  | Readonly<{ kind: "attachment-unavailable" }>
  | Readonly<{ kind: "unavailable" }>;

export type ChannelMessageService = ReturnType<typeof createChannelMessageService>;

type ChannelMessageServiceDependencies = Readonly<{
  repository: ChannelMessageRepository;
  attachmentStorage?: ChatAttachmentIntegration;
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
  attachmentStorage,
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
    text: string,
    files: readonly ChatAttachmentUpload[] = [],
    senderProfile?: Omit<ChannelMessageSender, "id">
  ): Promise<SendChannelMessageResult> => {
    if (files.length > CHAT_ATTACHMENT_MAX_FILES) {
      return Object.freeze({ kind: "invalid", error: "attachment_limit_exceeded" });
    }
    const validated = files.length > 0
      ? (Array.from(text).length > CHANNEL_MESSAGE_MAX_LENGTH
        ? Object.freeze({ ok: false as const, error: "message_too_long" as const })
        : Object.freeze({ ok: true as const, text }))
      : validateChannelMessageText(text);
    if (!validated.ok) return Object.freeze({ kind: "invalid", error: validated.error });
    const storage = attachmentStorage;
    const uploaded: ChatAttachmentRecord[] = [];
    const removeUploaded = async (): Promise<void> => {
      if (!storage || uploaded.length === 0) return;
      const results = await Promise.allSettled(uploaded.map((attachment) => storage.delete(attachment)));
      const failures: Error[] = [];
      for (const result of results) {
        if (result.status === "rejected") {
          failures.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "One or more uploaded channel attachments could not be removed.");
      }
    };
    let persisted = false;
    try {
      if (files.length > 0) {
        if (!storage) return Object.freeze({ kind: "attachment-unavailable" });
        const authorized = await repository.findForMember(
          workspaceId,
          channelId,
          userId,
          { pageSize: 1, before: null }
        );
        if (authorized.kind !== "listed") return Object.freeze({ kind: "channel-unavailable" });
        for (const file of files) uploaded.push(await storage.upload(file));
      }
      const message: ChannelMessage = Object.freeze({
        id: createId(),
        channelId,
        senderId: userId,
        text: files.length > 0 && validated.text.trim().length === 0 ? "" : validated.text,
        createdAt: now(),
        ...(uploaded.length > 0 ? { attachments: Object.freeze([...uploaded]) } : {})
      });
      const result = await repository.createForMember(workspaceId, channelId, userId, message);
      if (result !== "created") {
        await removeUploaded();
        return Object.freeze({ kind: "channel-unavailable" });
      }
      persisted = true;
      const profile = senderProfile ?? (await findUsersByIds([userId]))
        .find((candidate) => candidate.id === userId);
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
      if (!persisted) await removeUploaded();
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      if (isChatAttachmentValidationError(error)) {
        return Object.freeze({ kind: "invalid", error: error.reason });
      }
      throw error;
    }
  },
  getAttachment: async (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    attachmentId: string
  ): Promise<Readonly<{ kind: "found"; attachment: ChatAttachmentRecord }> | Readonly<{ kind: "not-found" }> | Readonly<{ kind: "unavailable" }>> => {
    try {
      const attachment = await repository.findAttachmentForMember?.(
        workspaceId,
        channelId,
        userId,
        messageId,
        attachmentId
      ) ?? null;
      return attachment
        ? Object.freeze({ kind: "found", attachment })
        : Object.freeze({ kind: "not-found" });
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  },
  delete: async (
    workspaceId: string,
    channelId: string,
    userId: string,
    messageId: string,
    scope: ChannelMessageDeleteScope,
    isWorkspaceAdmin: boolean
  ): Promise<DeleteChannelMessageResult> => {
    try {
      const result = await repository.deleteForMember(
        workspaceId,
        channelId,
        userId,
        messageId,
        scope,
        isWorkspaceAdmin
      );
      if (result.kind !== "deleted") return result;
      if (scope === "me" || result.attachments.length === 0) return Object.freeze({ kind: "deleted" });
      if (!attachmentStorage) return Object.freeze({ kind: "attachment-cleanup-failed" });
      const cleanup = await Promise.allSettled(result.attachments.map(async (attachment) =>
        attachmentStorage.delete(attachment)));
      return cleanup.some(({ status }) => status === "rejected")
        ? Object.freeze({ kind: "attachment-cleanup-failed" })
        : Object.freeze({ kind: "deleted" });
    } catch (error: unknown) {
      if (isChannelStorageUnavailableError(error)) return Object.freeze({ kind: "unavailable" });
      throw error;
    }
  }
});
