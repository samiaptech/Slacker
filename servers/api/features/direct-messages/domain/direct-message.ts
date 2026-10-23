import type { ChatAttachmentRecord } from "../../../types/chat/index.js";

export const DIRECT_MESSAGE_MAX_LENGTH = 4_000;
export const DIRECT_MESSAGE_PAGE_SIZE_DEFAULT = 50;
export const DIRECT_MESSAGE_PAGE_SIZE_MAX = 100;
export const DIRECT_CONVERSATION_LIST_LIMIT = 50;

export type DirectConversation = Readonly<{
  id: string;
  workspaceId: string;
  pairKey: string;
  participantIds: readonly [string, string];
  createdAt: Date;
  lastActivityAt: Date;
}>;

export type DirectMessage = Readonly<{
  id: string;
  workspaceId: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  attachments?: readonly ChatAttachmentRecord[];
}>;

export type DirectMessageDeleteScope = "me" | "everyone";

export type DirectMessageCursor = Readonly<{ createdAt: Date; id: string }>;
export type DirectMessagePageQuery = Readonly<{
  pageSize: number;
  before: DirectMessageCursor | null;
}>;

export type DirectMessageTextResult =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; error: "message_required" | "message_too_long" }>;

export const createDirectMessagePairKey = (firstUserId: string, secondUserId: string): string =>
  JSON.stringify([firstUserId, secondUserId].sort());

export const validateDirectMessageText = (text: string): DirectMessageTextResult => {
  if (text.trim().length === 0) return Object.freeze({ ok: false, error: "message_required" });
  if (Array.from(text).length > DIRECT_MESSAGE_MAX_LENGTH) {
    return Object.freeze({ ok: false, error: "message_too_long" });
  }
  return Object.freeze({ ok: true, text });
};

export const encodeDirectMessageCursor = (cursor: DirectMessageCursor): string =>
  Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8")
    .toString("base64url");

export type DirectMessageCursorDecodeResult =
  | Readonly<{ ok: true; cursor: DirectMessageCursor }>
  | Readonly<{ ok: false }>;

export const decodeDirectMessageCursor = (value: string): DirectMessageCursorDecodeResult => {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) return Object.freeze({ ok: false });
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof decoded !== "object" || decoded === null || !("createdAt" in decoded)
      || !("id" in decoded) || typeof decoded.createdAt !== "string"
      || typeof decoded.id !== "string" || decoded.id.length === 0 || decoded.id.length > 128) {
      return Object.freeze({ ok: false });
    }
    const createdAt = new Date(decoded.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== decoded.createdAt) {
      return Object.freeze({ ok: false });
    }
    return Object.freeze({ ok: true, cursor: Object.freeze({ createdAt, id: decoded.id }) });
  } catch {
    return Object.freeze({ ok: false });
  }
};
