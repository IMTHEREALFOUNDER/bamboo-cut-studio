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
node --test tests/*.check.mjs
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

## Connect the existing Pages posting queue

The optional `publish` input is off by default. Enabling it is an explicit request to add the supplied future publication jobs to the existing media queue; the existing private game's hourly publisher then processes them. Only set it for reviewed production jobs, not the montage smoke test.

Configure in this repository:

| Kind | Name | Value |
| --- | --- | --- |
| Actions variable | `STUDIO_SOURCE_HOST` | `bamboo-cut-media.pages.dev` (already used for public source validation) |
| Actions variable | `CLOUDFLARE_ACCOUNT_ID` | The 32-character account ID owning the existing media Pages project |
| Actions secret | `CLOUDFLARE_API_TOKEN` | A token with **Account → Cloudflare Pages → Edit**, scoped to that account |
| Optional Actions variable | `STUDIO_PAGES_PROJECT` | Defaults to `bamboo-cut-media` |

Create a scoped token following [Cloudflare's CI deployment guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/). This permission is account-scoped Pages editing; it is not a Global API Key. Put its value directly in GitHub's encrypted Actions secret, never in chat, source files, public variables, jobs or logs.

Publication jobs require `page`, `output`, `caption`, `due` (ISO date with timezone) and `platforms` in addition to their source and recipe. They must correspond to validated renders. New due times must be five minutes to 28 days in the future. Existing media paths cannot be reassigned to another publication identity.

`src/publish.mjs` stages only allowlisted MP4s and a public manifest, carries over the live queue entries from the last 24 hours onward, preserves prior due times and immutable YouTube archive origins, uploads a new immutable archive before production, and checks whether the live manifest changed before writing production. A malformed/unavailable live queue aborts deployment. A repeated publication identity is deduplicated; conflicting metadata fails. No game code or account credentials are included in the media site.

The final read-before-write check reduces but cannot eliminate a race with a separate publisher. Do not enable concurrent scheduled writers from the old private workflow and the new studio. The existing scene generator still has a role until its output generation has been migrated; this patch does not disable it.

Before using per-video campaign conversions for recipe-suffixed filenames, update the private importer to recognize those filenames. The current experiment planner uses provider engagement metrics; it must not treat untracked conversions as zero.

## Integration status

This repository does not currently replace the private project's complete production pipeline. It contains the independent editor, experiment planner, public-side batch executor and optional Pages queue publisher. The publisher is implemented but has not been connected to production credentials or deployed to the live media site.

To connect production, the private orchestrator must export **only public media jobs**, persist private metrics/policy, trigger this public workflow independently and receive validated outputs before passing them to the existing publisher. The jobs must encode recipe IDs in resulting media paths so subsequent observations can be attributed to the correct treatment. Existing publication slots, deduplication and source archives must be retained. Publishing credentials and private metrics must not be put into public files or artifacts.

Generating entirely new base gameplay scenes still needs the existing scene renderer or a separately published scene renderer; modifying existing clips alone does not remove that dependency. No private workflow is disabled and no social account is newly connected by this repository. Daily private metric collection and unattended experiment planning still need their production orchestration; a successful manual render or test does not activate them. A successful demo/test is not evidence that the production integration is connected.
