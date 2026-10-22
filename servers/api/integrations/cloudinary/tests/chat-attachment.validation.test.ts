import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  validateChatAttachment
} from "../index.js";

void test("accepts allowed image, PDF, and text formats using content signatures", () => {
  const png = validateChatAttachment({
    name: "folder\\image.png",
    size: 8,
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  });
  assert.deepEqual(png, {
    ok: true,
    file: { name: "image.png", mimeType: "image/png", resourceType: "image" }
  });
  assert.equal(validateChatAttachment({
    name: "report.pdf",
    size: 5,
    buffer: Buffer.from("%PDF-")
  }).ok, true);
  assert.equal(validateChatAttachment({
    name: "notes.md",
    size: 7,
    buffer: Buffer.from("# Notes")
  }).ok, true);
});

void test("rejects executables, SVG, mismatched signatures, and invalid text", () => {
  for (const name of ["program.exe", "image.svg", "image.jpg"]) {
    assert.deepEqual(validateChatAttachment({
      name,
      size: 12,
      buffer: Buffer.from("<script>x</script>")
    }).ok, false);
  }
  assert.deepEqual(validateChatAttachment({
    name: "malformed.txt",
    size: 2,
    buffer: Buffer.from([0x61, 0x00])
  }), { ok: false, reason: "invalid_file_content" });
});

void test("rejects empty and oversized files", () => {
  assert.deepEqual(validateChatAttachment({
    name: "empty.txt",
    size: 0,
    buffer: Buffer.alloc(0)
  }), { ok: false, reason: "invalid_file_content" });
  assert.deepEqual(validateChatAttachment({
    name: "large.txt",
    size: CHAT_ATTACHMENT_MAX_BYTES + 1,
    buffer: Buffer.alloc(1)
  }), { ok: false, reason: "file_too_large" });
});
