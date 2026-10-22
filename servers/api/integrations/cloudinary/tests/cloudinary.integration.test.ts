import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCloudinaryFormat } from "../cloudinary.integration.js";

void test("uses the validated file extension when Cloudinary omits the asset format", () => {
  assert.equal(normalizeCloudinaryFormat(null, "Report.PDF"), "pdf");
  assert.equal(normalizeCloudinaryFormat(undefined, "notes.MD"), "md");
});

void test("preserves the provider format when Cloudinary returns one", () => {
  assert.equal(normalizeCloudinaryFormat("jpg", "photo.jpeg"), "jpg");
});

void test("rejects missing provider formats when a filename has no extension", () => {
  assert.throws(
    () => normalizeCloudinaryFormat(null, "attachment"),
    /must have a file extension/
  );
});
