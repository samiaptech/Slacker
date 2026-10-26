import type { IncomingHttpHeaders } from "node:http";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import { createApplicationError } from "../../../errors/index.js";
import type { ChatAttachmentIntegration } from "../../../integrations/index.js";
import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENT_MAX_FILES } from "../../../integrations/cloudinary/index.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import {
  createChannelController,
  createGetChannelController,
  createUpdateChannelController,
  createJoinChannelController,
  createLeaveChannelController,
  createInviteChannelMemberController,
  createListChannelMembersController,
  createRemoveChannelMemberController,
  createListChannelsController,
  createListChannelMessagesController,
  createDeleteChannelMessageController,
  createAuthorizeChannelMessageUploadController,
  createSendChannelMessageController,
  createDownloadChannelAttachmentController,
  type ChannelWorkspaceAccessResult,
  type ChannelMemberEmailVisibilityResult,
  type ChannelWorkspaceIdentity
} from "../controllers/index.js";
import type { ChannelService } from "../services/index.js";
import type { ChannelMessageService } from "../services/index.js";
import type { ChannelRealtimePublisher } from "../realtime/index.js";
import type { NotificationService } from "../../notifications/public/index.js";

export type ChannelRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<ChannelWorkspaceIdentity | null>;
  getWorkspaceAccess: (identity: ChannelWorkspaceIdentity | null, workspaceId: string | null) => Promise<ChannelWorkspaceAccessResult>;
  getMemberEmailVisibility: (
    identity: ChannelWorkspaceIdentity | null,
    workspaceId: string | null
  ) => Promise<ChannelMemberEmailVisibilityResult>;
  service: ChannelService;
  messageService: ChannelMessageService;
  attachmentStorage?: ChatAttachmentIntegration;
  realtime?: ChannelRealtimePublisher;
  notifications?: NotificationService;
}>;

const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES, files: CHAT_ATTACHMENT_MAX_FILES, fields: 1, fieldSize: 16_384, parts: CHAT_ATTACHMENT_MAX_FILES + 1 }
}).array("files", CHAT_ATTACHMENT_MAX_FILES);

const parseMessageAttachments: RequestHandler = (request, response, next) => {
  uploadParser(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: error.code === "LIMIT_FILE_SIZE" ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest,
        details: {
          field: "files",
          reason: error.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_file_count_or_field"
        }
      }));
      return;
    }
    next(error);
  });
};

export const createChannelRoutes = (dependencies: ChannelRouteDependencies): Router => {
  const router = Router();
  router.post("/channels", createChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    createChannel: dependencies.service.create,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
  }));
  router.get("/channels", createListChannelsController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    listChannels: dependencies.service.listChannels
  }));
  router.get("/channels/:channelId", createGetChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    getChannelForMember: dependencies.service.getForMember
  }));
  router.patch("/channels/:channelId", createUpdateChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    updateChannel: dependencies.service.update,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  router.get("/channels/:channelId/messages", createListChannelMessagesController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    service: dependencies.messageService,
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  const messageDependencies = {
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    service: dependencies.messageService,
    ...(dependencies.attachmentStorage ? { attachmentStorage: dependencies.attachmentStorage } : {}),
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  };
  router.post(
    "/channels/:channelId/messages",
    createAuthorizeChannelMessageUploadController(messageDependencies),
    parseMessageAttachments,
    createSendChannelMessageController(messageDependencies)
  );
  router.delete(
    "/channels/:channelId/messages/:messageId",
    createDeleteChannelMessageController(messageDependencies)
  );
  router.get(
    "/channels/:channelId/messages/:messageId/attachments/:attachmentId",
    createDownloadChannelAttachmentController({
      getIdentity: dependencies.getIdentity,
      getWorkspaceAccess: dependencies.getWorkspaceAccess,
      service: dependencies.messageService,
      ...(dependencies.attachmentStorage ? { attachmentStorage: dependencies.attachmentStorage } : {})
    })
  );
  router.post("/channels/:channelId/memberships", createJoinChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    joinPublicChannel: dependencies.service.joinPublicChannel,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  router.delete("/channels/:channelId/memberships", createLeaveChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    leaveChannel: dependencies.service.leaveChannel,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  router.get("/channels/:channelId/memberships", createListChannelMembersController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    getMemberEmailVisibility: dependencies.getMemberEmailVisibility,
    listMembers: dependencies.service.listMembers
  }));
  router.post("/channels/:channelId/invitations", createInviteChannelMemberController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    inviteMember: dependencies.service.inviteMember,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  router.delete("/channels/:channelId/memberships/:userId", createRemoveChannelMemberController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    removeMember: dependencies.service.removeMember,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {}),
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  }));
  return router;
};
