import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../server/config.js';
import { Vault } from '../server/crypto.js';
import { Store } from '../server/store.js';
import { buildApp } from '../server/app.js';
import { DiscordError, type DiscordApi } from '../server/discord.js';

const guildId='11111111111111111', otherGuild='22222222222222222', userId='33333333333333333', adminRole='44444444444444444', lowerRole='55555555555555555';
async function fixture(owner=true) {
  const config=readConfig({NODE_ENV:'test',DISCORD_CLIENT_ID:guildId,DISCORD_CLIENT_SECRET:'test-client-secret',DISCORD_BOT_TOKEN:'test-bot-token',DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
  const store=new Store(':memory:',new Vault(config.DATA_ENCRYPTION_KEY));
  const user={id:userId,username:'Test admin',avatar:null};
  const live={guild:{id:guildId,name:'Test server',icon:null,ownerId:owner ? userId : otherGuild},roles:[{id:guildId,name:'@everyone',position:0,permissions:'0'},{id:adminRole,name:'Admin',position:10,permissions:'8'},{id:lowerRole,name:'Lower admin',position:1,permissions:'8'}],memberRoleIds:owner ? [] : [adminRole]};
  let exchanged=0;
  const discord:DiscordApi={
    authorizeUrl:state=>`https://discord.com/oauth2/authorize?state=${state}`,
    exchange:async()=>{exchanged++;return {accessToken:'secret-access-token',expiresIn:3600};},
    currentUser:async()=>user,
    userGuilds:async()=>[{id:guildId,name:'Test server',icon:null,owner,permissions:'8'}],
    guildContext:async(id)=>{if(id!==guildId)throw new DiscordError(403);return live;},
    revoke:async()=>{},
  };
  const app=await buildApp(config,store,discord);
  const issued=store.createSession({user,accessToken:'secret-access-token'},3600_000);
  const headers={cookie:`dm_session=${issued.id}`,origin:config.APP_ORIGIN,'x-csrf-token':issued.data.csrfToken};
  return {app,store,discord,live,headers,exchanged:()=>exchanged,close:async()=>{await app.close();store.close();}};
}

test('anonymous users cannot read or mutate any server workspace',async()=>{
  const f=await fixture();try {
    for(const url of ['/api/me','/api/guilds',`/api/guilds/${guildId}`,`/api/guilds/${guildId}/activity`]) assert.equal((await f.app.inject({url})).statusCode,401);
    assert.equal((await f.app.inject({method:'PUT',url:`/api/guilds/${guildId}/permissions/${lowerRole}`,headers:{origin:'http://127.0.0.1:3000'},payload:{permissions:[]}})).statusCode,401);
  }finally{await f.close();}
});
test('owner can edit grants, change is audited, no tokens leak in responses',async()=>{
  const f=await fixture();try{
    const detail=await f.app.inject({url:`/api/guilds/${guildId}`,headers:f.headers});
    assert.equal(detail.statusCode,200);assert.equal(detail.json().access.isOwner,true);assert.ok(!detail.body.includes('secret-access-token'));
    const result=await f.app.inject({method:'PUT',url:`/api/guilds/${guildId}/permissions/${lowerRole}`,headers:f.headers,payload:{permissions:['inbox.read','permissions.manage']}});
    assert.equal(result.statusCode,200);assert.equal(f.store.getGrants(guildId)[0].roleId,lowerRole);assert.equal(f.store.getActivity(guildId)[0].action,'permissions.updated');
  }finally{await f.close();}
});
test('mutations require both same origin and session-bound CSRF token',async()=>{
  const f=await fixture();try{
    for(const headers of [{...f.headers,origin:'https://evil.example'},{...f.headers,'x-csrf-token':'forged'},{cookie:f.headers.cookie,'x-csrf-token':f.headers['x-csrf-token']},{...f.headers,'sec-fetch-site':'cross-site'}]){
      assert.equal((await f.app.inject({method:'PUT',url:`/api/guilds/${guildId}/permissions/${lowerRole}`,headers,payload:{permissions:[]}})).statusCode,403);
    }
    assert.deepEqual(f.store.getGrants(guildId),[]);
  }finally{await f.close();}
});
test('a removed Administrator role revokes access immediately despite stored grants',async()=>{
  const f=await fixture(false);try{
    f.store.setGrant(guildId,adminRole,['permissions.manage'],userId);
    assert.equal((await f.app.inject({url:`/api/guilds/${guildId}`,headers:f.headers})).statusCode,200);
    f.live.memberRoleIds=[];
    assert.equal((await f.app.inject({url:`/api/guilds/${guildId}`,headers:f.headers})).statusCode,403);
    assert.deepEqual((await f.app.inject({url:'/api/guilds',headers:f.headers})).json().guilds,[]);
  }finally{await f.close();}
});
test('a valid session for one server does not grant another server access',async()=>{
  const f=await fixture();try{
    f.store.addActivity(otherGuild,userId,'private.action');
    const response=await f.app.inject({url:`/api/guilds/${otherGuild}/activity`,headers:f.headers});
    assert.equal(response.statusCode,403);assert.ok(!response.body.includes('private.action'));
  }finally{await f.close();}
});
test('Discord failure fails closed and does not expose upstream errors',async()=>{
  const f=await fixture();try{
    f.discord.guildContext=async()=>{throw new DiscordError(429);};
    assert.equal((await f.app.inject({url:`/api/guilds/${guildId}`,headers:f.headers})).statusCode,503);
  }finally{await f.close();}
});
test('callback binds state to its browser, uses it once, and rotates login session',async()=>{
  const f=await fixture();try{
    const login=await f.app.inject({url:'/auth/login'});
    assert.equal(login.statusCode,302);
    const state=new URL(login.headers.location!).searchParams.get('state')!;
    const browserCookie=login.cookies.find(c=>c.name==='dm_oauth')!;
    const callback=`/auth/callback?code=test-code&state=${state}`;
    assert.equal((await f.app.inject({url:callback})).statusCode,400);assert.equal(f.exchanged(),0);
    const result=await f.app.inject({url:callback,headers:{cookie:`dm_oauth=${browserCookie.value}; ${f.headers.cookie}`}});
    assert.equal(result.statusCode,302);assert.equal(f.exchanged(),1);
    assert.ok(result.cookies.some(c=>c.name==='dm_session'&&c.httpOnly&&c.sameSite==='Lax'));
    assert.equal((await f.app.inject({url:'/api/me',headers:f.headers})).statusCode,401);
    assert.equal((await f.app.inject({url:callback,headers:{cookie:`dm_oauth=${browserCookie.value}`}})).statusCode,400);assert.equal(f.exchanged(),1);
  }finally{await f.close();}
});
test('OAuth success alone cannot admit a member lacking live Administrator/owner access',async()=>{
  const f=await fixture(false);try{
    f.live.memberRoleIds=[];
    const login=await f.app.inject({url:'/auth/login'});
    const state=new URL(login.headers.location!).searchParams.get('state')!;
    const response=await f.app.inject({url:`/auth/callback?code=test&state=${state}`,headers:{cookie:`dm_oauth=${login.cookies[0].value}`}});
    assert.equal(response.statusCode,403);assert.equal(response.cookies.filter(c=>c.name==='dm_session').length,0);
  }finally{await f.close();}
});
test('logout destroys the session and sensitive responses cannot be cached or framed',async()=>{
  const f=await fixture();try{
    const response=await f.app.inject({url:'/api/me',headers:f.headers});
    assert.equal(response.headers['cache-control'],'no-store');
    assert.match(String(response.headers['content-security-policy']),/frame-ancestors 'none'/);
    assert.equal((await f.app.inject({method:'POST',url:'/auth/logout',headers:f.headers})).statusCode,200);
    assert.equal((await f.app.inject({url:'/api/me',headers:f.headers})).statusCode,401);
  }finally{await f.close();}
});
test('unexpected fields, unknown capabilities, and oversized requests are rejected',async()=>{
  const f=await fixture();try{
    for(const payload of [{permissions:['made.up']},{permissions:[],owner:true},{permissions:[],extra:'x'.repeat(20_000)}]) {
      const result=await f.app.inject({method:'PUT',url:`/api/guilds/${guildId}/permissions/${lowerRole}`,headers:f.headers,payload});
      assert.ok([400,413].includes(result.statusCode));
    }
    assert.deepEqual(f.store.getGrants(guildId),[]);
  }finally{await f.close();}
});
