import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeManifest, originUrl, mediaPath, digest} from '../src/publish.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const old = {page:'official', path:'w05/day29/asmr-1-loop.mp4', caption:'Existing clip', due:'2026-11-23T14:00:00Z',
  platforms:['yt'], mediaOrigin:'https://abc123.bamboo-cut-media.pages.dev'};
const job = {page:'official', output:'studio/day30/asmr-1-loop-e102121.mp4', caption:'New clip',
  due:'2026-11-24T14:00:00Z', platforms:['yt']};
const live = {replace:true, posts:[old], start:'2026-10-26'};
const paths = new Set([job.output]);

test('merge preserves existing due times and immutable YouTube media origins', () => {
  const merged = mergeManifest(live, [job], paths, now);
  assert.deepEqual(merged.posts[0], old);
  assert.equal(merged.posts.length, 2);
  assert.equal(merged.posts[1].path, job.output);
  assert.equal(live.posts.length, 1);
});

test('reruns deduplicate the same publication and reject conflicting identity', () => {
  const once = mergeManifest(live, [job], paths, now);
  assert.equal(mergeManifest(once, [job], paths, now).posts.length, 2);
  assert.throws(() => mergeManifest(once, [{...job, caption:'Changed identity'}], paths, now));
  assert.throws(() => mergeManifest(live, [{...job, output:old.path, page:'test', platforms:['ig']}], new Set([old.path]), now));
});

test('empty/incompatible queues, overdue jobs and unvalidated media fail closed', () => {
  assert.throws(() => mergeManifest({posts:[]}, [job], paths, now));
  assert.throws(() => mergeManifest(live, [], paths, now));
  assert.throws(() => mergeManifest(live, [job], new Set(), now));
  assert.throws(() => mergeManifest(live, [{...job, due:'2026-11-23T11:00:00Z'}], paths, now));
  assert.throws(() => mergeManifest(live, [{...job, due:'2026-11-24T14:00:00'}], paths, now));
});

test('rejects traversal and foreign or credential-bearing archive origins', () => {
  for (const p of ['../clip.mp4', 'a/../clip.mp4', '/clip.mp4', 'a//clip.mp4']) assert.throws(() => mediaPath(p));
  const host = 'bamboo-cut-media.pages.dev';
  assert.equal(originUrl('https://abc123.' + host, host, true), 'https://abc123.' + host);
  for (const u of ['https://evil.example', 'https://abc123.' + host + '.evil.example', 'https://user:pass@' + host,
    'https://' + host + '/nested', 'https://' + host + '?token=secret']) assert.throws(() => originUrl(u, host, true));
  assert.notEqual(digest('old'), digest('new'));
});
