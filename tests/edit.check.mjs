import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {montage, recipeAxes, applyMontage} from '../src/edit.mjs';

test('untrusted recipe text cannot become an FFmpeg expression', () => {
  for (const id of [';movie=secret', '333333', '00000', '0000000', 'abcdef']) assert.throws(() => recipeAxes(id));
  assert.equal(montage('000000', {duration: 8, scene: 'loop'}), null);
});

test('timed memory scenes preserve their complete timeline', () => {
  const edit = montage('222222', {duration: 8, scene: 'quiz'});
  assert.equal(edit.duration, 8);
  assert.ok(edit.segments.every(s => s.rate === 1));
});

test('impact slow-down preserves source coverage and the end card', () => {
  const edit = montage('222222', {duration: 8, scene: 'pilot', cues: [{name: 'perfect', t: 2}]});
  assert.equal(edit.segments[0].start, 0);
  assert.equal(edit.segments.at(-1).finish, 8);
  assert.equal(edit.segments.at(-1).rate, 1);
  for (let i = 1; i < edit.segments.length; i++) assert.equal(edit.segments[i - 1].finish, edit.segments[i].start);
});

test('real FFmpeg encode and complete decode, with and without sound', {timeout: 120000}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'studio-test-'));
  const ff = process.env.FFMPEG || 'ffmpeg';
  try {
    for (const audio of [true, false]) {
      const file = join(root, `${audio}.mp4`);
      const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x0B0A14:s=1080x1920:r=30:d=4'];
      if (audio) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4');
      args.push('-vf', 'drawbox=x=430:y=400:w=220:h=1200:color=0xB6FF00:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file);
      const source = spawnSync(ff, args, {encoding: 'utf8'});
      assert.equal(source.status, 0, source.stderr);
      await applyMontage(ff, file, '222222', {duration: 4, scene: 'pilot', cues: [{name: 'perfect', t: 1}], audio});
      assert.ok(statSync(file).size > 1000);
    }
  } finally { rmSync(root, {recursive: true, force: true}); }
});
