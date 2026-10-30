import type { IncomingHttpHeaders } from "node:http";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { betterAuth } from "better-auth";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import type { RequestHandler } from "express";
import type { Types } from "mongoose";
import type { ApiConfig } from "../../types/index.js";
import type { MongoDatabase } from "../mongodb/index.js";
import { toAuthenticationIdentity, toMongoUserIdCandidates } from "./user-profile.js";

export type AuthenticationIdentity = Readonly<{
  id: string;
  name: string;
  title?: string | null;
  email: string;
  image: string | null;
}>;

export type AuthenticationIntegration = Readonly<{
  handler: RequestHandler;
  getIdentity: (headers: IncomingHttpHeaders) => Promise<AuthenticationIdentity | null>;
  updateUserImage: (headers: IncomingHttpHeaders, image: string) => Promise<void>;
  findUserByEmail: (email: string) => Promise<AuthenticationIdentity | null>;
  findUsersByIds: (userIds: readonly string[]) => Promise<readonly AuthenticationIdentity[]>;
}>;

type AuthenticationDependencies = Readonly<{
  config: ApiConfig;
  database: MongoDatabase;
}>;

export const createAuthenticationIntegration = ({ config, database }: AuthenticationDependencies): AuthenticationIntegration => {
  type UserDocument = Readonly<{
    _id?: Types.ObjectId | string;
    id?: string;
    name: string;
    title?: string | null;
    email: string;
    image?: string | null;
  }>;
  const users = database.collection<UserDocument>("user");
  const auth = betterAuth({
    appName: "Nutshyll",
    baseURL: config.betterAuthUrl,
    basePath: "/api/auth",
    secret: config.betterAuthSecret,
    database: mongodbAdapter(database),
    trustedOrigins: [config.webOrigin],
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret
      }
    },
    user: {
      additionalFields: {
        title: { type: "string", required: false, input: true }
      },
      validateUserInfo: ({ user, source }) => {
        if (source.oauth?.providerId === "google" && user.email && user.emailVerified) return;
        return {
          error: "workspace_access_denied",
          errorDescription: "A verified Google account is required."
        };
      }
    },
    advanced: {
      useSecureCookies: config.environment === "production"
    }
  });
  const nodeHandler = toNodeHandler(auth);

  return Object.freeze({
    handler: (request, response, next): void => {
      void Promise.resolve(nodeHandler(request, response)).catch(next);
    },
    getIdentity: async (headers): Promise<AuthenticationIdentity | null> => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      if (!session) return null;
      return Object.freeze({
        id: session.user.id,
        name: session.user.name,
        title: session.user.title ?? null,
        email: session.user.email,
        image: session.user.image ?? null
      });
    },
    updateUserImage: async (headers, image): Promise<void> => {
      await auth.api.updateUser({
        headers: fromNodeHeaders(headers),
        body: { image }
      });
    },
    findUserByEmail: async (email): Promise<AuthenticationIdentity | null> => {
      const escapedEmail = email.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const user = await users.findOne({
        email: { $regex: `^${escapedEmail}$`, $options: "i" }
      });
      return user ? toAuthenticationIdentity(user) : null;
    },
    findUsersByIds: async (userIds): Promise<readonly AuthenticationIdentity[]> => {
      if (userIds.length === 0) return [];
      const ids = [...userIds];
      const documents = await users.find({
        $or: [
          { _id: { $in: toMongoUserIdCandidates(ids) } },
          { id: { $in: ids } }
        ]
      }).toArray();
      return Object.freeze(documents.flatMap((user) => {
        const identity = toAuthenticationIdentity(user);
        return identity ? [identity] : [];
      }));
    }
  });
};
