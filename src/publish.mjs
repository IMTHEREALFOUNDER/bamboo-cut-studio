// Publish validated media while preserving the live queue and immutable YouTube origins.
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, stat, copyFile, mkdtemp, rm} from 'node:fs/promises';
import {resolve, dirname, sep} from 'node:path';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const PAGES = new Set(['official', 'test', 'asmr', 'meme1', 'meme2', 'meme3']);
const PLATFORMS = new Set(['ig', 'yt', 'tt']);
const LIMIT = 25 * 1024 * 1024;
export const digest = text => createHash('sha256').update(text).digest('hex');

export function mediaPath(path) {
  if (typeof path !== 'string' || !/^[\w./-]+\.mp4$/.test(path) || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe media path');
  return path;
}

export function validatePost(post) {
  mediaPath(post.path);
  if (!PAGES.has(post.page) || typeof post.caption !== 'string' || post.caption.length > 2200 || typeof post.due !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(post.due) || !Number.isFinite(Date.parse(post.due)) ||
      !Array.isArray(post.platforms) || !post.platforms.length || new Set(post.platforms).size !== post.platforms.length || post.platforms.some(p => !PLATFORMS.has(p))) throw new Error('Invalid publication metadata');
  return post;
}

export function originUrl(value, host, archive = false) {
  const url = new URL(value);
  const hash = url.hostname.slice(0, -(host.length + 1));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.hostname !== host && !(archive && /^[a-f0-9]+$/.test(hash) && url.hostname === `${hash}.${host}`))) throw new Error('Unexpected media origin');
  return url.origin;
}

export function mergeManifest(live, jobs, validatedPaths, now = Date.now()) {
  if (!live.replace || !Array.isArray(live.posts) || !live.posts.length) throw new Error('Live queue is unavailable or incompatible; refusing to replace it');
  if (!Array.isArray(jobs) || !jobs.length) throw new Error('No publication jobs');
  const cutoff = now - 86400000;
  let posts = live.posts.map(validatePost).filter(p => Date.parse(p.due) >= cutoff).map(p => ({...p, platforms: [...p.platforms]}));
  // Replace only explicitly identified future platform slots, never append a second post to them.
  for (const job of jobs) {
    if (!job.replaces) continue;
    const replacement = job.replaces;
    validatePost(replacement);
    if (replacement.path === job.output || replacement.page !== job.page || replacement.due !== job.due ||
        JSON.stringify(replacement.platforms) !== JSON.stringify(job.platforms) || Date.parse(job.due) < now + 6 * 3600000 || !validatedPaths.has(job.output)) throw new Error('Unsafe slot replacement');
    const prior = posts.find(p => p.page === replacement.page && p.path === replacement.path && p.due === replacement.due && p.caption === replacement.caption && replacement.platforms.every(platform => p.platforms.includes(platform)));
    if (!prior) {
      // A successful previous run may already have replaced this exact publication.
      const done = posts.find(p => p.page === job.page && p.path === job.output && p.due === job.due && p.caption === job.caption && job.platforms.every(platform => p.platforms.includes(platform)));
      if (done) continue;
      throw new Error('Source publication changed or disappeared; refusing replacement');
    }
    prior.platforms = prior.platforms.filter(platform => !replacement.platforms.includes(platform));
    posts = posts.filter(p => p.platforms.length);
  }
  const have = new Map(posts.flatMap(p => p.platforms.map(platform => [`${p.page}|${p.path}|${platform}`, p])));
  for (const job of jobs) {
    const post = validatePost({page: job.page, path: job.output, caption: job.caption, due: job.due, platforms: job.platforms});
    if (!validatedPaths.has(post.path)) throw new Error('Publication refers to an unvalidated render');
    if (Date.parse(post.due) < now + 300000 || Date.parse(post.due) > now + 28 * 86400000) throw new Error('New posts must be between five minutes and 28 days in the future');
    let duplicates = 0;
    for (const platform of post.platforms) {
      const key = `${post.page}|${post.path}|${platform}`;
      const prior = have.get(key);
      if (prior) {
        if (prior.due !== post.due || prior.caption !== post.caption) throw new Error('Existing publication identity conflicts with the new job');
        duplicates++;
      }
    }
    if (!duplicates && posts.some(p => p.path === post.path)) throw new Error('Media path already belongs to another publication');
    if (duplicates && duplicates !== post.platforms.length) throw new Error('Partially duplicated publication');
    if (!duplicates) {
      posts.push(post);
      for (const platform of post.platforms) have.set(`${post.page}|${post.path}|${platform}`, post);
    }
  }
  return {...live, replace: true, posts};
}

async function fetchBytes(url, limit = LIMIT) {
  const response = await fetch(url, {redirect: 'error', headers: {'User-Agent': 'Mozilla/5.0 (Bamboo Studio)'}, signal: AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`Media read failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > limit) throw new Error('Media response exceeds the size limit');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function deploy(site, project, branch) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', site, '--project-name', project, '--branch', branch, '--commit-dirty=true'],
      {env: {...process.env, WRANGLER_SEND_METRICS: 'false'}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const collect = data => { output = (output + data).slice(-20000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error('Cloudflare deployment failed; check the token scope, account and project. Provider output is not logged.'));
      const escaped = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const found = output.match(new RegExp(`https://[a-f0-9]+\\.${escaped}\\.pages\\.dev\\b`));
      if (!found) return reject(new Error('Cloudflare did not return an immutable deployment URL'));
      resolveRun(found[0]);
    });
  });
}

export async function publish({root, jobsFile, base, project, now = Date.now()}) {
  if (!process.env.CLOUDFLARE_API_TOKEN || !/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID || '')) throw new Error('Cloudflare token and account ID must be configured before publishing');
  if (!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(project)) throw new Error('Invalid Pages project');
  const host = `${project}.pages.dev`;
  base = originUrl(base, host);
  const source = resolve(root);
  const jobs = JSON.parse(await readFile(jobsFile, 'utf8'));
  const report = JSON.parse(await readFile(resolve(source, 'render-report.json'), 'utf8'));
  const paths = new Set(report.clips.map(r => mediaPath(r.output)));
  for (const path of paths) {
    const file = resolve(source, path);
    if (!file.startsWith(source + sep) || (await stat(file)).size > LIMIT) throw new Error('Invalid validated asset');
  }
  const bytes = await fetchBytes(base + '/manifest.json', 2 * 1024 * 1024);
  const live = JSON.parse(bytes);
  const merged = mergeManifest(live, jobs, paths, now);
  const oldPaths = new Set(live.posts.map(p => p.path));
  const freshPaths = new Set([...paths].filter(p => !oldPaths.has(p)));
  const site = await mkdtemp(resolve(tmpdir(), 'bamboo-publish-'));
  try {
    for (const path of freshPaths) {
      const target = resolve(site, path);
      await mkdir(dirname(target), {recursive:true});
      await copyFile(resolve(source, path), target);
    }
    for (const post of merged.posts) {
      if (freshPaths.has(post.path)) continue;
      const origin = post.mediaOrigin ? originUrl(post.mediaOrigin, host, true) : base;
      const file = resolve(site, mediaPath(post.path));
      await mkdir(dirname(file), {recursive: true});
      try { await stat(file); } catch { await writeFile(file, await fetchBytes(origin + '/' + post.path)); }
    }
    // Staging contains only allowlisted MP4 assets and the public manifest, never reports or credentials.
    await writeFile(resolve(site, 'manifest.json'), JSON.stringify(merged));
    await writeFile(resolve(site, 'index.html'), '<!doctype html><title>BAMBOO CUT media</title><p>Public promotional media.</p>');
    const archive = await deploy(site, project, 'studio-archive');
    for (const post of merged.posts) if (freshPaths.has(post.path) && post.platforms.includes('yt') && !post.mediaOrigin) post.mediaOrigin = archive;
    await writeFile(resolve(site, 'manifest.json'), JSON.stringify(merged));
    const current = await fetchBytes(base + '/manifest.json', 2 * 1024 * 1024);
    if (digest(current) !== digest(bytes)) throw new Error('Live queue changed during preparation; aborting before production deployment');
    await deploy(site, project, 'main');
    const confirmed = JSON.parse(await fetchBytes(base + '/manifest.json', 2 * 1024 * 1024));
    if (digest(JSON.stringify(confirmed)) !== digest(JSON.stringify(merged))) throw new Error('Production confirmation did not match the submitted manifest');
    console.log(`Published ${jobs.length} jobs, preserving ${merged.posts.length} queue entries.`);
  } finally { await rm(site, {recursive:true, force:true}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  for (const name of ['--root', '--jobs', '--base', '--project']) if (!process.argv.includes(name)) throw new Error('Missing ' + name);
  await publish({root: arg('--root'), jobsFile: arg('--jobs'), base: arg('--base'), project: arg('--project')});
}
