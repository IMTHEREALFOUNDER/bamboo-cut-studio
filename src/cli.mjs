import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises';
import {resolve, dirname, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {applyMontage, recipeAxes} from './edit.mjs';

const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const jobsFile = argument('--jobs');
if (!jobsFile) throw new Error('Usage: node src/cli.mjs --jobs jobs.json --out dist [--allow-host media.example.com]');
const root = resolve(argument('--out', 'dist'));
const host = argument('--allow-host', '');
const ff = process.env.FFMPEG || 'ffmpeg';
const probe = process.env.FFPROBE || 'ffprobe';
const jobs = JSON.parse(await readFile(jobsFile, 'utf8'));
if (!Array.isArray(jobs) || !jobs.length || jobs.length > 105) throw new Error('Expected 1–105 render jobs');
await mkdir(root, {recursive: true});
const completed = [];
for (const [index, job] of jobs.entries()) {
  const id = job.recipe || '000000';
  recipeAxes(id);
  const output = resolve(root, job.output || `clip-${index + 1}.mp4`);
  if (!output.startsWith(root + sep) || !output.endsWith('.mp4')) throw new Error('Output path must be an MP4 inside the output folder');
  await mkdir(dirname(output), {recursive: true});
  if (/^https:/i.test(job.input)) {
    const url = new URL(job.input);
    if (!host || url.hostname !== host || url.port || url.username || url.password || url.search || url.hash) throw new Error('Source must use the explicitly allowed public HTTPS host');
    const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error('Source download failed: HTTP ' + response.status);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) throw new Error('Source exceeds 25 MiB');
      chunks.push(chunk);
    }
    await writeFile(output, Buffer.concat(chunks));
  } else {
    if (typeof job.input !== 'string' || /^\w+:/.test(job.input)) throw new Error('Expected a local file or an allowed HTTPS source');
    await copyFile(resolve(dirname(jobsFile), job.input), output);
  }
  const result = spawnSync(probe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], {encoding: 'utf8', timeout: 15000});
  if (result.status !== 0) throw new Error('Source probe failed; install FFmpeg and ffprobe');
  const data = JSON.parse(result.stdout);
  const video = data.streams.find(s => s.codec_type === 'video');
  if (video?.width !== 1080 || video?.height !== 1920) throw new Error('Expected a 1080×1920 vertical source');
  const duration = Number(data.format.duration);
  if (!(duration > .5 && duration < 60)) throw new Error('Source duration must be between 0.5 and 60 seconds');
  const audio = data.streams.some(s => s.codec_type === 'audio');
  await applyMontage(ff, output, id, {duration, audio, scene: job.scene || 'pilot', cues: job.cues || [], fps: 30});
  const check = spawnSync(ff, ['-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'], {encoding: 'utf8', timeout: 120000});
  if (check.status !== 0) throw new Error('Rendered file failed complete decode');
  completed.push({output: output.slice(root.length + 1), recipe: id, scene: job.scene || 'pilot'});
  console.log(`Validated clip ${index + 1}/${jobs.length}: recipe ${id}`);
}
await writeFile(resolve(root, 'render-report.json'), JSON.stringify({clips: completed}, null, 2));
