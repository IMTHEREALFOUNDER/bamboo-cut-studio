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

Requires Node 22+, Python 3.11+, FFmpeg and ffprobe. The editor and planner have no package dependencies. Live analytics uses the pinned Neon serverless driver (`npm ci --ignore-scripts`). No paid model API is required.

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

## Daily measured montage

`Daily measured montage` connects live analytics, persistent recipe choices, rendering and replacement of existing future publication slots. It is scheduled for **06:47 Moscow time**. Scheduled execution is gated by the repository variable `STUDIO_AUTOPILOT_ENABLED=true`; leave it unset until the live preview and publication checks succeed. Manual runs default to preview (`publish=false`), collect real metrics and validate edits without deploying them.

The Cloudflare connection was verified using `Check Cloudflare connection`. This confirms access to the existing project; it does not itself test publication or analytics access.

The analytics runner additionally needs these **Actions secrets in this repository**:

| Studio secret | Same existing production value |
| --- | --- |
| `STUDIO_DATABASE_URL` | `PROD_DATABASE_URL` in the private project; preferably a separately scoped read-only database role with SELECT on `social_accounts` and `social_posts` |
| `STUDIO_SOCIAL_TOKEN_KEY` | `PROD_SOCIAL_TOKEN_KEY` |
| `STUDIO_YT_CLIENT_ID` | `PROD_YT_CLIENT_ID` |
| `STUDIO_YT_CLIENT_SECRET` | `PROD_YT_CLIENT_SECRET` |

GitHub cannot reveal or copy existing secret values between repositories. Enter the values directly in GitHub Secrets from your own credential records. Never put them in chat, public variables, source or workflow inputs. The database URL and token key together allow reading connected account tokens: only trusted maintainers should have write access to this studio. The code reads the two social tables in an enforced read-only transaction, decrypts existing tokens and refreshes YouTube grants in memory; it does not update account credentials or touch game/player tables.

YouTube inventory walks the channel uploads playlist, including videos unknown to the publisher. Unknown paths and unavailable/pending analytics remain visible in the temporary report but cannot train recipes. Numeric engagement metrics must be present; missing metrics do not become zero. Instagram collects core insights and optional available watch-time metrics. No TikTok analytics, Studio-only swipe-away rates, or unexposed metrics are inferred.

The cycle plans a rolling window **12–36 hours ahead**. It keeps originals as controls, edits eligible candidate/champion slots and replaces only the same page/platform/due time. Other platforms on a shared post remain intact. Already suffixed clips are never edited again. Publication rejects replacements less than six hours ahead or whose source metadata changed after planning. It does not add new posts or increase posting frequency. Existing deep-link campaign parameters are removed from replacement captions to avoid claiming attribution to the old clip; per-video conversion learning remains disabled until the private importer supports recipe paths.

Raw metrics stay in the runner's temporary work directory and are deleted even after failure. No analytics artifact is uploaded. The cache contains only champion/candidate recipe IDs and retired recipes, with no video IDs, provider metrics or statistical samples. Publication uses the same serialized render concurrency group as manual batch publication. Schedule delays remain subject to GitHub's queue.

### Activation and remaining boundaries

1. Add the four analytics secrets; keep scheduled activation disabled.
2. Run `Daily measured montage` with `publish=false`. Confirm live coverage and full decode checks.
3. Run once with `publish=true`; verify the new manifest and the existing publisher importing the replacement slots.
4. Coordinate with the old private scene workflow so it cannot write a competing manifest, then set `STUDIO_AUTOPILOT_ENABLED=true`.

Generating new base scenes remains the existing renderer's responsibility. This cycle edits its upcoming source slots; it does not create a fresh source-video schedule after that queue is exhausted. An empty planning window fails with an explicit replenishment error. Neither the old private renderer nor the existing social publisher is disabled by this change. A successful test/preview is not evidence of live publication, a complete source-renderer migration or guaranteed growth.
