"""Plan edits for existing future slots, keeping the original publication cadence."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re

from creative import choose, evolve, CONTROL
from plan import observations

CLIP = re.compile(r'(test|asmr|meme[123])-\d+-(quiz|tiers|pilot|loop|pick|meme)\.mp4$')


def plan_cycle(manifest, metrics, previous=None, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    collected = dt.datetime.fromisoformat(metrics['collected'])
    if collected.tzinfo is None or not -300 <= (now - collected).total_seconds() <= 36 * 3600:
        raise ValueError('Analytics report is stale or has no timezone')
    if manifest.get('replace') is not True or not isinstance(manifest.get('posts'), list) or not manifest['posts']:
        raise ValueError('Missing live posting queue')
    records = observations(metrics)
    if not any(row.get('analyticsStatus') == 'ok' for row in metrics.get('clips', [])):
        raise ValueError('No usable provider analytics; refusing automatic publication')
    policy = evolve(records, previous)
    # Persist only editing choices, never video IDs, provider metrics or statistical samples.
    state = {key: {field: value[field] for field in ('champion', 'candidate', 'retired')} for key, value in policy.items()}
    jobs, seen, future, unready = [], set(), 0, 0
    for post in sorted(manifest['posts'], key=lambda row: row['due']):
        due = dt.datetime.fromisoformat(post['due'])
        if due.tzinfo is None:
            raise ValueError('Publication dates require a timezone')
        if not 12 * 3600 <= (due - now).total_seconds() < 36 * 3600:
            continue
        future += 1
        match = CLIP.search(post['path'])
        if not match:
            continue  # Already edited slots and unknown layouts are never edited again.
        page, scene = match.groups()
        for platform in post['platforms']:
            if platform not in ('ig', 'yt'):
                continue  # No TikTok learning without a connected analytics implementation.
            account = 'yt:official' if platform == 'yt' else 'ig:' + page
            coverage = metrics.get('accounts', {}).get(account, {})
            usable = any(row.get('account') == account and row.get('analyticsStatus') == 'ok' for row in metrics.get('clips', []))
            if coverage.get('status') not in ('ok', 'partial') or not usable:
                unready += 1
                continue
            identity = '|'.join((post['page'], post['path'], platform, post['due']))
            if identity in seen:
                raise ValueError('Duplicate source publication slot')
            seen.add(identity)
            recipe = choose(policy, account, page, scene, identity)
            if recipe == CONTROL:
                continue  # Original videos provide the control group, with no extra publication.
            name = Path(post['path']).name[:-4] + '-e' + recipe + '.mp4'
            output = 'studio/' + due.strftime('%Y%m%d') + '/' + platform + '/' + name
            caption = re.sub(r'[?&]startapp=[A-Za-z0-9_-]+', '', post['caption'])
            jobs.append(dict(sourcePath=post['path'], output=output, page=post['page'], scene=scene,
                             account=account, recipe=recipe, caption=caption, due=post['due'], platforms=[platform],
                             replaces=dict(page=post['page'], path=post['path'], due=post['due'], caption=post['caption'], platforms=[platform])))
    if not future:
        raise ValueError('Base video queue has no slots in the next planning window; replenish source scenes')
    if len(jobs) > 45:
        raise ValueError('Unexpected publication volume; automatic render limit exceeded')
    return jobs, state, dict(futureSlots=future, edits=len(jobs), unavailableSlots=unready, learningSamples=len(records))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--metrics', type=Path, required=True)
    parser.add_argument('--previous', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9-]+\.pages\.dev', args.host):
        raise ValueError('Expected a trusted Pages media hostname')
    previous = json.loads(args.previous.read_text()) if args.previous.exists() else {}
    jobs, policy, summary = plan_cycle(json.loads(args.manifest.read_text()), json.loads(args.metrics.read_text()), previous)
    for job in jobs:
        path = job.pop('sourcePath')
        if not re.fullmatch(r'[\w./-]+\.mp4', path) or any(part in ('', '.', '..') for part in path.split('/')):
            raise ValueError('Unsafe source media path')
        job['input'] = 'https://' + args.host + '/' + path
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'jobs.json').write_text(json.dumps(jobs, ensure_ascii=False, indent=2))
    (args.out / 'policy.json').write_text(json.dumps(policy))
    print(json.dumps(summary))
    return len(jobs)


if __name__ == '__main__':
    main()
