# RESULT: Bridge slice 1, Worker room grants

**Status: DONE.** The grants module, its tests, and the hook spec are committed locally. Nothing was pushed, merged or deployed, and no existing file was edited.

- Base SHA: `4f35bc3` (`codex/game-night-rummy-ci-opening-knock-20261112`, contains `e972a46`)
- Branch: `grok/bridge-slice1-worker-20261112`
- Run: Thu Nov 12 2026, 21:26 to about 21:45 CT, model `claude-fable-5-2`

## What was built

| File | What it is |
|---|---|
| `hangout-worker/src/game-night-room-grants.mjs` | Pure, storage-injected module: `registerGrants`, `redeemGrant`, `sweep` / `expire`, `revokeAll`, `holds`, plus reconnect helpers. No route wiring. |
| `hangout-worker/tests/game-night-room-grants.test.js` | 20 vitest cases. They run against the real `createGameNightTable` class through a small adapter. |
| `BRIDGE-HOOKS.md` | Two-hook spec for the Codex multiplayer thread, with signatures, proposed patches as text (not applied) and the threat table. |

Commits: `ed1c6d0` (module and tests), `f05a459` (hook spec), plus the commit that adds this file.

## Commands run and results

| Command | Result |
|---|---|
| `npx vitest run hangout-worker/tests/game-night-room-grants.test.js` | **20 passed, 0 failed** (1 file) |
| `npx vitest run` (full suite, new file included) | 2136 passed, 28 failed, 2 skipped. 130 files passed, 14 failed, 1 unhandled error. The new file passed. |
| `npx vitest run --exclude hangout-worker/tests/game-night-room-grants.test.js` (baseline without the new file) | 26 failed tests across 17 files. I did not capture the pass count for this run. |

The failures are not from this slice. The new module is imported by nothing but its own test, and the baseline run without that test fails in the same area. Most failures are 5-second timeouts, and the set changes between runs (14 files in one run, 17 in the other), so they look load-dependent. I did not investigate or fix them.

Files that failed in the baseline run:

- `hangout-worker/tests/lobby-session-integration.test.js`
- `tests/unit/apache-public-boundary.test.js`
- `tests/unit/community-toolkit.test.js`
- `tests/unit/hangout-ai-review-engine.test.js`
- `tests/unit/hangout-hidden.test.js`
- `tests/unit/hangout-keep-signin.test.js`
- `tests/unit/hangout-lobby-client-context.test.js` (also the source of the unhandled error)
- `tests/unit/hangout-lobby-incident-sources.test.js`
- `tests/unit/hangout-lobby-media-blocking-capacity.test.js`
- `tests/unit/hangout-lobby-session-authority.test.js`
- `tests/unit/hangout-lobby-session-recovery-capacity.test.js`
- `tests/unit/hangout-message-recovery-client.test.js`
- `tests/unit/hangout-participation-partitions.test.js`
- `tests/unit/hangout-report-receipts.test.js`
- `tests/unit/hangout-sharing-controls-client.test.js`
- `tests/unit/package-pages.test.js`
- `tests/unit/sync-turdanoid.test.js`

## Required cases and where they are tested

| Case | Test |
|---|---|
| Register by host only | "lets only the seated host register" |
| Host seated first | "requires the host to be seated at a waiting table first" |
| Grants ≤ free seats, one hold per seat | "never creates more grants than free seats, with one hold per seat" |
| Redeem success burns | "seats the guest in the next seat, burns the grant…" |
| Replay → 410, same shape as stranger invitations | "answers a replay with the same 410 shape…" (compared against a real `gameInvitationRequest` 410) |
| Host subject redeem rejected | "rejects the host session and leaves the grant for the guest" |
| Guest never gets seat 0 | "never gives a guest seat 0, even when the table port misbehaves" |
| Expiry releases the hold, table stays waiting | "rejects an expired grant, releases its hold and leaves the table waiting" |
| Third person → table full | "tells the third person the table is full" |
| Two concurrent redeems for the last seat | "lets exactly one of two concurrent redeems win the last seat" |
| `revokeAll` | "revokes every unclaimed grant in one room when the host leaves" |
| Raw value never stored | "stores hashes only, never the one-time value" |
| No logging | "never writes to the console" |
| Reconnect 60 s as data | "keeps a disconnected guest seat for 60 seconds" |

## Decisions taken (safest default, per the retry note)

- **Host check is session-bound.** `hostSubject` must equal the subject in seat 0 of a waiting table. The route must take it from the host's session, never from request data.
- **Surplus hashes become standby markers.** A standby value gets "Table full, you're up next game" (409) rather than the 410 copy. It is not promoted if a seat frees up later; the host registers a fresh grant instead.
- **A burn is final, with no retry.** The grant is burned before the seat call. If seating then fails, the guest sees "table full" and the host has to issue a new grant.
- **Host redeem does not burn.** The host gets 403 and the guest's grant stays valid.
- **Unknown and malformed values look expired** (410), so a caller cannot tell them apart.

## Open questions

1. **Hook 1 is a hard dependency.** Table subjects are assigned when the guest's socket sends `join`, not at redeem time. In production the module's `seat` call should move the hold to the new guest session for 60 s, and the socket `join` then takes the seat. That needs the hold support specified in `BRIDGE-HOOKS.md`. Until it lands, holds only protect a seat against other grants, not against a stranger invite link or a room member's Play tap.
2. **Result status for table full.** I used 409. If the guest page would rather reuse the 410 path with different copy, it is a one-line change.
3. **Invite version.** Grants are not tied to `HANGOUT_BETA_INVITE_VERSION` the way stranger invitations are. With a 2-minute TTL I judged it low risk. Say if you want parity.
4. **Value format.** The module accepts 32 to 128 URL-safe characters and hashes them as UTF-8 with SHA-256, hex output. The WebJam side (task 2) must produce the same hash. This is not yet agreed with that branch.
5. **`ref`.** The existing guest cookie mint (`gameGuestScope`) needs the room's `ref`. `registerGrants` takes it as an optional extra argument beyond the contract's signature and passes it through.
6. **Route tests and the host confirm tap** are not covered here, because this slice has no routes or pages. They are listed in the threat table as tests to write with hook 2.

## Limits respected

- No push, PR, merge or deploy. Local commits only, added by explicit path.
- `node_modules` and `PROMPT.md` are untracked and were not added.
- No tokens, IPs, invite links or meeting links are in any file. Test values are obvious placeholders.
