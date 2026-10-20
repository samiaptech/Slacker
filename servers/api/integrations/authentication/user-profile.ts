import { Types } from "mongoose";

export type AuthenticationUserDocument = Readonly<{
  _id?: string | Types.ObjectId;
  id?: string;
  name: string;
  title?: string | null;
  email: string;
  image?: string | null;
}>;

export const toAuthenticationIdentity = (
  user: AuthenticationUserDocument
): Readonly<{ id: string; name: string; title?: string | null; email: string; image: string | null }> | null => {
  const id = user.id ?? (user._id instanceof Types.ObjectId ? user._id.toHexString() : user._id);
  if (!id || !user.name || !user.email) return null;
  return Object.freeze({
    id,
    name: user.name,
    ...(user.title !== undefined ? { title: user.title } : {}),
    email: user.email,
    image: user.image ?? null
  });
};

export const toMongoUserIdCandidates = (userIds: readonly string[]): readonly (string | Types.ObjectId)[] =>
  Object.freeze([...new Set(userIds.flatMap((id) =>
    Types.ObjectId.isValid(id) ? [id, new Types.ObjectId(id)] : [id]
  ))]);
