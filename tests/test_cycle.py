import datetime as dt
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from cycle import plan_cycle
from plan import observations

NOW = dt.datetime(2026, 11, 23, tzinfo=dt.timezone.utc)
METRICS = dict(collected=NOW.isoformat(), accounts={'yt:official': {'status': 'ok'}}, clips=[
    dict(account='yt:official', id='known', path='w01/day1/test-1-quiz.mp4', posted='2026-11-16T00:00:00Z',
         analyticsStatus='ok', engagedViews=100, averageViewPercentage=85)])


class CycleTests(unittest.TestCase):
    def manifest(self):
        return dict(replace=True, posts=[dict(page='official', path=f'w05/day29/test-{i}-quiz.mp4',
            caption='Play https://t.me/bamboo_cut_bot?startapp=oldcampaign', platforms=['yt'],
            due='2026-11-24T00:00:00Z') for i in range(1, 31)])

    def test_existing_slots_are_replaced_without_new_due_times(self):
        manifest = self.manifest()
        jobs, state, summary = plan_cycle(manifest, METRICS, now=NOW)
        self.assertGreater(len(jobs), 0)
        self.assertLess(len(jobs), 30)
        for job in jobs:
            self.assertEqual(job['due'], job['replaces']['due'])
            self.assertEqual(job['platforms'], job['replaces']['platforms'])
            self.assertNotIn('startapp=', job['caption'])
            self.assertRegex(job['output'], r'-e[0-2]{6}\.mp4$')
        self.assertTrue(all(set(value) == {'champion', 'candidate', 'retired'} for value in state.values()))
        self.assertEqual(summary['futureSlots'], 30)

    def test_rerun_never_reedits_already_treated_slots(self):
        manifest = self.manifest()
        jobs, state, _ = plan_cycle(manifest, METRICS, now=NOW)
        replacements = {job['replaces']['path']: job['output'] for job in jobs}
        for post in manifest['posts']:
            post['path'] = replacements.get(post['path'], post['path'])
        again, _, _ = plan_cycle(manifest, METRICS, state, now=NOW)
        self.assertEqual(again, [])

    def test_missing_stale_or_pending_analytics_do_not_trigger_edits(self):
        for report in [dict(METRICS, collected='2026-11-20T00:00:00Z'), dict(METRICS, clips=[]),
                       dict(METRICS, clips=[dict(METRICS['clips'][0], analyticsStatus='pending')])]:
            with self.assertRaises(ValueError):
                plan_cycle(self.manifest(), report, now=NOW)
        jobs, _, summary = plan_cycle(self.manifest(), dict(METRICS, accounts={}), now=NOW)
        self.assertEqual(jobs, [])
        self.assertGreater(summary['unavailableSlots'], 0)

    def test_invalid_metrics_are_excluded_and_empty_source_queue_fails(self):
        for value in [float('nan'), float('inf'), -1, '100']:
            report = dict(METRICS, clips=[dict(METRICS['clips'][0], engagedViews=value)])
            self.assertEqual(observations(report), [])
        with self.assertRaises(ValueError):
            plan_cycle(dict(replace=True, posts=[]), METRICS, now=NOW)


if __name__ == '__main__':
    unittest.main()
