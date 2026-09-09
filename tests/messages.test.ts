import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { Vault } from '../server/crypto.js';
import { Store } from '../server/store.js';
import { deliverMessage,publicDelivery,DeliveryConflictError } from '../server/messages.js';
import { BotSendError,BotUnavailableError,type BotService } from '../server/bot/types.js';

function fixture() {
  const store=new Store(':memory:',new Vault(randomBytes(32).toString('base64')));
  let sends=0;
  const bot:BotService={status:()=>({state:'ready',lastReadyAt:Date.now()}),listSendableChannels:async()=>[{id:'channel-a',name:'general',type:0}],sendMessage:async input=>{sends++;assert.equal(input.nonce.length,24);return {id:'message-id',channelId:input.channelId};},stop:async()=>{}};
  const input={guildId:'guild-a',actorId:'admin-a',channelId:'channel-a',content:'Private draft body',requestId:randomUUID()};
  return {store,bot,input,sends:()=>sends};
}
test('concurrent retries of one request send exactly once and store no message text',async()=>{
  const f=fixture();try {
    const result=await Promise.all([deliverMessage(f.store,f.bot,f.input),deliverMessage(f.store,f.bot,f.input)]);
    assert.equal(f.sends(),1);assert.ok(result.some(d=>d.status==='sent'));
    assert.equal((await deliverMessage(f.store,f.bot,f.input)).status,'sent');assert.equal(f.sends(),1);
    const raw=JSON.stringify(f.store.db.prepare('SELECT * FROM deliveries').all());
    assert.ok(!raw.includes(f.input.content));assert.ok(!JSON.stringify(f.store.getActivity('guild-a')).includes(f.input.content));
    const safe=publicDelivery(result[0]);assert.ok(!('contentHash' in safe));assert.ok(!('actorId' in safe));
  }finally{f.store.close();}
});
test('same request ID cannot be reused by another user or a modified draft',async()=>{
  const f=fixture();try{
    await deliverMessage(f.store,f.bot,f.input);
    for(const change of [{actorId:'intruder'},{content:'changed'},{channelId:'another-channel'}]) await assert.rejects(deliverMessage(f.store,f.bot,{...f.input,...change}),DeliveryConflictError);
    assert.equal(f.sends(),1);
  }finally{f.store.close();}
});
test('network uncertainty is recorded and retrying cannot resend',async()=>{
  const f=fixture();try{
    let calls=0;f.bot.sendMessage=async()=>{calls++;throw new Error('Sensitive upstream details');};
    const result=await deliverMessage(f.store,f.bot,f.input);
    assert.equal(result.status,'uncertain');assert.ok(!result.error?.includes('Sensitive'));
    assert.equal((await deliverMessage(f.store,f.bot,f.input)).status,'uncertain');assert.equal(calls,1);
  }finally{f.store.close();}
});
test('known rejected message stays failed without an automatic retry',async()=>{
  const f=fixture();try{
    let calls=0;f.bot.sendMessage=async()=>{calls++;throw new BotSendError('Forbidden',false);};
    assert.equal((await deliverMessage(f.store,f.bot,f.input)).status,'failed');
    assert.equal((await deliverMessage(f.store,f.bot,f.input)).status,'failed');assert.equal(calls,1);
  }finally{f.store.close();}
});
test('wrong-server channels, offline bot, and empty drafts are rejected before reserving or sending',async()=>{
  const f=fixture();try{
    await assert.rejects(deliverMessage(f.store,f.bot,{...f.input,channelId:'foreign-channel'}),DeliveryConflictError);
    await assert.rejects(deliverMessage(f.store,f.bot,{...f.input,content:'   '}),DeliveryConflictError);
    await assert.rejects(deliverMessage(f.store,f.bot,{...f.input,content:'x'.repeat(2001)}),DeliveryConflictError);
    f.bot.status=()=>({state:'disconnected',lastReadyAt:null});
    await assert.rejects(deliverMessage(f.store,f.bot,f.input),BotUnavailableError);
    assert.equal(f.store.getDelivery(f.input.guildId,f.input.requestId),null);assert.equal(f.sends(),0);
  }finally{f.store.close();}
});
test('confirmed delivery can still be checked when bot goes offline',async()=>{
  const f=fixture();try{
    await deliverMessage(f.store,f.bot,f.input);
    f.bot.status=()=>({state:'disconnected',lastReadyAt:null});
    assert.equal((await deliverMessage(f.store,f.bot,f.input)).status,'sent');assert.equal(f.sends(),1);
  }finally{f.store.close();}
});
test('service restart marks pending sends uncertain and never retries them',async()=>{
  const f=fixture();try{
    f.bot.sendMessage=async()=>new Promise(()=>{});
    void deliverMessage(f.store,f.bot,f.input);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.store.getDelivery(f.input.guildId,f.input.requestId)?.status,'pending');
    f.store.recoverPendingDeliveries();
    const result=await deliverMessage(f.store,f.bot,f.input);
    assert.equal(result.status,'uncertain');assert.match(result.error!,/restarted/);
  }finally{f.store.close();}
});
test('delivery retention and guild removal clear only the intended records',async()=>{
  const f=fixture();try{
    await deliverMessage(f.store,f.bot,f.input);
    const second={...f.input,guildId:'guild-b'};await deliverMessage(f.store,f.bot,second);
    f.store.removeGuild('guild-a');
    assert.equal(f.store.getDelivery('guild-a',f.input.requestId),null);assert.ok(f.store.getDelivery('guild-b',f.input.requestId));
    assert.deepEqual(f.store.getActivity('guild-a'),[]);
    f.store.prune(Date.now()+91*86_400_000);
    assert.equal(f.store.getDelivery('guild-b',f.input.requestId),null);
  }finally{f.store.close();}
});
