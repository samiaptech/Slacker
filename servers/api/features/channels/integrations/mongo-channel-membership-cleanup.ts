import type { MongoDatabase, MongoTransactionSession } from "../../../integrations/mongodb/index.js";
import {
  CHANNELS_COLLECTION,
  CHANNEL_MEMBERSHIPS_COLLECTION,
  type ChannelDocument,
  type ChannelMembershipDocument
} from "../models/index.js";

export const createMongoChannelMembershipCleanup = (database: MongoDatabase) => {
  const channels = database.collection<ChannelDocument>(CHANNELS_COLLECTION);
  const memberships = database.collection<ChannelMembershipDocument>(CHANNEL_MEMBERSHIPS_COLLECTION);

  return async (
    session: MongoTransactionSession,
    workspaceId: string,
    userId: string
  ): Promise<void> => {
    const memberMemberships = await memberships.find({ userId }, { session }).toArray();
    if (memberMemberships.length === 0) return;

    const workspaceChannels = await channels.find({
      _id: { $in: memberMemberships.map(({ channelId }) => channelId) },
      workspaceId
    }, { session }).toArray();
    const channelIds = workspaceChannels.map(({ _id }) => _id);
    if (channelIds.length === 0) return;

    const update = await channels.updateMany(
      { _id: { $in: channelIds }, workspaceId },
      { $inc: { membershipRevision: 1 } },
      { session }
    );
    if (update.matchedCount !== channelIds.length) {
      throw new Error("Channel membership cleanup could not update every affected channel.");
    }

    await memberships.deleteMany({ userId, channelId: { $in: channelIds } }, { session });
  };
};
