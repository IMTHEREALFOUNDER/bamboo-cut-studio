"""Generate new montage compositions and keep a measured control group.

Inputs are aggregate video metrics, never credentials. These are observational
experiments: they do not establish causal attribution or guarantee views.
"""
from collections import defaultdict
import copy
import hashlib
import random
import re
from statistics import median

CONTROL = '000000'
VALID = re.compile(r'^[0-2]{6}$')
SCENES = {'test': ('quiz', 'pilot', 'tiers'), 'asmr': ('loop', 'pick'),
          **{f'meme{i}': ('meme',) for i in (1, 2, 3)}}


def normalize(recipe, scene):
    if not VALID.fullmatch(recipe):
        raise ValueError('Invalid montage recipe')
    axes = list(recipe)
    if scene not in ('pilot', 'meme', 'loop'):
        axes[:2] = ['0', '0']
    if scene == 'loop':
        axes[1] = '0'
    if axes[2] == '0':
        axes[3:5] = ['0', '0']
    return ''.join(axes)


def new_recipe(parent, scene, retired, seed):
    """Mutate a measured parent; fall back to another composition if necessary."""
    rng = random.Random(str(seed) + '|'.join(retired))
    for _ in range(2000):
        axes = list(parent)
        for _ in range(rng.choice((1, 1, 2))):
            axes[rng.randrange(6)] = str(rng.randrange(3))
        candidate = normalize(''.join(axes), scene)
        if candidate not in {CONTROL, parent, *retired}:
            return candidate
    return None  # No endless retry or invented evidence when the grammar is exhausted.


def choose(policy, account, page, scene, identity):
    state = policy.get(f'{account}|{page}|{scene}', {})
    # The same identity yields the same assignment, independently of renderer restarts.
    # 20% original control, 60% incumbent, 20% current experimental composition.
    bucket = int(hashlib.sha256(str(identity).encode()).hexdigest()[:8], 16) % 10
    value = CONTROL if bucket < 2 else state.get('champion', CONTROL) if bucket < 8 else state.get('candidate', CONTROL)
    return normalize(value or CONTROL, scene)


def bootstrap_difference(candidate, reference):
    rng = random.Random(43)
    values = sorted(median(rng.choices(candidate, k=len(candidate))) - median(rng.choices(reference, k=len(reference)))
                    for _ in range(600))
    return values[30], values[569]  # A conservative decision aid, not a causal confidence claim.


def compare(rows, candidate, reference):
    """Rank within account/scene/age cohorts containing both alternatives."""
    groups = defaultdict(list)
    for row in rows:
        if row['recipe'] in (candidate, reference):
            groups[row['cohort']].append(row)
    samples = defaultdict(list)
    dates = defaultdict(set)
    quality = defaultdict(list)
    for group in groups.values():
        if {r['recipe'] for r in group} != {candidate, reference}:
            continue
        for row in group:
            rank = lambda key: sum((r[key] < row[key]) + .5 * (r[key] == row[key]) for r in group) / len(group)
            score = .55 * rank('audience') + .45 * rank('quality')
            samples[row['recipe']].append(score)
            dates[row['recipe']].add(row['posted'][:10])
            quality[row['recipe']].append(row['quality'])
    counts = {r: len(samples[r]) for r in (candidate, reference)}
    if min(counts.values()) < 6 or min(len(dates[r]) for r in (candidate, reference)) < 2:
        return {'verdict': 'collecting', 'samples': counts}
    low, high = bootstrap_difference(samples[candidate], samples[reference])
    preserves_quality = median(quality[candidate]) >= median(quality[reference])
    verdict = 'promote' if low > .05 and preserves_quality else 'retire' if high < -.05 or min(counts.values()) >= 20 else 'collecting'
    return {'verdict': verdict, 'samples': counts, 'difference_range': [round(low, 3), round(high, 3)],
            'quality_preserved': preserves_quality}


def evolve(records, previous=None):
    """Carry trials across weeks until there is enough evidence to change them."""
    policy = copy.deepcopy(previous or {})
    grouped = defaultdict(list)
    for row in records:
        grouped[row['account'], row['page'], row['scene']].append(row)
    for page, scenes in SCENES.items():
        for account in (f'ig:{page}', 'yt:official'):
            for scene in scenes:
                key = f'{account}|{page}|{scene}'
                state = policy.get(key, {})
                champion = normalize(state.get('champion', CONTROL), scene)
                retired = state.get('retired', [])[-700:]
                candidate = state.get('candidate') or new_recipe(champion, scene, retired, page + scene)
                rows = grouped[account, page, scene]
                result = compare(rows, candidate, champion) if candidate else {'verdict': 'exhausted'}
                if champion != CONTROL:
                    control = compare(rows, champion, CONTROL)
                    if control['verdict'] == 'retire':
                        retired.append(champion)
                        champion = CONTROL
                        result = {'verdict': 'rollback', 'control': control}
                if result['verdict'] in ('promote', 'retire'):
                    if result['verdict'] == 'promote':
                        champion = candidate
                    retired = list(dict.fromkeys([*retired, candidate]))
                    candidate = new_recipe(champion, scene, retired, page + scene)
                policy[key] = {'champion': champion, 'candidate': candidate, 'retired': retired, 'decision': result}
    return policy
