# alias-x

**Status: implementation in progress; exact Alias Bot parity is NOT VERIFIED.**

A channel-specific Slack alias bot using a Cloudflare Worker and D1. Local development is connected to a private, one-human test channel through a temporary HTTPS tunnel. Production deployment is NOT RUN.

## Local setup

Use Node 26 and npm 11. Run `npm ci`. Copy `.dev.vars.example` to `.dev.vars` and fill in the four values; the committed workspace/channel values are deliberately empty. Keep credentials in ignored `.dev.vars` with mode 0600; never paste them in source or logs. Configure `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, workspace `SLACK_TEAM_ID`, and comma-separated `ALLOWED_CHANNEL_IDS`. The channel allowlist must be explicit. Default alias cap is three; `MAX_ALIASES` can configure a self-hosted limit.

1. Run `npm run db:local` to apply all migrations.
2. Run `npm run dev -- --port 8787` in the first terminal.
3. Run `npm run proxy:local` in a second terminal.
4. Start `cloudflared tunnel --url http://localhost:8788` in a third terminal.
5. Run `npm run recover:watch` in a fourth terminal for local recovery/retention every 60 seconds.

The proxy exposes only `/slack/events`, `/slack/commands`, `/health`. Never expose Wrangler's local explorer routes. Update the Slack manifest URLs to the temporary tunnel, validate/update the manifest through Slack's app settings or configuration API, and install the app. Invite the bot only to the intended channel. Signed HTTP URL verification must succeed. Install/configuration tokens are separate from the bot token.

`npm run recover:local` invokes one local scheduled sweep. It uses Wrangler 4.147's documented Local Explorer scheduled API, only on localhost. Production uses the configured one-minute cron. A temporary tunnel and the local processes must remain running for local Slack tests.

Run `npm run check` for strict typecheck and tests. Run the L8 selfcheck over source, tests and scripts. Neither proves the rendered Slack UI: see [TEST-EVIDENCE.md](TEST-EVIDENCE.md).

## Commands (provisional pending original-app comparison)

`/alias-x help`, `list`, `show !NAME`, `create !NAME @members`, `set !NAME @members`, `add !NAME @members`, `remove !NAME @members`, `delete !NAME`. Mention `!NAME` in a normal message to post only deduplicated member handles in its thread. No alias label or notification-preference footer is included; if no current recipients remain, no reply is posted. Code, links, bot messages and edits are ignored.

The original's official support page confirms `/alias` and interactive Edit/Delete buttons. That UI and the advertised notification controls still require direct comparison; the current CLI alone is not exact parity.

## Reliability and operator procedure

A signed alias event is persisted before acknowledgement, retaining alias names, IDs and thread timestamp rather than message content. Immediate processing is attempted; the one-minute sweep recovers queued jobs or preparation leases older than 120 seconds. An incrementing attempt fences stale workers. Membership pagination has a 20-second total I/O budget, with an eight-second limit per request. Five attempts are allowed. Slow or repeatedly rate-limited channels can exhaust that budget and enter failed state; failures are explicit rather than silently reported as delivered.

Before posting, the job enters `sending`. A known 429 can retry after its specified delay. A lost send response, server failure, or restart during sending enters `uncertain`, because Slack may already have accepted the message. These jobs never automatically resend: Slack posting and D1 are not one transaction, and exactly-once external delivery is not guaranteed.

Inspect jobs locally with `npm exec -- wrangler d1 execute alias-db --local --command "SELECT event_id,channel,thread,status,attempt,error FROM deliveries WHERE status IN ('failed','uncertain');"`. Check the actual Slack thread before acting. If the reply exists, mark that job done. If absence has been established and another send is intended, requeue that specific job with attempt zero and a current due time. Never bulk-reset uncertain jobs. Production queries require the intended remote database explicitly; no remote database is configured yet.

Completed delivery and command ledgers expire after seven days. Failed/uncertain jobs and interrupted commands remain for 30 days. Alias configuration and audit actions are retained. Legacy event claims suppress migration-time retries; they cannot reconstruct old delivery outcomes. The sweeper handles up to ten due jobs per invocation, serially.

Slash-command bodies are hashed and atomically claimed before side effects. Completed results are cached before ephemeral delivery. An interrupted command is never automatically repeated: inspect show/list and audit before submitting another change. Creation storage and audit commit atomically; if the external announcement fails, the result explicitly says the alias was saved.

## Verification limits

Exact original UI, editing permissions, notification controls, reply placement and User Group imports are not established. Multi-human notification delivery cannot be verified in a one-human channel. Browser/OS notification permission was not enabled. The checked-in D1 UUID is a local placeholder; production deployment has not occurred.

Mention preparation is O(message length + channel aliases + channel members + selected recipients), using Maps/Sets. D1 serializes statements and batches; optimistic revisions reject stale alias mutations, and job attempts fence stale senders. A finite supported membership-read budget applies.

Public repository: `anvesx/alias-x`. Published at the owner’s request as an implementation in progress; publication does not establish exact original-product parity.
