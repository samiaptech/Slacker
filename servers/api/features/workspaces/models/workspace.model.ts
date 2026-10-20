export const WORKSPACES_COLLECTION = "workspaces";
export const WORKSPACE_MEMBERSHIPS_COLLECTION = "workspace_memberships";
export const WORKSPACE_INVITE_LINKS_COLLECTION = "workspace_invite_links";

export type WorkspaceDocument = Readonly<{
  _id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  memberEmailsVisible?: boolean;
  membershipRevision?: number;
}>;

export type WorkspaceMembershipDocument = Readonly<{
  _id: string;
  workspaceId: string;
  userId: string;
  role: "admin" | "member";
  joinedAt: Date;
}>;

export type WorkspaceInviteLinkDocument = Readonly<{
  _id: string;
  workspaceId: string;
  createdBy: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}>;

const stringId = Object.freeze({ bsonType: "string", minLength: 1 });

export const WORKSPACE_COLLECTION_VALIDATORS = Object.freeze({
  [WORKSPACES_COLLECTION]: Object.freeze({
    $jsonSchema: Object.freeze({
      bsonType: "object",
      required: ["_id", "name", "createdBy", "createdAt"],
      additionalProperties: false,
      properties: Object.freeze({
        _id: stringId,
        name: Object.freeze({ bsonType: "string", minLength: 1, maxLength: 80 }),
        createdBy: stringId,
        createdAt: Object.freeze({ bsonType: "date" }),
        memberEmailsVisible: Object.freeze({ bsonType: "bool" }),
        membershipRevision: Object.freeze({ bsonType: "int", minimum: 0 })
      })
    })
  }),
  [WORKSPACE_MEMBERSHIPS_COLLECTION]: Object.freeze({
    $jsonSchema: Object.freeze({
      bsonType: "object",
      required: ["_id", "workspaceId", "userId", "role", "joinedAt"],
      additionalProperties: false,
      properties: Object.freeze({
        _id: stringId,
        workspaceId: stringId,
        userId: stringId,
        role: Object.freeze({ enum: ["admin", "member"] }),
        joinedAt: Object.freeze({ bsonType: "date" })
      })
    })
  }),
  [WORKSPACE_INVITE_LINKS_COLLECTION]: Object.freeze({
    $jsonSchema: Object.freeze({
      bsonType: "object",
      required: ["_id", "workspaceId", "createdBy", "tokenHash", "createdAt", "expiresAt"],
      additionalProperties: false,
      properties: Object.freeze({
        _id: stringId,
        workspaceId: stringId,
        createdBy: stringId,
        tokenHash: Object.freeze({ bsonType: "string", minLength: 64, maxLength: 64 }),
        createdAt: Object.freeze({ bsonType: "date" }),
        expiresAt: Object.freeze({ bsonType: "date" })
      })
    })
  })
});

export const WORKSPACE_INDEXES = Object.freeze({
  [WORKSPACES_COLLECTION]: Object.freeze([
    Object.freeze({
      keys: Object.freeze({ createdBy: 1, createdAt: 1 }),
      options: Object.freeze({ name: "workspaces_created_by" })
    })
  ]),
  [WORKSPACE_MEMBERSHIPS_COLLECTION]: Object.freeze([
    Object.freeze({
      keys: Object.freeze({ workspaceId: 1, userId: 1 }),
      options: Object.freeze({ name: "workspace_membership_unique", unique: true })
    }),
    Object.freeze({
      keys: Object.freeze({ userId: 1, joinedAt: 1 }),
      options: Object.freeze({ name: "user_workspace_memberships" })
    })
  ]),
  [WORKSPACE_INVITE_LINKS_COLLECTION]: Object.freeze([
    Object.freeze({
      keys: Object.freeze({ tokenHash: 1 }),
      options: Object.freeze({ name: "workspace_invite_token_unique", unique: true })
    }),
    Object.freeze({
      keys: Object.freeze({ expiresAt: 1 }),
      options: Object.freeze({ name: "workspace_invite_expiry", expireAfterSeconds: 0 })
    })
  ])
});
