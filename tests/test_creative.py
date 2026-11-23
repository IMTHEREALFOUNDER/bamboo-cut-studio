import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from creative import CONTROL, choose, compare, evolve, new_recipe, normalize
from plan import observations


class CreativeTest(unittest.TestCase):
    def rows(self, candidate_good=True):
        return [dict(account='yt:official', page='test', scene='pilot', recipe=recipe, cohort=i % 2,
                     posted=f'2026-11-{10+i%2:02d}T12:00:00Z',
                     audience=200 if (recipe != CONTROL) == candidate_good else 20,
                     quality=95 if (recipe != CONTROL) == candidate_good else 25)
                for i in range(12) for recipe in (CONTROL, '001000')]

    def test_promotes_only_supported_improvement(self):
        self.assertEqual(compare(self.rows(), '001000', CONTROL)['verdict'], 'promote')
        self.assertEqual(compare(self.rows()[:8], '001000', CONTROL)['verdict'], 'collecting')
        self.assertEqual(compare(self.rows(False), '001000', CONTROL)['verdict'], 'retire')

    def test_mutation_and_assignment_are_deterministic_and_bounded(self):
        recipe = new_recipe(CONTROL, 'quiz', [], 'example')
        self.assertEqual(recipe, new_recipe(CONTROL, 'quiz', [], 'example'))
        self.assertEqual(recipe[:2], '00')
        self.assertNotEqual(recipe, CONTROL)
        self.assertEqual(normalize('222222', 'quiz'), '002222')
        policy = evolve([])
        choices = [choose(policy, 'yt:official', 'test', 'pilot', i) for i in range(1000)]
        self.assertTrue(100 < sum(c != CONTROL for c in choices) < 300)

    def test_promoted_recipe_seeds_a_new_trial_and_keeps_control(self):
        key = 'yt:official|test|pilot'
        old = {key: {'champion': CONTROL, 'candidate': '001000', 'retired': []}}
        policy = evolve(self.rows(), old)
        self.assertEqual(policy[key]['champion'], '001000')
        self.assertNotIn(policy[key]['candidate'], (None, CONTROL, '001000'))
        self.assertIn(CONTROL, [choose(policy, 'yt:official', 'test', 'pilot', i) for i in range(100)])
        self.assertEqual(old[key]['champion'], CONTROL)

    def test_pending_analytics_and_duplicate_ids_never_train(self):
        row = dict(id='one', account='yt:official', path='w05/day29/test-1-pilot-e001000.mp4',
                   posted='2026-11-17T12:00:00Z', analyticsStatus='pending', publicViews=9999)
        report = dict(collected='2026-11-23T12:00:00Z', accounts={'yt:official': {'status': 'ok'}}, clips=[row, row])
        self.assertEqual(observations(report), [])
        row.update(analyticsStatus='ok', engagedViews=20, averageViewPercentage=75)
        self.assertEqual(len(observations(report)), 1)


if __name__ == '__main__':
    unittest.main()
