import test from "node:test";
import assert from "node:assert/strict";
import { createProfileImageService } from "../services/profile-image.service.js";
import {
  PROFILE_IMAGE_MAX_BYTES,
  validateProfileImageUpload
} from "../validation/profile-image.validation.js";
import type { ProfileImageStorage } from "../../../integrations/cloudinary/index.js";

const headers = { cookie: "session=test" };
const validJpeg = Object.freeze({
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  name: "avatar.jpg",
  mimeType: "image/jpeg",
  size: 4
});

void test("accepts JPEG, PNG, and WebP signatures through the 5 MiB limit", () => {
  const supported = [
    { name: "avatar.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
    {
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    },
    { name: "avatar.webp", mimeType: "image/webp", buffer: Buffer.from("RIFF0000WEBP") }
  ];
  for (const file of supported) {
    assert.equal(validateProfileImageUpload({ ...file, size: file.buffer.byteLength }).ok, true);
  }
  const maxSizePng = Buffer.alloc(PROFILE_IMAGE_MAX_BYTES);
  maxSizePng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(validateProfileImageUpload({
    name: "avatar.png",
    mimeType: "image/png",
    size: maxSizePng.byteLength,
    buffer: maxSizePng
  }).ok, true);
});

void test("uploads a validated image and persists its display URL for the signed-in user", async () => {
  const persisted: string[] = [];
  const storage: ProfileImageStorage = {
    uploadProfileImage: () => Promise.resolve({
      image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg",
      publicId: "profile"
    }),
    deleteProfileImage: () => Promise.resolve()
  };
  const service = createProfileImageService({
    storage,
    updateUserImage: (_headers, image) => {
      persisted.push(image);
      return Promise.resolve();
    }
  });

  const result = await service.update(headers, validJpeg);

  assert.deepEqual(result, {
    kind: "updated",
    image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg"
  });
  assert.deepEqual(persisted, ["https://res.cloudinary.com/nutshyll/image/upload/profile.jpg"]);
});

void test("does not call storage for unsupported or forged image content", async () => {
  let uploadCount = 0;
  const storage: ProfileImageStorage = {
    uploadProfileImage: () => {
      uploadCount += 1;
      return Promise.resolve({ image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg", publicId: "profile" });
    },
    deleteProfileImage: () => Promise.resolve()
  };
  const service = createProfileImageService({ storage, updateUserImage: () => Promise.resolve() });

  assert.deepEqual(await service.update(headers, {
    ...validJpeg,
    name: "avatar.svg",
    mimeType: "image/svg+xml"
  }), { kind: "invalid", reason: "unsupported_file_type" });
  assert.deepEqual(await service.update(headers, {
    ...validJpeg,
    buffer: Buffer.from("<svg></svg>"),
    size: 11
  }), { kind: "invalid", reason: "invalid_file_content" });
  assert.equal(uploadCount, 0);
});

void test("removes a newly uploaded asset if Better Auth cannot persist the image", async () => {
  const deleted: string[] = [];
  const storage: ProfileImageStorage = {
    uploadProfileImage: () => Promise.resolve({
      image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg",
      publicId: "profile"
    }),
    deleteProfileImage: (asset) => {
      deleted.push(asset.publicId);
      return Promise.resolve();
    }
  };
  const service = createProfileImageService({
    storage,
    updateUserImage: () => Promise.reject(new Error("storage failure"))
  });

  assert.deepEqual(await service.update(headers, validJpeg), { kind: "update-failed" });
  assert.deepEqual(deleted, ["profile"]);
});
