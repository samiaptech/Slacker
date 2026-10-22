import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { v2 as cloudinary, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import type { ChatAttachmentRecord } from "../../types/chat/index.js";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  validateChatAttachment,
  type ChatAttachmentFileInput
} from "./chat-attachment.validation.js";

export type CloudinaryConfiguration = Readonly<{
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}>;

export type ChatAttachmentUpload = ChatAttachmentFileInput;

export type ChatAttachmentIntegration = Readonly<{
  upload: (input: ChatAttachmentUpload) => Promise<ChatAttachmentRecord>;
  delete: (attachment: ChatAttachmentRecord) => Promise<void>;
  download: (attachment: ChatAttachmentRecord) => Promise<Buffer>;
}>;

const uploadBuffer = (
  buffer: Buffer,
  options: UploadApiOptions
): Promise<UploadApiResponse> => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
    if (error) reject(new Error(error.message));
    else if (!result) reject(new Error("Cloudinary completed an upload without returning an asset."));
    else resolve(result);
  });
  stream.end(buffer);
});

export const normalizeCloudinaryFormat = (format: unknown, fileName: string): string => {
  if (typeof format === "string" && format.trim().length > 0) return format;
  const extension = extname(fileName).slice(1).toLowerCase();
  if (extension.length === 0) {
    throw new Error("A validated chat attachment must have a file extension.");
  }
  return extension;
};

export const createCloudinaryIntegration = (
  configuration: CloudinaryConfiguration
): ChatAttachmentIntegration => {
  cloudinary.config({
    cloud_name: configuration.cloudName,
    api_key: configuration.apiKey,
    api_secret: configuration.apiSecret,
    secure: true
  });

  return Object.freeze({
    upload: async (input) => {
      const validated = validateChatAttachment(input);
      if (!validated.ok) {
        throw Object.assign(new Error(validated.reason), {
          kind: "invalid-chat-attachment" as const,
          reason: validated.reason
        });
      }
      const result = await uploadBuffer(input.buffer, {
        folder: "nutshyll/chat",
        public_id: randomUUID(),
        resource_type: validated.file.resourceType,
        type: "authenticated",
        overwrite: false,
        use_filename: false,
        unique_filename: false
      });
      return Object.freeze({
        id: randomUUID(),
        name: validated.file.name,
        mimeType: validated.file.mimeType,
        size: input.buffer.byteLength,
        publicId: result.public_id,
        resourceType: validated.file.resourceType,
        format: normalizeCloudinaryFormat(result.format, validated.file.name)
      });
    },
    delete: async (attachment) => {
      const result: unknown = await cloudinary.uploader.destroy(attachment.publicId, {
        resource_type: attachment.resourceType,
        type: "authenticated",
        invalidate: true
      });
      const status = typeof result === "object" && result !== null
        && "result" in result && typeof result.result === "string"
        ? result.result
        : null;
      if (status !== "ok" && status !== "not found") {
        throw new Error(`Cloudinary asset cleanup failed with status "${status ?? "unknown"}".`);
      }
    },
    download: async (attachment) => {
      const url = cloudinary.utils.private_download_url(
        attachment.publicId,
        attachment.format,
        {
          resource_type: attachment.resourceType,
          type: "authenticated",
          expires_at: Math.floor(Date.now() / 1000) + 60,
          attachment: true
        }
      );
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        throw new Error(`Cloudinary download failed with status ${String(response.status)}.`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
        throw new Error("Cloudinary returned an attachment larger than the configured limit.");
      }
      return buffer;
    }
  });
};
