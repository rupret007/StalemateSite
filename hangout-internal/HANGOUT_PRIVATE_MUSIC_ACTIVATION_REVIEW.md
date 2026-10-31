# Private browser music: activation review

Prepared October31, 2026; updated after the owner's decision that day. The
reviewed private-trial scope below is authorized, with its prerequisites still
required. No TURN/vault credential retrieval or provider configuration change
has been applied by this checkpoint. Application work proceeds directly here; shared StoryPool
state stays with its existing owner. All62 acceptance outcomes remain required.

## Recorded owner decision

Jeff explicitly authorized the reviewed private trials: one native host and
one browser guest at a time, at most ten minutes per trial, only after actual
account/free-tier headroom and normal trust checks pass. This releases the
TURN/vault hold only for that scope. Do not ask for the same authorization again.
It does not establish that a trial ran or that a prerequisite passed.

Keep in-product AI and Hang Out's separate chat/media TURN off. Preserve
resource guards, native signatures, capture consent, headphones, signing and
public-release holds. No purchase, plan upgrade or public launch is authorized.
Jeff enters any vault master password locally; credentials and session keys
must never appear in chat, commits, arguments or logs.

The successful 17:26–17:30UTC preflight confirmed normal Cloudflare OAuth
sign-in and the account's enabled Realtime entitlement. The account-wide
October TURN query returned no records, without an API error; that is not a
billing or free-headroom qualification. Subscription access returned403, and
the separate SFU usage check has not run. The earlier normal CLI vault check
reported locked. Jeff subsequently reported local sign-in; availability to the
test process still needs verification through its normal authorized flow.

## Candidate and observed baseline

The private community is `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/`.
Its protected music page is `/join/` on the same origin. Website source4ed1525 /
Worker versiona972 and native sourcebf24e7d / private package run41193954131
have their own [dated evidence](HANGOUT_PRIVATE_DEMO_PROGRESS_20261031.md).
The newer browser guidance candidate is pinned in
[`join/PROVENANCE.json`](../join/PROVENANCE.json). Obtain its actual reviewed CI
before delivery; a source pin is not deployment or physical music evidence.

The issuer metadata read at08:50–08:51UTC observed version
`e7cda1bb-be95-4824-a363-924ff6f2948b`, with desktop bindings but without separate
web bindings or a saved CORS variable. That is a dated observation; re-read the
actual current version and configuration before any approved change.

## Two Workers, separate purposes

| Destination | Unapplied change needed for browser music | Preserve |
| --- | --- | --- |
| `webjam-turn-credentials` | Separate `WEB_TURN_KEY_ID` and `WEB_TURN_KEY_API_TOKEN` secrets for a distinct web key in the existing account; exact CORS below | Existing desktop key, account/analytics secrets, Durable Object IDs, migration state and rate/usage ledgers |
| `stalemate-hangout-beta` | `WEBJAM_WEB_ORIGINS` set to `https://stalemate-hangout-beta.jeffstory007.workers.dev` after the protected page/issuer is qualified | Guest/staff admission, session keys, namespaces, moderation, age/consent rules and exact existing bindings |

The issuer's proposed `CORS_ALLOWED_ORIGINS` is
`https://stalemate.band,https://stalemate-hangout-beta.jeffstory007.workers.dev`.
This preserves the source default public origin and adds the exact private
origin. Reconcile it with current approved origins first; do not erase another
approved origin blindly. Entry badges and band-site links do not add CORS
permissions. No wildcard, copied band cookie, invitation or secret belongs here.

**Keep `HANGOUT_TURN_ENABLED=0`.** Hang Out's own chat/media `/turn` service and
its `HANGOUT_TURN_*` secrets are separate from the WebJam music issuer. Enabling
that chat/media service is unnecessary for this browser-music review. Keep
in-product AI off. Neither a desktop TURN pair nor the existing Hang Out pair
should silently become the separate web pair. Jeff unlocks his vault himself
through the approved flow if needed; no values belong in source or evidence.

## Account and cost checks before activation

Cloudflare currently documents a shared1,000GB monthly SFU/TURN allowance and
then$0.05/GB egress; Workers and Durable Objects have separate pricing.
Verify the actual account plan, combined account usage and remaining allowance
before authorizing even a private trial. A source default is not an entitlement.
[Cloudflare pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/)

The issuer source has an800GB combined desktop/web admission threshold,
200GB web sub-threshold,3,000 daily web requests and600-second credential TTL.
The app allows one web guest at a time and at most256MiB counted endpoint
traffic. Preserve the existing lower limits if the actual deployment has them.
These checks stop new issuance or the app endpoint; analytics lag, credentials
already issued, other account users and direct use of issued TURN credentials
prevent treating them as a provider-enforced account spending cap. If entitlement
or sufficient headroom cannot be established, leave issuance disabled. Do not
upgrade a plan or buy a signing service to complete this test.

The current FAQ lists the same two reviewed IPv4 relay addresses as the client.
Its DNS-change warning means that static allowlists need later operational
maintenance. This review does not change the IPv4-only client policy or qualify
live reachability. [Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/)

## Qualification and stop conditions

1. Revalidate the reviewed source/packages, actual current Worker versions,
   effective nonsecret settings and binding-name inventory. Preserve a matched
   rollback candidate and all existing state. Confirm that the recorded owner
   decision covers the trial; broader activation needs a separate decision.
2. Apply only the approved issuer/page/origin changes through the normal app
   path. Keep the public-launch, AI, native trust, signing and unrelated media
   holds intact. Do not create a second community namespace.
3. Qualify protected-page admission and outsider denial; exact allowed and
   rejected CORS; web scope; unreadable/exhausted quota refusal; sealed signaling,
   expiry/revocation, forced relay, host kick and Stop. Retain original failures
   and sanitized logs without invitation fragments or credentials.
4. Use the ARM Mini as the supported native host and actual Intel MacBook and
   Windows browser guests in separate trials. Keep the host-generated invitation
   intact. Obtain explicit capture consent and headphones; demonstrate audible
   music in both directions, interruption and clean leave. Record real networks,
   latency limits and builds. Preserve Linux and the remaining native/platform
   requirements. See [music acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md).
5. Bound each trial to one guest and at most ten minutes. Stop on unexpected
   billing/usage, origin mismatch, unverified trust, retained capture or unsafe
   recovery. Restore the reviewed configuration/assets through the normal path;
   do not delete a ledger, rotate session keys or erase another room/report.

Current dependencies remain actual account readiness, normal vault/device
access, resource admission and the physical trials. The recorded authorization
removes only its decision dependency. Preparing this review or passing fixtures
completes none of the required live outcomes.
