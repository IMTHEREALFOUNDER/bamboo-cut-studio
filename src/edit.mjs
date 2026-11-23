// A bounded montage grammar. Recipe IDs describe compositions, never executable expressions.
// Axes: tempo, impact slow-down, zoom, pan, camera pattern, sound accent.
import {spawn} from 'node:child_process';
import {renameSync, rmSync, statSync} from 'node:fs';

export const CONTROL = '000000';
export function recipeAxes(id) {
  if (!/^[0-2]{6}$/.test(id)) throw new Error('Invalid montage recipe');
  return [...id].map(Number);
}

export function montage(id, {duration, scene, cues = [], fps = 30, audio = true}) {
  const [tempo, slow, zoom, pan, pattern, accent] = recipeAxes(id);
  if (!(duration > 0 && duration < 60) || ![30, 60].includes(fps)) throw new Error('Invalid reel dimensions');
  if (id === CONTROL) return null;
  // Timing-sensitive tests and choice scenes keep every frame's original timing.
  const timed = ['pilot', 'meme', 'loop'].includes(scene);
  const speed = timed ? [1, 1.07, 1.14][tempo] : 1;
  const end = scene === 'loop' ? duration : Math.max(0, duration - 2.2);
  const hit = cues.find(c => c.name === 'perfect' && c.t > .5 && c.t < end - .5)?.t;
  const useSlow = timed && scene !== 'loop' && slow > 0 && hit !== undefined;
  const boundaries = [0, ...(useSlow ? [hit - .08, hit + .2] : []), ...(end > 0 && end < duration ? [end] : []), duration];
  const segments = boundaries.slice(0, -1).map((start, i) => {
    const finish = boundaries[i + 1];
    const rate = start >= end ? 1 : useSlow && start === hit - .08 ? [1, .85, .7][slow] : speed;
    return {start, finish, rate};
  });
  const outputDuration = segments.reduce((n, s) => n + (s.finish - s.start) / s.rate, 0);
  const filters = [];
  for (const [i, s] of segments.entries()) {
    filters.push(`[0:v]trim=start=${s.start}:end=${s.finish},setpts=(PTS-STARTPTS)/${s.rate}[v${i}]`);
    if (audio) filters.push(`[0:a]atrim=start=${s.start}:end=${s.finish},asetpts=PTS-STARTPTS,atempo=${s.rate}[a${i}]`);
  }
  const streams = segments.map((_, i) => `[v${i}]${audio ? `[a${i}]` : ''}`).join('');
  filters.push(`${streams}concat=n=${segments.length}:v=1:a=${audio ? 1 : 0}[joined]${audio ? '[sound]' : ''}`);
  // The top text and CTA stay outside the transformed region. No whole-frame shake or flash.
  if (zoom || pan) {
    const amplitude = [0, .025, .05][zoom];
    const cycles = [1, 2, 3][pattern];
    const phase = `2*PI*${cycles}*on/(${fps}*${outputDuration})`;
    const z = `1+${amplitude}*(1-cos(${phase}))/2`;
    const x = `iw/2-iw/zoom/2+${[0, 3, 6][pan]}*sin(${phase})`;
    filters.push('[joined]split=2[back][region]');
    filters.push(`[region]crop=960:920:60:650,zoompan=z='${z}':x='${x}':y='ih/2-ih/zoom/2':d=1:s=960x920:fps=${fps}[motion]`);
    filters.push('[back][motion]overlay=60:650:shortest=1[framed]');
  } else filters.push('[joined]null[framed]');
  filters.push(`[framed]fps=${fps},format=yuv420p[video]`);
  if (audio) {
    // At most a modest level lift, then a limiter; audio and video use the same time map.
    filters.push(`[sound]volume=${1 + [0, .06, .12][accent]},alimiter=limit=0.95:level=false,apad,atrim=0:${outputDuration}[audio]`);
  }
  return {filters: filters.join(';'), duration: outputDuration, segments, audio};
}

const execute = (ffmpeg, args) => new Promise((resolve, reject) => {
  const child = spawn(ffmpeg, args, {stdio: ['ignore', 'ignore', 'pipe']});
  let error = '';
  child.stderr.on('data', part => { error = (error + part).slice(-2000); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`Montage encode failed (${code}): ${error}`)));
});

export async function applyMontage(ffmpeg, path, id, options) {
  const edit = montage(id, options);
  if (!edit) return;
  const temporary = path.replace(/\.mp4$/, '.montage.mp4');
  try {
    await execute(ffmpeg, ['-v', 'error', '-y', '-i', path, '-filter_complex_threads', '1',
      '-filter_complex', edit.filters, '-map', '[video]', ...(edit.audio ? ['-map', '[audio]'] : []),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', temporary]);
    if (statSync(temporary).size < 1000 || statSync(temporary).size > 25 * 1024 * 1024) throw new Error('Montage file size rejected');
    // A successful encode alone is insufficient: decode the complete result before replacing the source.
    await execute(ffmpeg, ['-v', 'error', '-xerror', '-i', temporary, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    renameSync(temporary, path);
  } finally { rmSync(temporary, {force: true}); }
}
