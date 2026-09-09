import { tokenHash } from './crypto.js';
import { Store, type Delivery } from './store.js';
import { BotSendError, BotUnavailableError, type BotService } from './bot/types.js';

export class DeliveryConflictError extends Error {}
export function publicDelivery(delivery:Delivery) {
  const {actorId:_,contentHash:__,...safe}=delivery;return safe;
}
export async function deliverMessage(store:Store,bot:BotService,input:{guildId:string;actorId:string;channelId:string;content:string;requestId:string}) {
  const content=input.content.trim();
  if (!content || content.length>2000) throw new DeliveryConflictError('A message must contain 1 to 2,000 characters.');
  const signature=tokenHash(JSON.stringify([input.actorId,input.channelId,content]));
  function match(delivery:Delivery) {
    if (delivery.actorId!==input.actorId || delivery.contentHash!==signature) throw new DeliveryConflictError('This send request belongs to a different draft. Start a new message.');
    return delivery;
  }
  const existing=store.getDelivery(input.guildId,input.requestId);
  if(existing)return match(existing);
  if(bot.status().state!=='ready')throw new BotUnavailableError('The bot is offline. Wait for it to reconnect before sending.');
  const channels=await bot.listSendableChannels(input.guildId);
  if(!channels.some(c=>c.id===input.channelId))throw new DeliveryConflictError('Select a channel in this server where the bot can view and send messages.');
  const reserved=store.reserveDelivery(input.guildId,input.requestId,input.actorId,input.channelId,signature);
  if(!reserved.created)return match(reserved.delivery);
  try {
    const result=await bot.sendMessage({guildId:input.guildId,channelId:input.channelId,content,nonce:tokenHash(`${input.guildId}:${input.requestId}`).slice(0,24)});
    return store.finishDelivery(input.guildId,input.requestId,'sent',result.id,null);
  }catch(error) {
    // If the external POST may have succeeded, never automatically resend.
    const uncertain=!(error instanceof BotSendError) || error.uncertain;
    return store.finishDelivery(input.guildId,input.requestId,uncertain ? 'uncertain' : 'failed',null,uncertain ? 'Discord delivery could not be confirmed. Check the channel before starting a new message.' : 'Discord did not accept this message. Check bot permissions and channel access before starting a new message.');
  }
}
