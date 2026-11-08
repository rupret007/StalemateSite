# Private release candidate: current handoff

**The application has made measurable progress, but the release candidate is
pending.** This handoff records the private runtime delivered November 8 UTC
(November 7 in Texas). It preserves all
[62 acceptance requirements](HANGOUT_ACCEPTANCE_REQUIREMENTS.md). It is not a
public-launch approval. The two public websites have not been changed.

## Start here

The browser lobby is ready for further private evaluation. Actual Intel Mac
WebKit and Windows Chrome checks on the current runtime passed chat, both
entrances, reconnect, mobile containment and logout. Music still needs the
current Mac-host-to-Windows listening and instrument checks, desktop backing-track
playback and actual Webex handoff. Earlier human listening and generated-audio
successes have different build/platform scopes and do not complete those checks.

| Component | Exact identity |
| --- | --- |
| Reviewed website source, [PR 236](https://github.com/rupret007/StalemateSite/pull/236) | `ac9b82f42c8d6952193f5cbefbf11fc04816821d` |
| Application branch merge | `84e77d6d8513a4f8ecce713835b97aa3a547b66c` |
| Identical source/merge tree | `7037bd7b5a4b32841af313402545256b5943053e` |
| Private Worker version | `449fe7d2-0ac3-41b8-b622-fda2453b38db` |
| Private deployment, 100% at readback | `9c793eb0-60a9-4c45-91b1-76cf3918ed61` |
| Deployed Worker JavaScript SHA256 | `12280eb44c9893200a699badda53226b80ab8a5b5b953292bfacc7f843df3ee8` |
| Imported Web Join source, [WebJam PR 452](https://github.com/rupret007/webjam/pull/452) | `5dde45d2e841fd19ff9c1fd055f88520fbf778e4` |
| Staged native packages, unchanged | `76b1fd74c0f8a77df2c9d6b42f7fde87dadfaf7c` |
| Unchanged private TURN issuer version | `4db649fa-a465-44b4-8487-414987b3a660` |

Delivery independently matched all 66 backend source contents and the compiled
Worker bytes. All 17 effective plain settings, secret binding names, namespaces,
issuer and existing relay-cap marker were preserved. Do not redeploy this
candidate just because an old preparation controller still exists. Its exclusive
delivery receipt records the completed attempt.

Application work proceeds independently of StoryPool/Karen, as Jeff requested.
Use isolated application worktrees and existing app CI. Do not change installed
StoryPool, shared services, CI workflows, conductor state or shared operational
files. Public release, AI, separate Hang Out chat/media TURN, trust controls,
spending limits and existing provider holds remain unchanged.

## Demonstrated results and their limits

| Evidence | Actual result | What it does not prove |
| --- | --- | --- |
| Exact-source application CI | All three pre-merge and four automatic post-merge runs passed; full raw logs and actual checkout trees reviewed. Each main job reports 2,091 units in 138 files, 821 browser cases and 34 + 34 smoke checks. Pages deployment was skipped. | Physical listening, hosted provider-start or a new native binary. Native runtime CI modes remain distinct from the separately requested native provider-start mode. |
| Current Intel Mac SDK WebKit 27.2 | Twelve hosted stages; fourteen served runtime assets matched. Both branded guests chatted, a reconnect retained a private draft with fresh scrollback, Art guests shared a stroke, host/guest topic permissions differed correctly, inert Jam invitations shared, own rooms closed and both logouts revoked copied cookies. | Physical Safari/iPhone, real microphone, live music or YouTube playback in this run. |
| Current Windows installed Chrome | Seven hosted stages; fourteen actual runtime assets matched. Both entrances, reciprocal source badges, fresh join, reconnect, simulated mic-denial recovery and logout/revocation passed. | Actual microphone permission/device routing, speech, instruments or a native Windows install. |
| Four current mobile viewport screenshots | Mac and Windows at 375/390px were inspected. Page width equals viewport width; text wraps; input and Send are contained; inputs measure 16px. Starter/action rows scroll inside their own rows. | A physical iOS keyboard, screen-reader speech or full WCAG 2.2 AA. At 375px the Windows header wraps; trailing row controls require horizontal scrolling. |
| Owned-resource cleanup | Separate readbacks matched the same browser proofs/harnesses and confirmed owned test processes gone. Windows listener/task were absent and PowerShell remained Restricted. | Changes to or validation of unrelated user processes/services. |
| Original repaired eight-hour expiry, previous C227 runtime | Completed at `2026-11-08T01:16:39.482Z`. Original and identical expired signed-cookie requests and protected code all returned 401; actual socket ended with 4401. Owned observer and awake assertion independently gone. | An eight-hour run on current version 449 or uninterrupted uptime. Five recovered abnormal closes occurred during this baseline. |
| Current 110-minute hosted heartbeat observation | Completed `03:23:23.527Z` November 8: 10 actual ping/pong pairs, one socket open, zero closures, logout 200 and all browser resources closed. Same proof/harness and owned Node/awake exits independently verified. | An eight-hour current-version run, proof of the earlier disconnect cause, or a guarantee that heartbeats prevent every network disconnect. |

The original observer controller received an `HTTPError` during its final
metadata read after the browser passed. The automatic watcher then encountered
a missing-field `KeyError` and attempted no readback. Both original failures and
hashes are retained. An independent readback of the same completed browser
receipt verified exact proof/harness and process cleanup; a separate normal CLI
auth/read-only metadata check returned 200 for deployment, issuer and settings
and matched the unchanged cap marker. No browser, guest or observation was
restarted. The original HTTP status/response was not retained, so its precise
cause remains unassigned. Do not describe the original controller as a clean pass.

The [sanitized evidence packet](../pr-assets/beta-collaboration/20261108/current-private-readiness/receipt.json)
records source identities, receipt hashes, measurements and limitations. Raw
credentials, invitation values and recordings are excluded. The screenshots
contain synthetic test messages only.

Setup observations, with different timing boundaries:

| Endpoint | Stalemate | Rad Dad | Manual reconnect |
| --- | --- | --- | --- |
| Intel SDK WebKit | 955 ms | 916 ms | 325 ms |
| Windows Chrome | 3,223 ms | 1,080 ms | 283 ms |

The Mac timer starts at invitation submission; Windows starts before loading
the entry page and filling the invitation. Both include automated nickname
entry. These are individual automation samples, not a cross-platform speed
comparison, service-level target, percentile measurement or audio latency.
Human reading, typing and device setup will take longer.

The first Windows controller stopped before staging or browser launch; its cause
remains unknown. Read-only diagnostics confirmed no test source, profile, proof,
listener or task existed. After available memory recovered above the unchanged
2 GiB guard, one guarded continuation completed the first browser run. The
original stop was retained. A separate local command-size check also stopped
before remote execution; a duplicated check was removed without changing the
6,500-character command limit or the existing stage-before-write source check.
Neither event is silently relabeled as an initial pass.

The repaired C227 baseline recorded five 1006 closes with automatic reopen gaps
of 1,158–1,259 ms. Their cause and delivery during those gaps are unproven. The
final 4401 was observed 81 ms before nominal expiry on the Mac clock, within the
existing 1.5-second clock tolerance; this is not exact server timing. The new
heartbeat uses the existing prepaid/rate/lifetime limits and never renews
authentication. Source regression and native short-expiry checks remain separate
from the actual hosted observations. See
[the heartbeat design](HANGOUT_IDLE_HEARTBEAT_20261107.md).

## Shortest path to the remaining essential checks

No action is needed while Jeff is asleep. Do not repeatedly restart sessions,
request capture permissions or install audio drivers unattended. Resume with one
bounded test and retain its exact build, route, result and teardown together.

1. **Speech and music:** MacBook native host with built-in mic and wired
   headphones, Windows Chrome guest with a working headset. Recheck device trust,
   resource guards, actual current account allowance and unchanged cap hold
   before starting a one-host/one-guest trial of at most ten minutes. Hear speech
   both ways, then a short musical passage. For the actual band arrangement,
   use Jeff's SSL 2+ with guitar/vocal inputs and Che's drum interface when its
   model and channel mapping are known. An empty interface cannot prove music.
2. **Desktop Shared Track:** install the already verified official BlackHole
   16ch package normally on the MacBook when Jeff is awake. The recorded observer
   and cleanup have finished; save other work before any requested reboot. Keep the real
   musician input/output as the primary route. BlackHole supplies the separate
   backing client, not the primary mic/guitar. Use a short rights-cleared WAV;
   hear it at the remote guest, check level/mute, pause/restart and clean ending.
   Then check MP3 through the packaged decoder. Follow
   [the Shared Track setup guide](HANGOUT_SHARED_TRACK_NEXT_CHECK_20261107.md).
3. **Webex:** after baseline audio passes, open the existing meeting externally
   with explicit microphone/camera consent. Verify video and the documented
   manual switch between meeting audio and WebJam. Never play both paths at
   once. There is no embedded web meeting or automatic cross-app mute. See
   [the manual handoff](HANGOUT_WEBEX_AUDIO_HANDOFF.md).
4. **Second network:** repeat the bounded core trial on a hotspot or Che's
   connection when available, recording the actual candidate path and dropouts.
   The production privacy filters deliberately exclude host/LAN/Tailscale
   candidates; sharing Wi-Fi does not establish direct media. Do not open router
   ports or weaken candidate filtering to manufacture a direct-path result.
5. **Human moderation:** Jeff's real moderator session must review and dismiss
   only the identified harmless acceptance report. Do not automate a dismissal
   and describe it as human review, punish a test nickname or touch other reports.
6. **Broader use:** complete the remaining registered-room recovery, physical
   mobile/accessibility, capacity and operator checks in the acceptance audit.
   Existing generated audio, local load and automated semantics remain useful
   evidence within their stated scopes.

The Windows participant can use Chrome without installing the native client.
Native Windows remains unsigned/trust-blocked; do not bypass policy or purchase
signing. Linux browser generated-audio and package/CI results do not establish
attended Linux native music. Intel and ARM packages are verified artifacts;
each physical host role still needs its specified route/listening qualification.

## Integration and operations handoff

Use one canonical community, directory, identity and moderation model. The
staging entrance URLs contain no invitation:

- `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/?via=stalemate`
- `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/?via=rad-dad`

The badge is arrival context, not identity or permission. A plain link needs no
website credential or cross-domain cookie. Keep `referrerpolicy="no-referrer"`
in the supplied link snippets. A neutral future-site link can reach the same
community; optional branded registration requires verified domain control,
exact origins/scopes and revocation. Do not add wildcard registration.

The existing source-bound entry toolkit payloads are unchanged by this runtime
update; it is an entry package, not a complete backend or credential export.
Use [the website integration guide](HANGOUT_WEBSITE_INTEGRATION.md), preserve
each website's newer content and validate both actual staging links before
any separate public release decision. No public navigation was inserted here.

Before delivery or rollback, read actual deployed source/settings, preserve
namespace IDs, stable keys, explicit effective variables, approved browser
origins, admission versions, incident pauses, issuer and caps. `--keep-vars`
alone does not preserve all plain settings. Do not copy tracked empty defaults
over the effective configuration or reset a hold to recover from a failed test.
The previous C227 source `d8c08fb` has the measured expiry repair but lacks the
new heartbeat and browser cleanup. The older `33862058` version has the known
idle-expiry defect. Neither is a blind rollback recommendation. Resolve an
unknown delivery outcome by readback before considering another attempt.

Operator contact and initial reviewer remain Jeff. One inbox is not continuous
moderator coverage. Jeff and his bandmates operate personally in Texas; all-ages
participation, guardian/privacy paths, applicable reporting/takedown duties,
retention and qualified legal assessment remain public-launch blockers. Keep
the existing private admission/camera guards, AI off and no default recordings.
See [privacy and incidents](HANGOUT_PRIVACY_AND_INCIDENTS.md). No compliance
claim or new legal advice is established by this engineering evidence.
