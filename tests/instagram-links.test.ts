import test from 'node:test';
import assert from 'node:assert/strict';
import {findInstagramLinks,normalizeInstagramLink,MAX_LINK_MESSAGE_LENGTH,MAX_LINK_CANDIDATES} from '../server/instagram/links.js';

test('Instagram post and reel links normalize host and remove tracking without changing shortcode case',()=>{
  assert.deepEqual(normalizeInstagramLink('HTTPS://INSTAGRAM.COM/p/Ab_C-12?igsh=tracking#fragment'),{
    url:'https://www.instagram.com/p/Ab_C-12/',shortcode:'Ab_C-12',kind:'post',
  });
  assert.equal(normalizeInstagramLink('https://www.instagram.com/reel/AbC/')?.kind,'reel');
  assert.equal(normalizeInstagramLink('https://www.instagram.com/reel/AbC/')?.url,'https://www.instagram.com/reel/AbC/');
});
test('only exact trusted HTTPS authorities and raw supported paths are accepted',()=>{
  for (const value of [
    'http://instagram.com/p/ABC/', 'https://instagram.com.evil.test/p/ABC/',
    'https://instagram.com@evil.test/p/ABC/', 'https://user@instagram.com/p/ABC/',
    'https://user:@instagram.com/p/ABC/', 'https://instagram.com:443/p/ABC/',
    'https://instagram.com:8443/p/ABC/', 'https://instagram.com./p/ABC/',
    'https://%69nstagram.com/p/ABC/', 'https://ınstagram.com/p/ABC/',
    'https://instagram.com\\@evil.test/p/ABC/', 'https://instagram.com/x/../p/ABC/',
    'https://instagram.com/%70/ABC/', 'https://instagram.com/p/A%2fBC/',
    'https://instagram.com//p/ABC/', 'https://instagram.com/p/ABC/extra',
    'https://instagram.com/P/ABC/', 'https://instagram.com/reels/ABC/',
    'https://instagram.com/stories/person/123/', 'https://instagram.com/person/',
    '//instagram.com/p/ABC/', 'instagram.com/p/ABC/',
    ' https://instagram.com/p/ABC/', 'https://instagram.com/p/ABC/\n',
    'https://instagram.com/p/ABC/?x=\u0000',
  ]) assert.equal(normalizeInstagramLink(value),null,value);
});
test('code and URL lengths are bounded without partial acceptance',()=>{
  assert.ok(normalizeInstagramLink(`https://instagram.com/p/${'a'.repeat(64)}/`));
  assert.equal(normalizeInstagramLink(`https://instagram.com/p/${'a'.repeat(65)}/`),null);
  assert.equal(normalizeInstagramLink('https://instagram.com/p/'),null);
  assert.equal(normalizeInstagramLink(`https://instagram.com/p/ABC/?x=${'x'.repeat(2048)}`),null);
});
test('message extraction supports plain, bracketed, and Markdown links with adjacent punctuation',()=>{
  const links=findInstagramLinks('See https://instagram.com/p/One/. Also <https://www.instagram.com/reel/Two/?igsh=private> and [this post](https://instagram.com/p/Three/).');
  assert.deepEqual(links.map(link=>link.shortcode),['One','Two','Three']);
  assert.ok(links.every(link=>!link.url.includes('igsh')));
});
test('duplicate shortcodes are removed across host/path variants, preserving first occurrence and case',()=>{
  const links=findInstagramLinks('https://instagram.com/p/AbC/?x=1 https://www.instagram.com/reel/AbC/ https://instagram.com/p/abc/');
  assert.deepEqual(links.map(link=>link.shortcode),['AbC','abc']);
  assert.equal(links[0].kind,'post');
});
test('nested URLs and protocol-looking substrings cannot masquerade as separate Instagram links',()=>{
  for(const text of [
    'https://evil.test/?next=https://instagram.com/p/ABC/',
    'https://evil.test/https://instagram.com/p/ABC/',
    'https://evil.test/?next=(https://instagram.com/p/ABC/)',
    'http://evil.test/?next=https://instagram.com/p/ABC/',
    'ftp://evil.test/?next=(https://instagram.com/p/ABC/)',
    'prefixhttps://instagram.com/p/ABC/',
  ]) assert.deepEqual(findInstagramLinks(text),[],text);
  assert.equal(findInstagramLinks('https://evil.test/?next=https://instagram.com/p/ABC/ https://instagram.com/p/Real/')[0]?.shortcode,'Real');
});
test('scan limits count invalid candidates and reject oversized messages without truncating a URL',()=>{
  const valid='https://instagram.com/p/ABC/';
  assert.deepEqual(findInstagramLinks(('https://evil.test/ ').repeat(MAX_LINK_CANDIDATES)+valid),[]);
  assert.equal(findInstagramLinks(Array.from({length:12},(_,i)=>`https://instagram.com/p/Code${i}/`).join(' ')).length,MAX_LINK_CANDIDATES);
  assert.equal(findInstagramLinks(' '.repeat(MAX_LINK_MESSAGE_LENGTH-valid.length)+valid).length,1);
  assert.deepEqual(findInstagramLinks(' '.repeat(MAX_LINK_MESSAGE_LENGTH-valid.length)+valid+'extra'),[]);
});
