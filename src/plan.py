"""Adapt recipes from aggregate observations and attach treatments to render jobs."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import math
from creative import CONTROL, choose, evolve

CLIP = re.compile(r'(test|asmr|meme[123])-\d+-(quiz|tiers|pilot|loop|pick|meme)(?:-e([0-2]{6}))?\.mp4$')


def observations(report):
    observed = dt.datetime.fromisoformat(report['collected'])
    records = []
    seen = set()
    for row in report.get('clips', []):
        key = row['account'], row['id']
        match = CLIP.search(row.get('path') or '')
        if key in seen or not match or not row.get('posted'):
            continue
        seen.add(key)
        account = report.get('accounts', {}).get(row['account'], {})
        if account.get('status') not in ('ok', 'partial') or row.get('analyticsStatus', 'ok') != 'ok':
            continue
        age = (observed - dt.datetime.fromisoformat(row['posted'])).days
        if not 3 <= age < 28:
            continue
        page, scene, recipe = match.groups()
        if row['account'].startswith('yt:'):
            if not all(k in row for k in ('engagedViews', 'averageViewPercentage')):
                continue
            audience, quality = row['engagedViews'], row['averageViewPercentage']
        else:
            if not all(k in row for k in ('reach', 'shares', 'saved')):
                continue
            if not all(type(row[k]) in (int, float) and math.isfinite(row[k]) and row[k] >= 0 for k in ('reach', 'shares', 'saved')):
                continue
            audience = row['reach']
            quality = (row['shares'] + row['saved']) / (audience + 25)
        if not all(isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 for value in (audience, quality)):
            continue
        records.append(dict(account=row['account'], page=page, scene=scene, recipe=recipe or CONTROL,
                            audience=audience, quality=quality, cohort=(age - 3) // 3, posted=row['posted']))
    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--metrics', type=Path)
    parser.add_argument('--previous', type=Path)
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    previous = json.loads(args.previous.read_text()) if args.previous else {}
    records = observations(json.loads(args.metrics.read_text())) if args.metrics else []
    policy = evolve(records, previous)
    jobs = json.loads(args.jobs.read_text())
    for i, job in enumerate(jobs):
        page, scene = job.get('page', 'test'), job.get('scene', 'pilot')
        identity = job.get('identity', job.get('output', str(i)))
        job['recipe'] = choose(policy, job.get('account', f'ig:{page}'), page, scene, identity)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'jobs.json').write_text(json.dumps(jobs, ensure_ascii=False, indent=2))
    (args.out / 'policy.json').write_text(json.dumps(policy, ensure_ascii=False, indent=2))
    print('Prepared montage assignments; raw metrics are not copied to output.')


if __name__ == '__main__':
    main()
