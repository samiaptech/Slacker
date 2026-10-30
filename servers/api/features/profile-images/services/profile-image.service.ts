import type { IncomingHttpHeaders } from "node:http";
import type {
  ProfileImageAsset,
  ProfileImageStorage
} from "../../../integrations/cloudinary/index.js";
import {
  validateProfileImageUpload,
  type ProfileImageUploadInput,
  type ProfileImageValidationReason
} from "../validation/profile-image.validation.js";

export type ProfileImageUpdateResult =
  | Readonly<{ kind: "updated"; image: string }>
  | Readonly<{ kind: "invalid"; reason: ProfileImageValidationReason }>
  | Readonly<{ kind: "storage-unavailable" }>
  | Readonly<{ kind: "update-failed" }>;

export type ProfileImageService = Readonly<{
  update: (headers: IncomingHttpHeaders, input: ProfileImageUploadInput) => Promise<ProfileImageUpdateResult>;
}>;

export type ProfileImageServiceDependencies = Readonly<{
  updateUserImage: (headers: IncomingHttpHeaders, image: string) => Promise<void>;
  storage?: ProfileImageStorage;
}>;

export const createProfileImageService = ({
  updateUserImage,
  storage
}: ProfileImageServiceDependencies): ProfileImageService => Object.freeze({
  update: async (headers, input): Promise<ProfileImageUpdateResult> => {
    const validation = validateProfileImageUpload(input);
    if (!validation.ok) return Object.freeze({ kind: "invalid", reason: validation.reason });
    if (!storage) return Object.freeze({ kind: "storage-unavailable" });

    let asset: ProfileImageAsset;
    try {
      asset = await storage.uploadProfileImage(validation.image.buffer);
    } catch {
      return Object.freeze({ kind: "storage-unavailable" });
    }

    try {
      await updateUserImage(headers, asset.image);
      return Object.freeze({ kind: "updated", image: asset.image });
    } catch {
      try {
        await storage.deleteProfileImage(asset);
      } catch {
        return Object.freeze({ kind: "update-failed" });
      }
      return Object.freeze({ kind: "update-failed" });
    }
  }
});
