# alias-x

**Status: implementation in progress; exact Alias Bot parity is NOT VERIFIED.**

A channel-specific Slack alias bot using a Cloudflare Worker and D1, with no application-imposed alias-count or member-count quotas. Slack and the hosting provider's storage, request-size and rate limits still apply. The latest source has not been deployed by this project; the owner's separately running deployment may use an older revision.

## Local setup

Use Node 26 and npm 11. Run `npm ci`. Copy `.dev.vars.example` to `.dev.vars` and fill in the four values; the committed workspace/channel values are deliberately empty. Keep credentials in ignored `.dev.vars` with mode 0600; never paste them in source or logs. Configure `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, workspace `SLACK_TEAM_ID`, and comma-separated `ALLOWED_CHANNEL_IDS`. The channel allowlist must be explicit. No per-user, per-channel or per-alias count quota is enforced; old `MAX_ALIASES` settings are ignored.

1. Run `npm run db:local` to apply all migrations.
2. Run `npm run dev -- --port 8787` in the first terminal.
3. Run `npm run proxy:local` in a second terminal.
4. Start `cloudflared tunnel --url http://localhost:8788` in a third terminal.
5. Run `npm run recover:watch` in a fourth terminal for local recovery/retention every 60 seconds.

The proxy exposes only `/slack/events`, `/slack/commands`, `/health`. Never expose Wrangler's local explorer routes. Update the Slack manifest URLs to the temporary tunnel, validate/update the manifest through Slack's app settings or configuration API, and install the app. Invite the bot only to the intended channel. Signed HTTP URL verification must succeed. Install/configuration tokens are separate from the bot token.

`npm run recover:local` invokes one local scheduled sweep. It uses Wrangler 4.147's documented Local Explorer scheduled API, only on localhost. Production uses the configured one-minute cron. A temporary tunnel and the local processes must remain running for local Slack tests.

Run `npm run check` for strict typecheck and tests. Run `npm run test:runtime` for the actual local workerd/D1 journey with mocked Slack transport; it uses a temporary database and synthetic IDs, without reading local credentials or notifying humans. Run the L8 selfcheck over source, tests and scripts. These checks do not prove the rendered Slack UI: see [TEST-EVIDENCE.md](TEST-EVIDENCE.md).

## Commands (provisional pending original-app comparison)

`/alias-x help`, `list [!AFTER_ALIAS]`, `show !NAME [PAGE]`, `create !NAME @members`, `set !NAME @members`, `add !NAME @members`, `remove !NAME @members`, `delete !NAME`. Mention `!NAME` in a normal message to post only deduplicated member handles in its thread. Slack delivers native notifications according to each recipient's Slack preferences. No alias label or notification-preference footer is included; if no current recipients remain, no reply is posted. Code, links, bot messages and edits are ignored.

Lists display 100 aliases per page; show displays 200 members per page. The response supplies the next command. These page sizes do not cap storage. Commands have a 12,000-character safety limit (65,536-byte signed request limit); use repeated `add` commands to grow large groups. An alias must retain at least one member; delete it to remove the final member.

The original's official support page confirms `/alias` and interactive Edit/Delete buttons. That UI and the advertised notification controls still require direct comparison; the current CLI alone is not exact parity.

## Reliability and operator procedure

A signed alias event is persisted before acknowledgement, retaining alias names, IDs and thread timestamp rather than message content. Immediate processing is attempted; the one-minute sweep recovers queued jobs or preparation leases older than 120 seconds. An incrementing attempt fences stale workers. Membership pagination has no page-count cap, with a 20-second total I/O budget and an eight-second limit per request. Five consecutive failures are allowed; successful chunks reset the failure budget, without resetting the fencing generation. Slow or repeatedly rate-limited channels can exhaust that budget and enter failed state; failures are explicit rather than silently reported as delivered.

Large mention replies are split at whole-handle boundaries into messages of at most 39,000 characters, below Slack's 40,000-character truncation boundary. D1 saves the deduplicated recipient snapshot and the next recipient index. Each invocation sends at most one chunk per job; subsequent chunks continue on scheduled sweeps, with channel membership checked again to skip leavers. Saved progress avoids repeating already delivered recipients after a known rate limit. This uses native Slack messages only.

Before posting, the job enters `sending`. A known 429 can retry after its specified delay. A lost send response, server failure, or restart during sending enters `uncertain`, because Slack may already have accepted the message. These jobs never automatically resend: Slack posting and D1 are not one transaction, and exactly-once external delivery is not guaranteed.

Inspect jobs locally with `npm exec -- wrangler d1 execute alias-db --local --command "SELECT event_id,channel,thread,status,attempt,failures,next_recipient,error FROM deliveries WHERE status IN ('failed','uncertain');"`. Check the actual Slack thread before acting. For a partial large reply, establish the first recipient still requiring delivery by inspecting the accepted chunks; update that specific job's cursor accordingly. If every intended recipient has already been delivered, mark it done. Requeue only after the current chunk's outcome has been established, preserving the monotonic attempt generation and confirmed progress, resetting failures to zero and setting a current due time. Never bulk-reset uncertain jobs. Production queries require the intended remote database explicitly; no remote database is configured here.

Upgrade: apply migration `0004.sql` to the intended database before starting the new Worker. It adds recipient progress and a separate failure counter while preserving aliases and existing delivery states. Local use: `npm run db:local`; production operators must target their own remote database configuration explicitly.

Completed delivery and command ledgers expire after seven days. Failed/uncertain jobs and interrupted commands remain for 30 days. Alias configuration and audit actions are retained. Legacy event claims suppress migration-time retries; they cannot reconstruct old delivery outcomes. The sweeper handles up to ten due jobs per invocation, serially.

Slash-command bodies are hashed and atomically claimed before side effects. Completed results are cached before ephemeral delivery. An interrupted command is never automatically repeated: inspect show/list and audit before submitting another change. Creation storage and audit commit atomically; if the external announcement fails, the result explicitly says the alias was saved.

## Verification limits

Exact original UI, editing permissions, notification controls, reply placement and User Group imports are not established. Multi-human notification delivery cannot be verified in a one-human channel. Browser/OS notification permission was not enabled. The checked-in D1 UUID is a local placeholder; production deployment has not occurred.

Mention preparation is O(message length + channel members + selected recipients), plus indexed lookup of only the selected alias names, using Maps/Sets. D1 serializes statements and batches; optimistic revisions reject stale alias mutations, and job attempts fence stale senders. A finite supported membership-read budget applies.

Public repository: `anvesx/alias-x`. Published at the owner’s request as an implementation in progress; publication does not establish exact original-product parity.
