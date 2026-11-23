# BAMBOO CUT Studio

A standalone, source-available montage tool. It processes existing vertical clips and evolves bounded editing recipes from aggregate observations. No game server, game engine, account tokens, database exports or private repository checkout is included.

## What works

- New combinations of tempo, a slow segment around an impact, regional camera zoom/pan, camera rhythm and audio level accents. Six ternary axes identify a reproducible recipe; invalid expressions are rejected.
- Timing-sensitive memory/choice scenes retain their original timing. The final end card retains its normal playback speed. Camera changes stay in the gameplay region, outside the headline.
- Full output decode and file-size validation before accepting an edited clip.
- A deterministic allocation of 20% original control, 60% current measured incumbent and 20% experimental composition. When the incumbent is still the original, that means 80% original and 20% experiments on average.
- Trials persist through an explicitly supplied previous policy. Promotion requires at least six usable observations per alternative from at least two posting dates, age-cohort comparison, a positive bootstrap difference and no drop in the quality metric. A clearly worse incumbent can roll back to the original.

The planner uses observational comparisons, not randomized audience experiments. It cannot guarantee views, causal improvement or professional creative quality. It generates compositions of implemented primitives; it does not write arbitrary new editing code or invent unlimited new techniques.

## Local use

Requires Node 22+, Python 3.11+, FFmpeg and ffprobe. No npm/Python packages, registrations or paid model API are required by the tools.

```sh
node --test tests/edit.check.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
node src/cli.mjs --jobs examples/jobs.json --out dist
```

For the example, supply `examples/source.mp4`: an existing 1080×1920 MP4 under 60 seconds. `examples/jobs.json` explicitly chooses a montage; it is not a fake production queue.

To assign treatments from an aggregate metrics report:

```sh
python src/plan.py --metrics /private/metrics.json --previous /private/policy.json --jobs examples/jobs.json --out /private/next
node src/cli.mjs --jobs /private/next/jobs.json --out dist
```

The metrics report uses `collected`, `accounts` and `clips`; clip fields are `account`, `id`, `path`, `posted`, `analyticsStatus` and numeric provider metrics. YouTube compares engaged views and average viewed percentage. Instagram compares reach and shares/saves per reach. Pending/unavailable records and duplicate clip IDs are excluded. File paths ending in `-e001000.mp4` identify the recipe. Old paths without the suffix are original controls. Keep raw metrics and policy files outside the public repository.

## Public GitHub Actions

`Studio checks` builds actual test clips, applies recipes and decodes the output. `Render montage batch` runs independently in this repository and accepts either a public render-jobs URL or inline jobs JSON supplied by the repository owner. Supply exactly one input; include only public media URLs. Set repository variable `STUDIO_SOURCE_HOST` to the exact trusted public media hostname; remote sources and the jobs JSON must use that HTTPS host with no credentials or signed query strings. Jobs are limited to 105 and each media source to 25 MiB. Artifacts expire after three days.

Standard GitHub-hosted runners in a public repository are currently free of per-minute charges. This is subject to GitHub's limits, storage rules and acceptable-use terms, not an unlimited rendering entitlement. Calling this workflow as a reusable workflow from a private repository does not move billing to the public repository.

- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features

## Integration status

This repository does not currently replace the private project's complete production pipeline. It contains the independent editor, experiment planner and public-side batch executor.

To connect production, the private orchestrator must export **only public media jobs**, persist private metrics/policy, trigger this public workflow independently and receive validated outputs before passing them to the existing publisher. The jobs must encode recipe IDs in resulting media paths so subsequent observations can be attributed to the correct treatment. Existing publication slots, deduplication and source archives must be retained. Publishing credentials and private metrics must not be put into public files or artifacts.

Generating entirely new base gameplay scenes still needs the existing scene renderer or a separately published scene renderer; modifying existing clips alone does not remove that dependency. No private workflow is disabled and no posting account is connected by this repository. A successful demo/test is not evidence that the production integration is connected.
