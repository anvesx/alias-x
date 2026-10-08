# Verification evidence (in progress)

Recorded 2026-10-06; no claim of exact original-product parity or production deployment.

## Automated gates

`npm run check`, exit 0: strict typecheck; 27 tests, 27 pass, 0 fail.

`bash ~/.claude/skills/l8-code/scripts/selfcheck.sh src/core.ts src/store.ts src/service.ts src/slack.ts src/worker.ts test/helpers.ts test/worker.test.ts test/service.test.ts test/core.test.ts scripts/slack-tunnel-proxy.mjs src/delivery.ts test/delivery.test.ts scripts/local-recovery.mjs`, exit 0: 13 files, 0 FAIL, 0 warnings.

Independent verifier used a fresh snapshot, ran npm ci/check/migrations/selfcheck and a separate actual Worker. Replay-protection slice passed. This does not establish production D1 or original-app parity.

## Real Slack UI

The only human in the private test channel was the owner. Bot runtime allowed only that channel.

- help: rendered command help.
- create: visible alias-x announcement and ephemeral success.
- show: explicit member and creation timestamp; survived moving the checkout and restarting the Worker.
- add/remove/set: rendered 2/1/1 members respectively. The added member was the alias-x bot itself; no other human was targeted.
- list: current channel aliases rendered.
- delete: success; subsequent show returned alias-not-found.
- cap: three aliases created; fourth explicitly rejected; database contained three rows.
- mention: explicit mention in the triggering thread under alias-x.
- overlap/repeated/case: three aliases shared the same human, one token repeated and one uppercase; exactly one reply and one explicit recipient rendered. Screenshot captured outside this repo to avoid publishing private workspace UI.
- cleanup: both extra aliases deleted, with UI success and database readback leaving only alias-x-test. The second cleanup initially failed during proxy restart; state was read back before retry.

Source-visible audit rows and persistent D1 rows were checked. These do not prove OS/push notification delivery. Browser notification permission was not enabled; no multi-human delivery test was possible in the requested channel.

## Failure and boundary coverage

Automated tests cover signature/timestamp/body tampering, oversized body, workspace/channel/command/user boundaries, callback URL host, bot/edit/delete suppression, concurrency, member validation, channel/workspace isolation, Slack errors/429, code/link/Unicode boundaries, and duplicate signed command delivery. Interrupted commands never automatically re-execute a possibly committed mutation; the response explicitly asks the user to inspect state.

A live development reload interrupted one command after its alias creation and announcement. Its ledger remained processing rather than falsely marking success or re-running. State was verified via list and D1; the test alias was then deleted normally.

## Still required

Original Alias Bot command/UI/permission/notification comparison; independently observed recipient notification evidence; exact interactive Edit/Delete UI. Recovery and retention are implemented and separately verified below. The owner subsequently requested public publication to anvesx/alias-x with these verification limits retained.

## Durable recovery and actual Worker journey

The preparation and sending boundaries were injected as explicit persisted fixtures in the local D1 database; this was a controlled state simulation, not a process kill at an arbitrary live network instant. After a cold Worker restart, both records were read back in their original states. `npm run recover:local`, exit 0, invoked the actual Worker scheduled handler. The preparation record transitioned to done at attempt 2 and produced one visible alias-x reply in the intended private Slack thread. The sending record transitioned to uncertain at attempt 1, error worker_interrupted_during_send, with no second reply. A second sweep still left one visible reply. Screenshot captured outside the public repo.

A separate normal message with !alias-x-test traversed Slack -> public filtering proxy -> actual Worker -> local D1 -> Slack. Its actual event ID was stored done at attempt 1, with an explicit recipient rendered. Two signed local replays of the same event ID returned 200; the thread still displayed exactly one reply. Status/readback and rendered reply were checked; HTTP 200 alone was not treated as delivery proof.

Automated cases include known 503 preparation failure then recovery, known 429 retry-after, five-attempt exhaustion, stale preparation fencing, ambiguous send failure, interrupted send, retention boundaries, signed durable event dedup and scheduled allowlist enforcement. Membership pagination obeys one 20-second total budget. These injected failure tests are distinct from the real Slack scheduled journey.

Local recovery watcher started with npm run recover:watch; scheduled local invocations are unavailable through the public filtering proxy.

Final independent budget review used a fresh detached snapshot at /tmp/alias-final.B95TrY/clean. npm ci and npm run check exited 0; 27/27 tests passed. Repeated typecheck/test and the 13-file selfcheck exited 0 with zero FAILs and zero warnings. All three migrations applied. A separate actual Worker returned alias-x ready from health and 503 for an event request without credentials; that verification process was stopped. Review confirmed the shared 20-second membership budget, per-request eight-second timeout and stale-attempt fence. The reviewer did not independently reproduce the real Slack journeys. Exact original interactive UI, permissions and notification controls remain unverified.

## Owner-requested reply customization (2026-10-08)

Mention replies now contain only deduplicated current-member handles, without alias labels or notification-preference text. The same preference sentence was removed from help/show. Exact-output regression covers overlapping aliases and channel leavers; no reply is emitted when no recipients remain. npm run check exited 0 (27/27); changed-code selfcheck covered three files, zero FAIL/warnings. Local health connection was refused during this change, so the new rendering has NOT been retested in live Slack. Earlier Slack screenshots reflect the previous reply format.

## Remove departed recipients

Reproduced a failing regression: removing a stored member after they leave the channel was rejected by target membership validation. Removal now permits departed targets, while the actor must still belong to the channel and create/add/set still reject outside targets. npm run check exited 0, 28/28 passed; selfcheck covered two files with zero FAIL/warnings. The user’s exact failing command/error is pending; this fixes the reproduced case and is not proof of their live failure being resolved. Removing the final member still requires deleting the alias. Live Slack retest NOT RUN.

## No count quotas (2026-10-08)

The owner requested no limit on aliases per user or recipients per alias. Removed the application count caps from parsing, mutation validation and atomic insertion; old MAX_ALIASES settings are ignored. Duplicate-name and optimistic concurrency checks remain. Lists/show use continuation commands (100 aliases/200 members per page). Large mention jobs save recipient progress and split replies at whole-handle boundaries below Slack's truncation threshold. Successful chunks reset consecutive failures only, preserving the monotonic attempt fence. Membership pagination has no page-count cap, retaining its time budget and rejecting repeated cursors.

Contract-first evidence: new count/paging regressions failed against the capped implementation; large-delivery tests failed against the single-message implementation; the 105-page membership regression failed with membership_pagination_limit before that guard was replaced.

`npm run check`, exit 0:

```text
tests 39
pass 39
fail 0
skipped 0
```

Cases include one owner creating 25 aliases; create/add growing to 800 members, remove/set of those members; 105 aliases across list pages; 20,000 recipients across more than five successful chunks; later 429 preserving cursor and honoring retry-after; skipped leavers; ambiguous later send never resent; stale generation fences after a successful chunk; five interrupted preparations exhausting the separate failure counter; and migration/transaction rollback on a copy of legacy queued/preparing/sending/done rows. Existing aliases and retry budgets survive migration 0004.

The independent verifier used a fresh detached snapshot: npm ci/check and migrations 0001–0004 exited 0, 39/39 tests passed, and the changed-code selfcheck covered 13 files with zero FAIL/warnings. The count/paging/chunk/fencing slice passed review. The separate dependency audit reports three high-severity development-toolchain advisories; dependency changes are outside this slice.

Final selfcheck including the runtime driver: exit 0, 14 files, zero FAIL/warnings. The independent verifier also reproduced the corrected runtime journey in its clean snapshot with exit 0. Its isolation review confirmed the generated sweep trigger exists only in the temporary wrapper, and that SQL splitting supports the current plain-statement migrations rather than arbitrary SQL.

`npm run test:runtime`, exit 0, actual workerd and local D1:

```text
PASS: signed commands create 26 aliases from one owner; 800-member alias and show/list verified; legacy MAX_ALIASES=3 ignored.
PASS: actual workerd/D1 delivered 20,000 synthetic handles in 9 chunks; cold restart, sweep continuation, dedup and HMAC error path verified.
NOT RUN: live Slack rendering, recipient notifications or production deployment.
```

This journey applies all migrations to a temporary database and submits signed HTTP commands through the actual Worker. It checks response bodies, stored counts and explicit failure paths. Its 20,000-recipient fixture is seeded directly in D1; the Slack membership stub returns 101 pages. A cold Worker restart preserves the next-recipient cursor and aliases; HTTP-triggered scheduled sweeps complete all nine chunks, each at most 39,000 characters, with exactly one handle per recipient. Sweeps force due times in the temporary database; this proves the scheduled handler and durable continuation, not natural cron timing. The Slack transport is mocked throughout and no real person is notified.

Runtime harness failures were corrected before accepting evidence: refreshed the missing native dependency with npm ci; used the installed Miniflare options adapter and inline bundled script; applied complete multiline SQL statements through D1 batch instead of line-oriented D1 exec. No bot-source workaround was introduced for those harness issues.

The owner's already running Slack deployment was observed separately with the old three-alias cap and old reply text. This new revision is not a claim that deployment has been updated. Operators must apply migration 0004 before starting the new Worker. Physical Slack/hosting storage, payload and rate limits remain; they are not alias-count or member-count quotas.
