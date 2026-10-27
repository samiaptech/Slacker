import type { ChatAttachmentResponse, MessageReactionResponse } from "../chat/index.js";

export type DirectConversationResponse = Readonly<{
  id: string;
  workspaceId: string;
  otherParticipant: Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>;
  createdAt: string;
  lastActivityAt: string;
}>;

export type DirectConversationListResponse = Readonly<{
  conversations: readonly DirectConversationResponse[];
}>;

export type DirectMessageResponse = Readonly<{
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  attachments?: readonly ChatAttachmentResponse[];
  reactions: readonly MessageReactionResponse[];
  sender: Readonly<{
    id: string;
    name: string;
    image: string | null;
  }>;
}>;

export type DirectMessageListResponse = Readonly<{
  messages: readonly DirectMessageResponse[];
  nextCursor: string | null;
}>;
