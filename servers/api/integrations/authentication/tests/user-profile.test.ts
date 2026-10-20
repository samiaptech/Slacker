import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { toAuthenticationIdentity, toMongoUserIdCandidates } from "../user-profile.js";

void test("normalizes MongoDB ObjectId user profiles to membership string IDs", () => {
  const userId = new Types.ObjectId("507f1f77bcf86cd799439011");

  assert.deepEqual(toAuthenticationIdentity({
    _id: userId,
    name: "Workspace Member",
    email: "member@example.test"
  }), {
    id: userId.toHexString(),
    name: "Workspace Member",
    email: "member@example.test",
    image: null
  });
});

void test("queries user documents using MongoDB ObjectIds and legacy string IDs", () => {
  const userId = "507f1f77bcf86cd799439011";
  const candidates = toMongoUserIdCandidates([userId, "legacy-user-id"]);
  const objectIdCandidate = candidates[1];

  assert.equal(candidates[0], userId);
  assert.ok(objectIdCandidate instanceof Types.ObjectId);
  assert.equal(objectIdCandidate.toHexString(), userId);
  assert.equal(candidates[2], "legacy-user-id");
});
