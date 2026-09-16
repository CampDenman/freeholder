<!--
Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: Apache-2.0
-->

# What "update" means on your target

*MASTER.md §39.8, checklist item C10.10.*

Updating is a step in the recipe, not one script. Three of the Tier-1 targets
mean genuinely different things by the word, and the difference decides what
has to survive for a rollback to be possible at all.

| Strategy | Targets | Update does | Rollback needs | Cutover takes |
|---|---|---|---|---|
| `image-swap` | `digitalocean-droplet`, `docker-selfhost` | Pull the new image digest and restart the container in place. | the previous image digest | seconds |
| `deploy-hook` | `digitalocean-app`, `render`, `railway` | Hand the new image to the platform's deploy API and let it perform the swap. | the previous deploy spec | a minute or two |
| `source-pull` | `replit` | Fetch source, install dependencies, rebuild and restart. | the previous commit | minutes |

If you leave automatic updates on (C10.08), the third column is what your site
does at 03:00. On Replit that is minutes of rebuild, not seconds of container
restart, which is worth knowing before you decide.

## Telling the platform which one you are

```
FREEHOLDER_RECIPE_TARGET=digitalocean-droplet
```

**Without it, an update migrates and smokes but swaps nothing.** It will look
like it worked. `freeholder doctor` warns about this under `update.target`,
because guessing a deploy strategy from the environment and then running a
container command against it is how an update takes down a host nobody meant
to touch.

## Where the commands live

`recipe.yaml` is the source of truth an owner reads:

```yaml
operations:
  update: "docker compose -f deploy/docker-selfhost/infra/compose.yml pull && …"
  rollback: "FREEHOLDER_IMAGE=$PREVIOUS_FREEHOLDER_IMAGE docker compose … up -d"
update:
  strategy: image-swap
  rollback: compose pull the previous tag
```

A standalone build does not ship `deploy/`, so the same commands are embedded
in `src/core/update/targets.ts`. `tests/core/update-targets.test.ts` fails if
the two ever disagree — an updater that cannot find its own instructions at the
moment it is asked to update is worse than one that never offered.

The variables a rollback is given are the artifact its strategy needs:
`PREVIOUS_FREEHOLDER_IMAGE`, `PREVIOUS_FREEHOLDER_APP_SPEC`,
`PREVIOUS_FREEHOLDER_IMAGE_TAG` or `PREVIOUS_FREEHOLDER_TAG`.

## The gate

`scripts/recipe-update-actions.mjs` runs once per target inside the recipe
matrix. §39.8: *"A recipe without a tested update path is not Tier 1, for the
same reason one without a migration path is not."* It proves, per recipe:

- the declared strategy is the one §39.8 assigns that target;
- `operations.update` is actually that shape — a `deploy-hook` recipe cannot
  quietly declare `image-swap`;
- `operations.rollback` names a *previous* artifact, so it is a rollback and
  not a redeploy of the same build;
- the update pins an image tag, directly or through a script it runs.

It does **not** call `doctl`, `render` or `railway`. A green build must not
depend on a third party's API being up, and a CI run that really redeployed
would be deploying from a pull request.

### The bug this found

Before this gate, all six recipes declared `strategy: image-swap` — including
Replit, which has no image and rebuilds from source, and App Platform, which
hands the image to `doctl`. The declaration was a comment nobody checked, and
the updater would have run the right command for the wrong stated reason. Three
of the six are now corrected.
