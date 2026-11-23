import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {youtube, instagram, collect, safeFailure, decodeToken} from '../src/metrics.mjs';

const since = '2026-11-01T00:00:00Z', collected = '2026-11-23T00:00:00Z';
const mapped = [{external_id:'published', media_path:'w01/day1/test-1-quiz.mp4', posted_at:'2026-11-10T00:00:00Z'}];
test('YouTube inventories all upload pages and keeps pending metrics distinct from zero', async () => {
  const api = async raw => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/channels')) return {items:[{contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]};
    if (url.pathname.endsWith('/playlistItems')) return url.searchParams.has('pageToken') ?
      {items:[{contentDetails:{videoId:'later-page', videoPublishedAt:'2026-11-12T00:00:00Z'}}]} :
      {items:[{contentDetails:{videoId:'unmapped', videoPublishedAt:'2026-11-13T00:00:00Z'}}], nextPageToken:'next'};
    if (url.pathname.endsWith('/videos')) return {items:[]};
    return {columnHeaders:[{name:'video'},{name:'engagedViews'},{name:'averageViewPercentage'}], rows:[['published',42,88]]};
  };
  const result = await youtube(api, 'secret', mapped, since, collected);
  assert.equal(result.clips.length, 3);
  assert.equal(result.clips.find(row => row.id === 'published').engagedViews, 42);
  assert.equal(result.clips.find(row => row.id === 'unmapped').path, undefined);
  assert.equal(result.clips.find(row => row.id === 'later-page').analyticsStatus, 'pending');
  assert.equal(result.clips.find(row => row.id === 'later-page').engagedViews, undefined);
});

test('provider failure preserves inventory and never leaks provider payloads', async () => {
  const api = async raw => {
    if (raw.includes('/channels?')) return {items:[{contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]};
    if (raw.includes('/playlistItems?')) return {items:[]};
    throw new Error('secret token and URL');
  };
  const result = await youtube(api, 'secret', mapped, since, collected);
  assert.equal(result.clips[0].analyticsStatus, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(safeFailure(new Error('HTTP 403')), 'HTTP 403');
});

test('optional Instagram watch-time failure does not erase core insights', async () => {
  const result = await instagram(async raw => {
    if (raw.includes('/media?')) return {data:[{id:'published', timestamp:'2026-11-10T00:00:00Z', media_product_type:'REELS'}]};
    if (raw.includes('ig_reels_avg_watch_time')) throw new Error('unsupported');
    return {data:[{name:'reach', values:[{value:200}]},{name:'shares', values:[{value:5}]},{name:'saved', total_value:{value:4}}]};
  }, 'secret', 'account', mapped, since);
  assert.equal(result.clips[0].analyticsStatus, 'ok');
  assert.equal(result.clips[0].reach, 200);
  assert.equal(result.errors.length, 1);
});

test('encrypted tokens are compatible and collection only refreshes grants in memory', async () => {
  const secret = 'fixture-key';
  const raw = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('social-tokens:' + secret));
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode('refresh-fixture'));
  const sealed = Buffer.concat([Buffer.from(iv),Buffer.from(encrypted)]).toString('base64');
  assert.equal(await decodeToken(secret,sealed),'refresh-fixture');
  const accounts = [{key:'yt:official',platform:'yt',refresh_token:sealed}];
  const before = JSON.stringify(accounts);
  const result = await collect({accounts, posts:[], env:{SOCIAL_TOKEN_KEY:secret,YT_CLIENT_ID:'client',YT_CLIENT_SECRET:'client-secret'},now:new Date(collected),api:async raw => {
    if (raw.includes('oauth2.googleapis.com')) return {access_token:'access-fixture'};
    throw new Error('denied with token access-fixture');
  }});
  assert.equal(JSON.stringify(accounts),before);
  assert.equal(result.accounts['yt:official'].status,'unavailable');
  for (const privateValue of [sealed,'refresh-fixture','access-fixture','client-secret']) assert.ok(!JSON.stringify(result).includes(privateValue));
});
