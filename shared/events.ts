export interface EventGraphic { data: string; alt: string }
export interface EventDraft {
  name: string; description: string; startTime: string; endTime: string;
  entityType: 'external' | 'voice' | 'stage'; channelId: string | null; location: string | null;
  announcementChannelId: string; announcementText: string; graphic: EventGraphic | null;
}
export type SavedEventDraft = Omit<EventDraft, 'graphic'> & { graphicAlt: string | null };
export interface EventRecord {
  requestId: string; actorId: string; draft: SavedEventDraft; createdAt: number;
  eventId: string | null; announcementMessageId: string | null;
  eventStatus: 'pending' | 'created' | 'failed' | 'uncertain';
  announcementStatus: 'not_started' | 'pending' | 'sent' | 'failed' | 'uncertain';
}
export interface EventOptions {
  externalAllowed: boolean;
  eventChannels: { id: string; name: string; type: 'voice' | 'stage' }[];
  announcementChannels: { id: string; name: string }[];
}
export class EventError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
