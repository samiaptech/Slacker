import type { MongoDatabase } from "../../../integrations/mongodb/index.js";
import {
  CHANNEL_MEMBERSHIPS_COLLECTION,
  CHANNEL_MESSAGES_COLLECTION,
  CHANNEL_MESSAGES_INDEXES,
  CHANNELS_COLLECTION,
  type ChannelDocument,
  type ChannelMembershipDocument,
  type ChannelMessageDocument
} from "../../channels/public/index.js";
import {
  DIRECT_CONVERSATIONS_COLLECTION,
  DIRECT_MESSAGES_COLLECTION,
  DIRECT_MESSAGES_INDEXES,
  type DirectConversationDocument,
  type DirectMessageDocument
} from "../../direct-messages/public/index.js";
import {
  WORKSPACE_MEMBERSHIPS_COLLECTION,
  type WorkspaceMembershipDocument
} from "../../workspaces/public/index.js";
import type { MessageSearchCandidate, MessageSearchPage } from "../domain/index.js";
import {
  MESSAGE_SEARCH_MAX_PAGE,
  MESSAGE_SEARCH_PAGE_SIZE,
  MESSAGE_SEARCH_TIMEOUT_MS,
  compareMessageSearchCandidates
} from "../domain/index.js";
import type { MessageSearchStorage } from "../repositories/index.js";

type IndexedSearchMessage = Readonly<{
  _id: string;
  channelId?: string;
  conversationId?: string;
  senderId: string;
  text: string;
  createdAt: Date;
  score: number;
  threadRootId?: string;
}>;

const unavailable = Object.assign(new Error("Message search storage is unavailable."), {
  kind: "message-search-storage-unavailable" as const
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasIndex = async (
  collection: Readonly<{
    indexes: () => Promise<readonly Readonly<{ name?: string }> []>
  }>,
  name: string
): Promise<boolean> => (await collection.indexes()).some((index) => index.name === name);

export const createMongoMessageSearchStorage = (database: MongoDatabase): MessageSearchStorage => {
  const memberships = database.collection<ChannelMembershipDocument>(CHANNEL_MEMBERSHIPS_COLLECTION);
  const channels = database.collection<ChannelDocument>(CHANNELS_COLLECTION);
  const channelMessages = database.collection<ChannelMessageDocument>(CHANNEL_MESSAGES_COLLECTION);
  const conversations = database.collection<DirectConversationDocument>(DIRECT_CONVERSATIONS_COLLECTION);
  const directMessages = database.collection<DirectMessageDocument>(DIRECT_MESSAGES_COLLECTION);
  const workspaceMemberships = database.collection<WorkspaceMembershipDocument>(WORKSPACE_MEMBERSHIPS_COLLECTION);

  const ensureIndexes = async (): Promise<void> => {
    const channelTextIndex = CHANNEL_MESSAGES_INDEXES.find(({ options }) => options.name === "channel_messages_text");
    const directTextIndex = DIRECT_MESSAGES_INDEXES.find(({ options }) => options.name === "direct_messages_text");
    if (!channelTextIndex || !directTextIndex) {
      throw new Error("Message search text indexes are missing from the migration definition.");
    }
    let hasChannelIndex = false;
    let hasDirectIndex = false;
    try {
      [hasChannelIndex, hasDirectIndex] = await Promise.all([
        hasIndex(channelMessages, channelTextIndex.options.name),
        hasIndex(directMessages, directTextIndex.options.name)
      ]);
    } catch (error: unknown) {
      if (isRecord(error) && error.code === 26) throw unavailable;
      throw error;
    }
    if (!hasChannelIndex || !hasDirectIndex) throw unavailable;
  };

  return Object.freeze({
    searchForMember: async (
      workspaceId: string,
      userId: string,
      query: string,
      page: number
    ): Promise<MessageSearchPage> => {
      await ensureIndexes();
      const membershipsForUser = await memberships.find(
        { userId },
        { projection: { _id: 0, channelId: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }
      ).toArray();
      const channelsForUser = membershipsForUser.length === 0
        ? []
        : await channels.find({
          workspaceId,
          _id: { $in: membershipsForUser.map(({ channelId }) => channelId) }
        }, { projection: { _id: 1, name: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }).toArray();
      const channelNames = new Map(channelsForUser.map(({ _id, name }) => [_id, name]));
      const channelIds = [...channelNames.keys()];
      const memberConversations = await conversations.find(
        { workspaceId, participantIds: userId },
        { projection: { _id: 1, participantIds: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }
      ).toArray();
      const conversationParticipants = new Map(memberConversations.map(({ _id, participantIds }) => [
        _id,
        participantIds.find((participantId) => participantId !== userId) ?? ""
      ]));
      const scanLimit = page * MESSAGE_SEARCH_PAGE_SIZE + 1;
      try {
        const [channelMatches, directMatches] = await Promise.all([
          channelIds.length === 0
            ? Promise.resolve([])
            : channelMessages.find<IndexedSearchMessage>({
              $text: { $search: query },
              channelId: { $in: channelIds },
              hiddenForUserIds: { $nin: [userId] }
            }, {
              projection: {
                _id: 1, channelId: 1, senderId: 1, text: 1, createdAt: 1, threadRootId: 1,
                score: { $meta: "textScore" }
              },
              maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS
            }).sort({ score: { $meta: "textScore" }, createdAt: -1, _id: -1 }).limit(scanLimit).toArray(),
          conversationParticipants.size === 0
            ? Promise.resolve([])
            : directMessages.find<IndexedSearchMessage>({
              $text: { $search: query },
              workspaceId,
              conversationId: { $in: [...conversationParticipants.keys()] },
              hiddenForUserIds: { $nin: [userId] }
            }, {
              projection: {
                _id: 1, conversationId: 1, senderId: 1, text: 1, createdAt: 1,
                score: { $meta: "textScore" }
              },
              maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS
            }).sort({ score: { $meta: "textScore" }, createdAt: -1, _id: -1 }).limit(scanLimit).toArray()
        ]);
        const candidates: MessageSearchCandidate[] = [
          ...channelMatches.flatMap((message) => {
            const channelId = message.channelId;
            const name = channelId ? channelNames.get(channelId) : undefined;
            return channelId && name ? [{
              id: message._id,
              senderId: message.senderId,
              text: message.text,
              createdAt: message.createdAt,
              score: message.score,
              ...(message.threadRootId ? { threadRootId: message.threadRootId } : {}),
              conversation: Object.freeze({ type: "channel" as const, id: channelId, name })
            }] : [];
          }),
          ...directMatches.flatMap((message) => {
            const conversationId = message.conversationId;
            const otherParticipantId = conversationId ? conversationParticipants.get(conversationId) : undefined;
            return conversationId && otherParticipantId ? [{
              id: message._id,
              senderId: message.senderId,
              text: message.text,
              createdAt: message.createdAt,
              score: message.score,
              conversation: Object.freeze({ type: "direct" as const, id: conversationId, otherParticipantId })
            }] : [];
          })
        ].sort(compareMessageSearchCandidates);
        const candidateChannelIds = [...new Set(candidates.flatMap((candidate) =>
          candidate.conversation.type === "channel" ? [candidate.conversation.id] : []))];
        const candidateConversationIds = [...new Set(candidates.flatMap((candidate) =>
          candidate.conversation.type === "direct" ? [candidate.conversation.id] : []))];
        const [workspaceMembership, currentChannelMemberships, currentChannels, currentConversations] = await Promise.all([
          workspaceMemberships.findOne(
            { workspaceId, userId },
            { projection: { _id: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }
          ),
          candidateChannelIds.length === 0
            ? Promise.resolve([])
            : memberships.find({
              userId,
              channelId: { $in: candidateChannelIds }
            }, { projection: { _id: 0, channelId: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }).toArray(),
          candidateChannelIds.length === 0
            ? Promise.resolve([])
            : channels.find({
              workspaceId,
              _id: { $in: candidateChannelIds }
            }, { projection: { _id: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }).toArray(),
          candidateConversationIds.length === 0
            ? Promise.resolve([])
            : conversations.find({
              workspaceId,
              _id: { $in: candidateConversationIds },
              participantIds: userId
            }, { projection: { _id: 1 }, maxTimeMS: MESSAGE_SEARCH_TIMEOUT_MS }).toArray()
        ]);
        if (!workspaceMembership) {
          return Object.freeze({ candidates: Object.freeze([]), hasMore: false, truncated: false });
        }
        const currentMemberChannelIds = new Set(currentChannelMemberships.map(({ channelId }) => channelId));
        const currentWorkspaceChannelIds = new Set(currentChannels.map(({ _id }) => _id));
        const currentConversationIds = new Set(currentConversations.map(({ _id }) => _id));
        const currentlyAuthorized = candidates.filter(({ conversation }) => conversation.type === "channel"
          ? currentMemberChannelIds.has(conversation.id) && currentWorkspaceChannelIds.has(conversation.id)
          : currentConversationIds.has(conversation.id));
        const offset = (page - 1) * MESSAGE_SEARCH_PAGE_SIZE;
        const hasMore = currentlyAuthorized.length > offset + MESSAGE_SEARCH_PAGE_SIZE;
        return Object.freeze({
          candidates: Object.freeze(currentlyAuthorized.slice(offset, offset + MESSAGE_SEARCH_PAGE_SIZE)),
          hasMore: page < MESSAGE_SEARCH_MAX_PAGE && hasMore,
          truncated: page === MESSAGE_SEARCH_MAX_PAGE && hasMore
        });
      } catch (error: unknown) {
        if (isRecord(error) && (error.code === 26 || error.code === 27 || error.code === 50)) throw unavailable;
        throw error;
      }
    }
  });
};
