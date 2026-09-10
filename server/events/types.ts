import type { EventDraft, EventOptions, SavedEventDraft } from '../../shared/events.js';
export interface EventTransport {
  options(guildId: string): Promise<EventOptions>;
  preflight(guildId: string, draft: EventDraft): Promise<void>;
  create(guildId: string, draft: EventDraft): Promise<{ id: string }>;
  announce(guildId: string, eventId: string, draft: SavedEventDraft, nonce: string): Promise<{ id: string }>;
}
