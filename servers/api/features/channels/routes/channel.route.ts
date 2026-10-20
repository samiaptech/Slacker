import type { IncomingHttpHeaders } from "node:http";
import { Router } from "express";
import {
  createChannelController,
  createGetChannelController,
  createJoinChannelController,
  createLeaveChannelController,
  createInviteChannelMemberController,
  createListChannelMembersController,
  createRemoveChannelMemberController,
  createListChannelsController,
  createListChannelMessagesController,
  createSendChannelMessageController,
  type ChannelWorkspaceAccessResult,
  type ChannelMemberEmailVisibilityResult,
  type ChannelWorkspaceIdentity
} from "../controllers/index.js";
import type { ChannelService } from "../services/index.js";
import type { ChannelMessageService } from "../services/index.js";
import type { ChannelRealtimePublisher } from "../realtime/index.js";

export type ChannelRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<ChannelWorkspaceIdentity | null>;
  getWorkspaceAccess: (identity: ChannelWorkspaceIdentity | null, workspaceId: string | null) => Promise<ChannelWorkspaceAccessResult>;
  getMemberEmailVisibility: (
    identity: ChannelWorkspaceIdentity | null,
    workspaceId: string | null
  ) => Promise<ChannelMemberEmailVisibilityResult>;
  service: ChannelService;
  messageService: ChannelMessageService;
  realtime?: ChannelRealtimePublisher;
}>;

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
  router.get("/channels/:channelId/messages", createListChannelMessagesController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    service: dependencies.messageService
  }));
  router.post("/channels/:channelId/messages", createSendChannelMessageController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    service: dependencies.messageService,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
  }));
  router.post("/channels/:channelId/memberships", createJoinChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    joinPublicChannel: dependencies.service.joinPublicChannel,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
  }));
  router.delete("/channels/:channelId/memberships", createLeaveChannelController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    leaveChannel: dependencies.service.leaveChannel,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
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
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
  }));
  router.delete("/channels/:channelId/memberships/:userId", createRemoveChannelMemberController({
    getIdentity: dependencies.getIdentity,
    getWorkspaceAccess: dependencies.getWorkspaceAccess,
    removeMember: dependencies.service.removeMember,
    ...(dependencies.realtime ? { realtime: dependencies.realtime } : {})
  }));
  return router;
};
