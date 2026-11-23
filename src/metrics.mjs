// Read provider analytics without changing connected accounts or publication state.
import {webcrypto} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const GOOGLE = 'https://www.googleapis.com/youtube/v3/';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports?';
const IG = 'https://graph.instagram.com/v23.0/';
export const metricRows = data => (data.rows || []).map(values => Object.fromEntries(data.columnHeaders.map((h, i) => [h.name, values[i]])));
const numbers = data => Object.fromEntries((data.data || []).flatMap(row => {
  const value = row.values?.[0]?.value ?? row.total_value?.value;
  return typeof value === 'number' && Number.isFinite(value) ? [[row.name, value]] : [];
}));
const iso = value => new Date(value).toISOString();
export const safeFailure = error => /^HTTP \d{3}$/.test(error.message) ? error.message : 'Provider unavailable';

export async function provider(url, token, init = {}) {
  const response = await fetch(url, {...init, headers: {...init.headers, ...(token ? {Authorization: 'Bearer ' + token} : {})}, redirect: 'error', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

export async function youtube(api, token, mapped, since, collected) {
  const videos = new Map(mapped.map(row => [row.external_id, {id: row.external_id, path: row.media_path, posted: iso(row.posted_at), analyticsStatus: 'pending'}]));
  const errors = [];
  const channels = await api(GOOGLE + 'channels?part=contentDetails&mine=true', token);
  const playlist = channels.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) throw new Error('Uploads playlist unavailable');
  let next;
  let pages = 0;
  do {
    const params = new URLSearchParams({part: 'contentDetails', playlistId: playlist, maxResults: '50'});
    if (next) params.set('pageToken', next);
    const page = await api(GOOGLE + 'playlistItems?' + params, token);
    for (const item of page.items || []) {
      const {videoId: id, videoPublishedAt: posted} = item.contentDetails || {};
      if (id && Date.parse(posted) >= Date.parse(since) && !videos.has(id)) videos.set(id, {id, posted, analyticsStatus: 'pending'});
    }
    next = page.nextPageToken;
    if (page.items?.length && page.items.every(item => Date.parse(item.contentDetails?.videoPublishedAt) < Date.parse(since))) next = null;
    if (++pages >= 100 && next) throw new Error('Uploads pagination limit exceeded');
  } while (next);
  const ids = [...videos.keys()];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    try {
      const params = new URLSearchParams({part: 'statistics,snippet,status,contentDetails', id: batch.join(',')});
      const data = await api(GOOGLE + 'videos?' + params, token);
      for (const video of data.items || []) {
        const row = videos.get(video.id);
        if (!row) continue;
        row.posted = video.snippet.publishedAt;
        row.title = video.snippet.title;
        row.privacy = video.status.privacyStatus;
        row.duration = video.contentDetails.duration;
        for (const [source, field] of [['viewCount', 'publicViews'], ['likeCount', 'publicLikes'], ['commentCount', 'publicComments']]) {
          if (video.statistics?.[source] !== undefined) row[field] = Number(video.statistics[source]);
        }
      }
    } catch (error) { errors.push('Inventory: ' + safeFailure(error)); }
    try {
      const params = new URLSearchParams({ids: 'channel==MINE', dimensions: 'video', filters: 'video==' + batch.join(','),
        metrics: 'views,engagedViews,averageViewDuration,averageViewPercentage,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost',
        startDate: since.slice(0, 10), endDate: collected.slice(0, 10), maxResults: '50'});
      for (const {video, ...metrics} of metricRows(await api(ANALYTICS + params, token))) {
        if (videos.has(video)) Object.assign(videos.get(video), metrics, {analyticsStatus: 'ok'});
      }
    } catch (error) {
      errors.push('Analytics: ' + safeFailure(error));
      for (const id of batch) videos.get(id).analyticsStatus = 'unavailable';
    }
  }
  return {clips: [...videos.values()], errors};
}

export async function instagram(api, token, account, mapped, since) {
  const known = new Map(mapped.map(row => [row.external_id, row]));
  const clips = [], errors = [];
  let after, pages = 0, watch = true;
  do {
    const params = new URLSearchParams({fields: 'id,timestamp,media_product_type', limit: '100'});
    if (after) params.set('after', after);
    const page = await api(IG + account + '/media?' + params, token);
    for (const media of page.data || []) {
      if (Date.parse(media.timestamp) < Date.parse(since) || media.media_product_type !== 'REELS') continue;
      const row = {id: media.id, path: known.get(media.id)?.media_path, posted: media.timestamp, analyticsStatus: 'unavailable'};
      try {
        Object.assign(row, numbers(await api(IG + media.id + '/insights?metric=views,reach,shares,saved,likes,comments', token)));
        row.analyticsStatus = ['reach', 'shares', 'saved'].every(key => key in row) ? 'ok' : 'pending';
      } catch (error) { errors.push('Insights: ' + safeFailure(error)); }
      if (watch && row.analyticsStatus === 'ok') {
        try { Object.assign(row, numbers(await api(IG + media.id + '/insights?metric=ig_reels_avg_watch_time,ig_reels_video_view_total_time', token))); }
        catch { watch = false; errors.push('Optional watch time unavailable'); }
      }
      clips.push(row);
    }
    after = page.paging?.next && page.data?.length && page.data.every(row => Date.parse(row.timestamp) >= Date.parse(since)) ? page.paging.cursors?.after : null;
    if (++pages >= 100 && after) throw new Error('Media pagination limit exceeded');
  } while (after);
  return {clips, errors};
}

export async function decodeToken(secret, sealed) {
  const raw = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('social-tokens:' + secret));
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const bytes = Buffer.from(sealed, 'base64');
  return new TextDecoder().decode(await webcrypto.subtle.decrypt({name: 'AES-GCM', iv: bytes.subarray(0, 12)}, key, bytes.subarray(12)));
}

export async function collect({accounts, posts, env, api = provider, now = new Date()}) {
  const collected = now.toISOString();
  const since = new Date(now.getTime() - 28 * 86400000).toISOString();
  const report = {version: 3, collected, clips: [], accounts: {}};
  for (const account of accounts) {
    const mapped = posts.filter(row => row.account_key === account.key);
    try {
      let result;
      if (account.platform === 'yt') {
        if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) throw new Error('YouTube credentials missing');
        const refresh = await decodeToken(env.SOCIAL_TOKEN_KEY, account.refresh_token);
        const grant = await api('https://oauth2.googleapis.com/token', null, {method: 'POST', body: new URLSearchParams({client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token'})});
        if (!grant.access_token) throw new Error('Refresh failed');
        result = await youtube(api, grant.access_token, mapped, since, collected);
      } else if (account.platform === 'ig') {
        result = await instagram(api, await decodeToken(env.SOCIAL_TOKEN_KEY, account.access_token), account.external_id, mapped, since);
      } else continue;
      report.clips.push(...result.clips.map(row => ({account: account.key, ...row})));
      report.accounts[account.key] = {status: result.errors.length ? 'partial' : 'ok', count: result.clips.length,
        ready: result.clips.filter(row => row.analyticsStatus === 'ok').length, issues: [...new Set(result.errors)]};
    } catch (error) { report.accounts[account.key] = {status: 'unavailable', error: safeFailure(error)}; }
  }
  return report;
}

async function main() {
  const required = ['DATABASE_URL', 'SOCIAL_TOKEN_KEY', 'YT_CLIENT_ID', 'YT_CLIENT_SECRET'];
  if (required.some(key => !process.env[key])) throw new Error('Configure studio analytics secrets: ' + required.join(', '));
  const {neon} = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL, {fetchOptions: {signal: AbortSignal.timeout(30000)}});
  const since = new Date(Date.now() - 28 * 86400000).toISOString();
  // Enforce a read-only transaction even if the supplied database role also has write access.
  const [accounts, posts] = await sql.transaction([
    sql`select key, platform, external_id, access_token, refresh_token from social_accounts where status='connected' and (platform='ig' or key='yt:official')`,
    sql`select account_key, external_id, media_path, posted_at from social_posts where status='published' and external_id is not null and posted_at >= ${since}`
  ], {readOnly: true});
  const report = await collect({accounts, posts, env: process.env});
  await writeFile(process.argv[2] || 'metrics.json', JSON.stringify(report), {mode: 0o600});
  const ready = Object.values(report.accounts).filter(account => account.ready > 0).length;
  console.log('Collected analytics: ' + report.clips.length + ' clips; ' + ready + ' accounts with usable provider metrics. Raw data remains local to this job.');
  if (!ready) throw new Error('No usable account analytics; automatic publishing is blocked.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Analytics collection failed. Check the four analytics secrets and provider access. No raw error payloads are logged.'); process.exitCode = 1; });
}
