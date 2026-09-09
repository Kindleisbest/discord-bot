import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readConfig } from '../server/config.js';
import { Vault, constantEqual, randomToken, tokenHash } from '../server/crypto.js';
import { Store, type SessionData } from '../server/store.js';

const KEY = Buffer.alloc(32, 71).toString('base64');
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const credentials: NodeJS.ProcessEnv = {
  DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CLIENT_SECRET: 'test-client-secret-not-for-deployment',
  DISCORD_BOT_TOKEN: 'test-bot-token-not-for-deployment',
  DATA_ENCRYPTION_KEY: KEY,
};
const sessionData: Omit<SessionData, 'csrfToken'> = {
  user: { id: '123456789012345679', username: 'Test administrator', avatar: null },
  accessToken: 'private-oauth-access-token',
};

function makeStore(t: TestContext) {
  const vault = new Vault(KEY);
  const store = new Store(':memory:', vault);
  t.after(() => store.close());
  return { store, vault };
}

function count(store: Store, table: 'sessions' | 'oauth_states' | 'activity') {
  return (store.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

test('unconfigured development uses loopback and remains unconfigured', () => {
  const config = readConfig({});
  assert.equal(config.configured, false);
  assert.equal(config.production, false);
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.APP_ORIGIN, 'http://127.0.0.1:3000');
});

test('production requires all credentials and HTTPS', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://panel.example.com' }), /requires/);
  assert.throws(() => readConfig({ ...credentials, NODE_ENV: 'production', APP_ORIGIN: 'http://panel.example.com' }), /HTTPS/);
  for (const field of Object.keys(credentials)) {
    assert.throws(() => readConfig({
      ...credentials, NODE_ENV: 'production', APP_ORIGIN: 'https://panel.example.com', [field]: '',
    }), /Complete all four/, field);
  }
  const config = readConfig({ ...credentials, NODE_ENV: 'production', APP_ORIGIN: 'https://panel.example.com/' });
  assert.equal(config.configured, true);
  assert.equal(config.APP_ORIGIN, 'https://panel.example.com');
});

test('public interface bindings are rejected in every environment', () => {
  for (const mode of ['development', 'test', 'production']) {
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'example.com']) {
      assert.throws(() => readConfig({
        ...credentials, NODE_ENV: mode, HOST: host,
        APP_ORIGIN: mode === 'production' ? 'https://panel.example.com' : 'http://127.0.0.1:3000',
      }), /HOST/, `${mode}: ${host}`);
    }
  }
});

test('development and test origins must use loopback HTTP', () => {
  for (const mode of ['development', 'test']) {
    for (const origin of ['http://example.com', 'http://192.168.1.5', 'https://localhost', 'ftp://localhost']) {
      assert.throws(() => readConfig({ NODE_ENV: mode, APP_ORIGIN: origin }), /loopback HTTP/, origin);
    }
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      assert.equal(readConfig({ NODE_ENV: mode, APP_ORIGIN: origin }).APP_ORIGIN, origin);
    }
  }
});

test('origins cannot hide credentials, paths, queries, or fragments', () => {
  for (const suffix of ['/dashboard', '/?next=evil', '/#fragment']) {
    assert.throws(() => readConfig({ APP_ORIGIN: `http://localhost:3000${suffix}` }), /must be an origin/);
  }
  assert.throws(() => readConfig({ APP_ORIGIN: 'http://user:password@localhost:3000' }), /must be an origin/);
  assert.throws(() => readConfig({ APP_ORIGIN: 'not a URL' }), /APP_ORIGIN/);
});

test('invalid ports and partial credentials are rejected', () => {
  for (const port of ['0', '80', '1023', '65536', '3000.5', 'not-a-port']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT/, port);
  }
  assert.equal(readConfig({ PORT: '65535' }).PORT, 65535);
  assert.throws(() => readConfig({ DISCORD_CLIENT_ID: credentials.DISCORD_CLIENT_ID }), /Complete all four/);
  assert.throws(() => readConfig({ ...credentials, DISCORD_CLIENT_ID: 'not-an-application-id' }), /application ID/);
});

test('placeholder configuration stays unconfigured and mixed real values are rejected', () => {
  const placeholders = {
    DISCORD_CLIENT_ID: 'replace-with-client-id', DISCORD_CLIENT_SECRET: 'your_client_secret',
    DISCORD_BOT_TOKEN: 'PLACEHOLDER_TOKEN', DATA_ENCRYPTION_KEY: 'replace-with-random-key',
  };
  assert.equal(readConfig(placeholders).configured, false);
  assert.throws(() => readConfig({ ...credentials, DISCORD_BOT_TOKEN: 'your_bot_token' }), /Complete all four/);
  assert.throws(() => readConfig({ ...placeholders, NODE_ENV: 'production', APP_ORIGIN: 'https://panel.example.com' }), /requires/);
});

test('configuration rejects invalid encryption key encodings and lengths', () => {
  for (const key of [
    'not-base64', Buffer.alloc(16).toString('base64'), Buffer.alloc(31).toString('base64'),
    Buffer.alloc(33).toString('base64'), KEY.replace('=', ''), `${KEY}\n`,
  ]) {
    assert.throws(() => readConfig({ ...credentials, DATA_ENCRYPTION_KEY: key }), /32-byte key/);
  }
});

test('AES-GCM round trips structured values and uses a fresh nonce', () => {
  const vault = new Vault(KEY);
  const original = { text: 'Private message 🔐', nested: { allowed: true }, ids: ['123', '456'] };
  const first = vault.seal(original, 'session:first');
  const second = vault.seal(original, 'session:first');
  assert.deepEqual(vault.open(first, 'session:first'), original);
  assert.notEqual(first, second);
  assert.equal(first.includes(original.text), false);
});

test('AES-GCM rejects ciphertext, nonce, tag, key, and context tampering', () => {
  const vault = new Vault(KEY);
  const ciphertext = vault.seal({ secret: 'private' }, 'session:first');
  assert.throws(() => vault.open(ciphertext, 'session:second'));
  assert.throws(() => new Vault(Buffer.alloc(32, 72).toString('base64')).open(ciphertext, 'session:first'));
  for (const index of [0, 1, 2]) {
    const parts = ciphertext.split('.');
    const bytes = Buffer.from(parts[index], 'base64url');
    bytes[0] ^= 1;
    parts[index] = bytes.toString('base64url');
    assert.throws(() => vault.open(parts.join('.'), 'session:first'));
  }
  assert.throws(() => vault.open('malformed', 'session:first'));
  assert.throws(() => new Vault(Buffer.alloc(16).toString('base64')), /32-byte/);
});

test('token helpers support opaque tokens and safely compare unequal lengths', () => {
  const token = randomToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash(token), /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash(token), token);
  assert.equal(constantEqual('same', 'same'), true);
  assert.equal(constantEqual('same', 'diff'), false);
  assert.equal(constantEqual('same', 'longer'), false);
});

test('OAuth state is browser-bound and consumed exactly once', t => {
  const { store } = makeStore(t);
  store.createState('private-state', 'private-browser-binding', NOW);
  assert.equal(store.consumeState('private-state', 'other-browser', NOW), false);
  assert.equal(store.consumeState('wrong-state', 'private-browser-binding', NOW), false);
  assert.equal(store.consumeState('private-state', 'private-browser-binding', NOW), true);
  assert.equal(store.consumeState('private-state', 'private-browser-binding', NOW), false);
  assert.equal(count(store, 'oauth_states'), 0);
});

test('OAuth state expires at exactly ten minutes and stores only hashes', t => {
  const { store } = makeStore(t);
  store.createState('secret-state', 'secret-binding', NOW);
  const row = store.db.prepare('SELECT * FROM oauth_states').get()!;
  assert.equal(row.state_hash, tokenHash('secret-state'));
  assert.equal(row.binding_hash, tokenHash('secret-binding'));
  assert.equal(JSON.stringify(row).includes('secret-'), false);
  assert.equal(store.consumeState('secret-state', 'secret-binding', NOW + 10 * MINUTE), false);
  store.createState('almost-expired', 'browser', NOW);
  assert.equal(store.consumeState('almost-expired', 'browser', NOW + 10 * MINUTE - 1), true);
});

test('sessions store hashed IDs and authenticated encrypted tokens and user data', t => {
  const { store, vault } = makeStore(t);
  const session = store.createSession(sessionData, HOUR, NOW);
  const row = store.db.prepare('SELECT * FROM sessions').get()!;
  const stored = JSON.stringify(row);
  assert.equal(row.id_hash, tokenHash(session.id));
  for (const secret of [session.id, sessionData.accessToken, sessionData.user.username, session.data.csrfToken]) {
    assert.equal(stored.includes(secret), false);
  }
  assert.deepEqual(vault.open(row.payload as string, `session:${tokenHash(session.id)}`), session.data);
  assert.deepEqual(store.getSession(session.id, NOW), session.data);
  assert.notEqual(session.data.csrfToken, session.id);
});

test('malformed and unknown session IDs are rejected', t => {
  const { store } = makeStore(t);
  for (const id of ['', 'short', 'x'.repeat(44), '!'.repeat(43), 'x'.repeat(43)]) {
    assert.equal(store.getSession(id, NOW), null);
  }
});

test('sessions expire exactly at the idle deadline and are deleted', t => {
  const { store } = makeStore(t);
  const session = store.createSession(sessionData, 8 * HOUR, NOW);
  assert.equal(store.getSession(session.id, NOW + 30 * MINUTE), null);
  assert.equal(count(store, 'sessions'), 0);
});

test('successful session reads extend idle time but never the absolute lifetime', t => {
  const { store } = makeStore(t);
  const session = store.createSession(sessionData, HOUR, NOW);
  for (const elapsed of [29, 58]) {
    assert.deepEqual(store.getSession(session.id, NOW + elapsed * MINUTE), session.data);
  }
  const row = store.db.prepare('SELECT expires_at,last_seen FROM sessions').get()!;
  assert.equal(row.expires_at, NOW + HOUR);
  assert.equal(row.last_seen, NOW + 58 * MINUTE);
  assert.equal(store.getSession(session.id, NOW + HOUR), null);
});

test('session absolute lifetime is capped at eight hours', t => {
  const { store } = makeStore(t);
  const session = store.createSession(sessionData, 7 * DAY, NOW);
  assert.equal(session.expiresAt, NOW + 8 * HOUR);
  for (let elapsed = 20 * MINUTE; elapsed < 8 * HOUR; elapsed += 20 * MINUTE) {
    assert.ok(store.getSession(session.id, NOW + elapsed));
  }
  assert.equal(store.getSession(session.id, NOW + 8 * HOUR), null);
});

test('explicit logout deletes the session', t => {
  const { store } = makeStore(t);
  const session = store.createSession(sessionData, HOUR, NOW);
  store.deleteSession(session.id);
  assert.equal(store.getSession(session.id, NOW), null);
  assert.equal(count(store, 'sessions'), 0);
});

test('session ciphertext cannot be moved to a different session ID', t => {
  const { store } = makeStore(t);
  const first = store.createSession(sessionData, HOUR, NOW);
  const second = store.createSession({ ...sessionData, accessToken: 'other-private-token' }, HOUR, NOW);
  const firstRow = store.db.prepare('SELECT payload FROM sessions WHERE id_hash=?').get(tokenHash(first.id))!;
  store.db.prepare('UPDATE sessions SET payload=? WHERE id_hash=?').run(firstRow.payload, tokenHash(second.id));
  assert.equal(store.getSession(second.id, NOW), null);
  assert.equal(count(store, 'sessions'), 1);
  assert.deepEqual(store.getSession(first.id, NOW), first.data);
});

test('corrupted encrypted sessions fail closed and are removed', t => {
  const { store } = makeStore(t);
  const session = store.createSession(sessionData, HOUR, NOW);
  store.db.prepare('UPDATE sessions SET payload=?').run('corrupted');
  assert.equal(store.getSession(session.id, NOW), null);
  assert.equal(count(store, 'sessions'), 0);
});

test('role grants are isolated by guild even when the supplied role ID matches', t => {
  const { store } = makeStore(t);
  store.setGrant('guild-a', 'role', ['messages.send'], 'admin-a');
  store.setGrant('guild-b', 'role', ['inbox.read'], 'admin-b');
  assert.deepEqual(store.getGrants('guild-a'), [{ roleId: 'role', permissions: ['messages.send'] }]);
  assert.deepEqual(store.getGrants('guild-b'), [{ roleId: 'role', permissions: ['inbox.read'] }]);
  assert.deepEqual(store.getGrants('guild-c'), []);
  store.setGrant('guild-a', 'role', [], 'admin-a');
  assert.deepEqual(store.getGrants('guild-b'), [{ roleId: 'role', permissions: ['inbox.read'] }]);
});

test('grant replacement deduplicates permissions and records the actor in the same guild', t => {
  const { store } = makeStore(t);
  store.setGrant('guild-a', 'role', ['messages.send', 'messages.send'], 'admin-a');
  assert.deepEqual(store.getGrants('guild-a'), [{ roleId: 'role', permissions: ['messages.send'] }]);
  const [entry] = store.getActivity('guild-a');
  assert.equal(entry.actorId, 'admin-a');
  assert.equal(entry.action, 'permissions.updated');
  assert.equal(entry.targetId, 'role');
  assert.deepEqual(store.getActivity('guild-b'), []);
});

test('stored unknown permissions or malformed grant JSON fail closed', t => {
  const { store } = makeStore(t);
  store.db.prepare('INSERT INTO role_grants VALUES(?,?,?)').run('guild-a', 'role', '["unknown.permission"]');
  assert.throws(() => store.getGrants('guild-a'));
  store.db.prepare('UPDATE role_grants SET permissions=?').run('invalid JSON');
  assert.throws(() => store.getGrants('guild-a'));
});

test('grant changes roll back if their activity record cannot be written', t => {
  const { store } = makeStore(t);
  store.setGrant('guild-a', 'existing-role', ['messages.send'], 'admin-a');
  store.db.exec(`CREATE TRIGGER reject_permission_audit BEFORE INSERT ON activity
    WHEN NEW.action = 'permissions.updated'
    BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END;`);
  assert.throws(() => store.setGrant('guild-a', 'existing-role', ['audit.export'], 'admin-a'), /injected audit failure/);
  assert.throws(() => store.setGrant('guild-a', 'new-role', ['audit.export'], 'admin-a'), /injected audit failure/);
  assert.deepEqual(store.getGrants('guild-a'), [{ roleId: 'existing-role', permissions: ['messages.send'] }]);
  assert.equal(count(store, 'activity'), 1);
  store.db.exec('DROP TRIGGER reject_permission_audit');
  store.setGrant('guild-a', 'existing-role', [], 'admin-a');
  assert.equal(count(store, 'activity'), 2);
});

test('activity is tenant-isolated, newest-first, and bounded to 100 entries', t => {
  const { store } = makeStore(t);
  for (let index = 0; index < 105; index++) {
    store.addActivity('guild-a', 'admin-a', `action-${index}`, null, NOW + index);
  }
  store.addActivity('guild-b', 'admin-b', 'private-other-server', null, NOW + 200);
  const entries = store.getActivity('guild-a', NOW + 300);
  assert.equal(entries.length, 100);
  assert.equal(entries[0].action, 'action-104');
  assert.equal(entries[99].action, 'action-5');
  assert.equal(entries.some(entry => entry.action === 'private-other-server'), false);
  assert.deepEqual(store.getActivity('guild-c', NOW + 300), []);
});

test('activity older than 90 days is hidden immediately and physically pruned', t => {
  const { store } = makeStore(t);
  store.addActivity('guild-a', 'admin', 'expired', null, NOW - 90 * DAY - 1);
  store.addActivity('guild-a', 'admin', 'at-boundary', null, NOW - 90 * DAY);
  store.addActivity('guild-a', 'admin', 'retained', null, NOW - 90 * DAY + 1);
  store.addActivity('guild-b', 'admin', 'other-expired', null, NOW - 100 * DAY);
  assert.deepEqual(store.getActivity('guild-a', NOW).map(entry => entry.action), ['retained']);
  assert.equal(count(store, 'activity'), 4);
  store.prune(NOW);
  assert.equal(count(store, 'activity'), 1);
  assert.deepEqual(store.getActivity('guild-a', NOW).map(entry => entry.action), ['retained']);
});

test('pruning removes expired OAuth states and idle or absolutely expired sessions', t => {
  const { store } = makeStore(t);
  store.createState('expired-state', 'browser', NOW - 10 * MINUTE);
  store.createState('active-state', 'browser', NOW - 10 * MINUTE + 1);
  store.createSession(sessionData, HOUR, NOW - 30 * MINUTE);
  store.createSession(sessionData, 5 * MINUTE, NOW - 5 * MINUTE);
  const active = store.createSession(sessionData, HOUR, NOW - MINUTE);
  store.prune(NOW);
  assert.equal(count(store, 'oauth_states'), 1);
  assert.equal(count(store, 'sessions'), 1);
  assert.deepEqual(store.getSession(active.id, NOW), active.data);
  assert.equal(store.consumeState('active-state', 'browser', NOW), true);
});

test('onboarding progress is scoped to the authenticated user and can reset', t => {
  const { store } = makeStore(t);
  assert.deepEqual(store.getOnboarding('user-a'), { completed: false, step: 0 });
  store.setOnboarding('user-a', true, 4);
  assert.deepEqual(store.getOnboarding('user-a'), { completed: true, step: 4 });
  assert.deepEqual(store.getOnboarding('user-b'), { completed: false, step: 0 });
  store.setOnboarding('user-a', false, 0);
  assert.deepEqual(store.getOnboarding('user-a'), { completed: false, step: 0 });
});
