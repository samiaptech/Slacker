import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Logger } from "@workspace/logging";
import { createErrorHandler } from "../../../middleware/errors.js";
import type { AuthenticationIdentity } from "../../../integrations/authentication/index.js";
import type { ProfileImageStorage } from "../../../integrations/cloudinary/index.js";
import { createProfileImageRoutes } from "../routes/profile-image.route.js";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const identity: AuthenticationIdentity = {
  id: "member-1",
  name: "Member",
  email: "member@example.test",
  image: null
};

const startApi = async (authenticated = true, withStorage = true, updateSucceeds = true) => {
  const persisted: string[] = [];
  let uploadCount = 0;
  const storage: ProfileImageStorage = {
    uploadProfileImage: () => {
      uploadCount += 1;
      return Promise.resolve({
        image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg",
        publicId: "profile"
      });
    },
    deleteProfileImage: () => Promise.resolve()
  };
  const app = express();
  app.use(createProfileImageRoutes({
    getIdentity: (headers) => Promise.resolve(
      authenticated && headers["x-test-identity"] === "member" ? identity : null
    ),
    updateUserImage: (_headers, image) => {
      if (!updateSucceeds) return Promise.reject(new Error("Better Auth storage failure"));
      persisted.push(image);
      return Promise.resolve();
    },
    ...(withStorage ? { storage } : {})
  }));
  app.use(createErrorHandler({ logger }));
  const server = createHttpServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    persisted,
    get uploadCount() { return uploadCount; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    })
  };
};

const imageForm = (
  name = "avatar.jpg",
  type = "image/jpeg",
  bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]),
  fieldName = "file"
): FormData => {
  const form = new FormData();
  form.append(fieldName, new Blob([bytes], { type }), name);
  return form;
};

void test("accepts authenticated self-service profile image uploads and returns the persisted URL", async (context) => {
  const api = await startApi();
  context.after(async () => { await api.close(); });
  const response = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm()
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    image: "https://res.cloudinary.com/nutshyll/image/upload/profile.jpg"
  });
  assert.deepEqual(api.persisted, ["https://res.cloudinary.com/nutshyll/image/upload/profile.jpg"]);
  assert.equal(api.uploadCount, 1);
});

void test("rejects unauthenticated requests before parsing or uploading the file", async (context) => {
  const api = await startApi(false);
  context.after(async () => { await api.close(); });
  const response = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    body: imageForm()
  });

  assert.equal(response.status, 401);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "unauthenticated");
  assert.equal(api.uploadCount, 0);
});

void test("returns a stable unavailable error when Cloudinary is not configured", async (context) => {
  const api = await startApi(true, false);
  context.after(async () => { await api.close(); });
  const response = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm()
  });

  assert.equal(response.status, 503);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "profile_image_storage_unavailable");
  assert.deepEqual(api.persisted, []);
});

void test("returns a stable persistence error when Better Auth cannot update the user", async (context) => {
  const api = await startApi(true, true, false);
  context.after(async () => { await api.close(); });
  const response = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm()
  });

  assert.equal(response.status, 500);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "profile_image_update_failed");
  assert.deepEqual(api.persisted, []);
});

void test("returns stable validation errors for unsupported files and oversized payloads", async (context) => {
  const api = await startApi();
  context.after(async () => { await api.close(); });
  const unsupported = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm("avatar.svg", "image/svg+xml", Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))
  });
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await unsupported.json(), {
    error: {
      code: "validation_error",
      message: "Request validation failed.",
      details: { field: "file", reason: "unsupported_file_type" }
    }
  });

  const unexpectedField = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm("avatar.jpg", "image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff]), "avatar")
  });
  assert.equal(unexpectedField.status, 400);
  assert.deepEqual(
    (await unexpectedField.json() as { error: { details: { reason: string } } }).error.details,
    { field: "file", reason: "invalid_file_count_or_field" }
  );

  const oversized = await fetch(`${api.url}/profile/image`, {
    method: "POST",
    headers: { "x-test-identity": "member" },
    body: imageForm("avatar.jpg", "image/jpeg", (() => {
      const buffer = new Uint8Array(5 * 1024 * 1024 + 1);
      buffer.set([0xff, 0xd8, 0xff]);
      return buffer;
    })())
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual((await oversized.json() as { error: { details: { reason: string } } }).error.details, {
    field: "file",
    reason: "file_too_large"
  });
  assert.equal(api.uploadCount, 0);
});
