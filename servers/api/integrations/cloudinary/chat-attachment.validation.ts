import { extname } from "node:path";

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_FILES = 5;

export type ChatAttachmentFileInput = Readonly<{
  buffer: Buffer;
  name: string;
  size: number;
}>;

export type ValidatedChatAttachment = Readonly<{
  name: string;
  mimeType: string;
  resourceType: "image" | "raw";
}>;

export type ChatAttachmentValidationResult =
  | Readonly<{ ok: true; file: ValidatedChatAttachment }>
  | Readonly<{ ok: false; reason: ChatAttachmentValidationErrorReason }>;
export type ChatAttachmentValidationErrorReason =
  | "unsupported_file_type"
  | "invalid_file_content"
  | "file_too_large";

export const isChatAttachmentValidationError = (
  error: unknown
): error is Readonly<{ kind: "invalid-chat-attachment"; reason: ChatAttachmentValidationErrorReason }> =>
  typeof error === "object" && error !== null
  && "kind" in error && error.kind === "invalid-chat-attachment"
  && "reason" in error
  && (error.reason === "unsupported_file_type"
    || error.reason === "invalid_file_content"
    || error.reason === "file_too_large");

const textExtensions = new Set([".txt", ".csv", ".md"]);

const hasTextContent = (buffer: Buffer): boolean => {
  if (buffer.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

const safeName = (name: string): string => {
  const baseName = name.replace(/\\/g, "/").split("/").pop() ?? "";
  return Array.from(baseName)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127;
    })
    .join("")
    .slice(0, 255);
};

export const validateChatAttachment = (
  input: ChatAttachmentFileInput
): ChatAttachmentValidationResult => {
  if (input.size > CHAT_ATTACHMENT_MAX_BYTES || input.buffer.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
    return Object.freeze({ ok: false, reason: "file_too_large" });
  }
  if (input.size === 0 || input.buffer.byteLength === 0) {
    return Object.freeze({ ok: false, reason: "invalid_file_content" });
  }
  const name = safeName(input.name);
  const extension = extname(name).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)
    && input.buffer.length >= 3
    && input.buffer[0] === 0xff && input.buffer[1] === 0xd8 && input.buffer[2] === 0xff) {
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType: "image/jpeg", resourceType: "image" }) });
  }
  if (extension === ".png"
    && input.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType: "image/png", resourceType: "image" }) });
  }
  if (extension === ".gif"
    && ["GIF87a", "GIF89a"].some((signature) => input.buffer.subarray(0, 6).toString("ascii") === signature)) {
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType: "image/gif", resourceType: "image" }) });
  }
  if (extension === ".webp"
    && input.buffer.length >= 12
    && input.buffer.toString("ascii", 0, 4) === "RIFF"
    && input.buffer.toString("ascii", 8, 12) === "WEBP") {
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType: "image/webp", resourceType: "image" }) });
  }
  if (extension === ".pdf" && input.buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType: "application/pdf", resourceType: "raw" }) });
  }
  if (textExtensions.has(extension) && hasTextContent(input.buffer)) {
    const mimeType = extension === ".csv" ? "text/csv" : extension === ".md" ? "text/markdown" : "text/plain";
    return Object.freeze({ ok: true, file: Object.freeze({ name, mimeType, resourceType: "raw" }) });
  }
  return Object.freeze({
    ok: false,
    reason: textExtensions.has(extension) ? "invalid_file_content" : "unsupported_file_type"
  });
};
