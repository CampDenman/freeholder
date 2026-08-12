# Generated image descriptions

Copyright (C) 2026 Tony Aly
SPDX-License-Identifier: AGPL-3.0-only

Freeholder can ask an optional vision provider for an image alt-text proposal.
It never treats generated words as authored accessibility copy. Generation
writes only to `media_alt_text_suggestions`; `assets.alt_text`, which the public
site renders, changes only after a signed-in person reviews an editable
proposal and explicitly accepts it.

## Configure the optional provider

The feature is off by default and authored alt text remains fully functional.
To enable the included adapter, select it in `freeholder.config.ts`:

```ts
export default defineConfig({
  // ...the rest of this instance's choices
  adapters: { ai: "openai" },
});
```

Then provide credentials and choose the model explicitly:

```dotenv
OPENAI_API_KEY=your-existing-key
OPENAI_ALT_TEXT_MODEL=your-vision-capable-model
```

Freeholder does not provision an account, choose a paid model, or make a test
request during boot or doctor. A provider request occurs only when a signed-in
person with media-management access clicks **Generate suggestion**. The raw
HTTP adapter follows OpenAI's documented [Responses API image-input
shape](https://developers.openai.com/api/docs/guides/images-vision) and asks
the provider not to store the response.

## Privacy, cost, and review boundary

- The provider receives the smallest useful WebP rendition, normally at most
  800 pixels wide. A provider-compatible original is used only if no rendition
  exists, and the adapter refuses inputs over 5 MB.
- The interface explains the transfer before the person requests it.
- Calls time out after 30 seconds and are limited to five per image per hour.
- API-key actors cannot generate, accept, or dismiss. Those operations are not
  advertised as MCP tools. An agent can still read authored alt text and the
  ordinary media contract when scoped to do so.
- Provider/model, prompt version, source checksum, requester, reviewer and
  decision time remain in the review ledger. Generated wording is not copied
  into events or logs.
- A changed image or newly authored description makes an older proposal stale.
  Acceptance fails rather than overwriting the newer work.

OpenAI usage, retention and regional terms remain the instance owner's
responsibility. Set `adapters.ai` back to `none` to disable all new provider
requests without deleting authored descriptions or review history.

## Verification

1. Run `pnpm doctor`. With the feature disabled it should warn that authored
   descriptions still work. With OpenAI selected it must name any missing
   variable, or report the configured provider/model without making a request.
2. Upload a disposable image, generate a proposal, and confirm the public image
   still has its prior alt text (or none).
3. Edit the proposal and accept it. Confirm the public image now uses exactly
   the reviewed wording.
4. Generate another proposal, author different alt text in the ordinary field,
   and confirm the older proposal cannot overwrite it.
5. Dismiss a proposal and confirm authored alt text does not change.

Migration `0030_tired_northstar.sql` adds only the normalized review table,
status/review/length constraints, indexes and its cascading asset reference.
The previous release does not know about the table and remains read/write
compatible during rollback. Do not reverse the migration merely to disable
suggestions; change the adapter choice instead.
