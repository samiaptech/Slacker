import type { ChatAttachmentRecord } from "../../../types/chat/index.js";

export const CHANNEL_MESSAGE_MAX_LENGTH = 4_000;
export const CHANNEL_MESSAGE_PAGE_SIZE_DEFAULT = 50;
export const CHANNEL_MESSAGE_PAGE_SIZE_MAX = 100;

export type ChannelMessage = Readonly<{
  id: string;
  channelId: string;
  senderId: string;
  text: string;
  createdAt: Date;
  attachments?: readonly ChatAttachmentRecord[];
}>;

export type ChannelMessageDeleteScope = "me" | "everyone";

export type ChannelMessageCursor = Readonly<{
  createdAt: Date;
  id: string;
}>;

export type ChannelMessagePageQuery = Readonly<{
  pageSize: number;
  before: ChannelMessageCursor | null;
}>;

export type ChannelMessageTextResult =
  | Readonly<{ ok: true; text: string }>
  | Readonly<{ ok: false; error: "message_required" | "message_too_long" }>;

export const validateChannelMessageText = (text: string): ChannelMessageTextResult => {
  if (text.trim().length === 0) return Object.freeze({ ok: false, error: "message_required" });
  if (Array.from(text).length > CHANNEL_MESSAGE_MAX_LENGTH) {
    return Object.freeze({ ok: false, error: "message_too_long" });
  }
  return Object.freeze({ ok: true, text });
};

export type ChannelMessageCursorDecodeResult =
  | Readonly<{ ok: true; cursor: ChannelMessageCursor }>
  | Readonly<{ ok: false }>;

export const encodeChannelMessageCursor = (cursor: ChannelMessageCursor): string =>
  Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id }), "utf8")
    .toString("base64url");

export const decodeChannelMessageCursor = (value: string): ChannelMessageCursorDecodeResult => {
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return Object.freeze({ ok: false });
  }
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
