import { extname } from "node:path";

export const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export type ProfileImageUploadInput = Readonly<{
  buffer: Buffer;
  name: string;
  mimeType: string;
  size: number;
}>;

export type ProfileImageValidationReason =
  | "file_too_large"
  | "unsupported_file_type"
  | "invalid_file_content";

export type ValidatedProfileImage = Readonly<{
  buffer: Buffer;
}>;

export type ProfileImageValidationResult =
  | Readonly<{ ok: true; image: ValidatedProfileImage }>
  | Readonly<{ ok: false; reason: ProfileImageValidationReason }>;

const isJpeg = (buffer: Buffer): boolean =>
  buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

const isPng = (buffer: Buffer): boolean =>
  buffer.length >= 8
  && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

const isWebp = (buffer: Buffer): boolean =>
  buffer.length >= 12
  && buffer.toString("ascii", 0, 4) === "RIFF"
  && buffer.toString("ascii", 8, 12) === "WEBP";

export const validateProfileImageUpload = (
  input: ProfileImageUploadInput
): ProfileImageValidationResult => {
  if (input.size > PROFILE_IMAGE_MAX_BYTES || input.buffer.byteLength > PROFILE_IMAGE_MAX_BYTES) {
    return Object.freeze({ ok: false, reason: "file_too_large" });
  }
  if (input.size === 0 || input.buffer.byteLength === 0) {
    return Object.freeze({ ok: false, reason: "invalid_file_content" });
  }

  const extension = extname(input.name).toLowerCase();
  const matches = (extension === ".jpg" || extension === ".jpeg")
    ? input.mimeType === "image/jpeg" && isJpeg(input.buffer)
    : extension === ".png"
      ? input.mimeType === "image/png" && isPng(input.buffer)
      : extension === ".webp"
        ? input.mimeType === "image/webp" && isWebp(input.buffer)
        : false;

  if (matches) return Object.freeze({ ok: true, image: Object.freeze({ buffer: input.buffer }) });
  const supportedExtension = [".jpg", ".jpeg", ".png", ".webp"].includes(extension);
  const supportedMimeType = ["image/jpeg", "image/png", "image/webp"].includes(input.mimeType);
  return Object.freeze({
    ok: false,
    reason: supportedExtension && supportedMimeType ? "invalid_file_content" : "unsupported_file_type"
  });
};
