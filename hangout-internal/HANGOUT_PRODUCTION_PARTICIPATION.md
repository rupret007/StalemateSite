# Production participation composition

This application slice adds an initially inactive bridge from the real beta
session authority to C1/C2/C3. It does not approve an all-ages launch, enroll a
person, verify a guardian, install policy or call a provider. Existing 13+ chat
and 18+ camera checks remain. No deployment configuration enables this mode.

`HANGOUT_PARTICIPATION_AUTHORITY` must be absent for the existing beta behavior.
The only supported opt-in value is `c3-v1`, requiring protected beta mode and
`HANGOUT_SESSION_AUTHORITY=lobby-v1`. Empty, unknown or incompatible settings
refuse configuration. A selected mode never falls back to ordinary persistence
or creates missing participation records.

`HangoutLobby.start` constructs the production C3 adapter. The actual saved
connection/session binding and current registry profile determine its consent
principal. A current verified registry profile supplies the account even on an
ordinary `/lobby` fan socket; its room/staff role remains unchanged. An expired
profile denies without falling back to a SID grant. Without a profile the
principal is `s_` plus only that issued beta SID. This is an internal identity,
not proof of consent or guardianship. A new guest SID, nickname, device token
or website badge cannot inherit a previous guest grant. Verifying an account
does not inherit that guest-SID grant; only a separately qualified record for
the verified account can apply.
Two current SIDs with the same verified account use the same account permission
record; neither inherits a separate guest-SID grant. The current session,
binding, profile, expiry and staff role are validated again inside
the same native transaction as the current partitioned C2 records and existing
lobby effect writes. No nested transaction substitutes for that final check.

Missing, corrupt, expired, unqualified or withdrawn policy/grant records deny
new gated publication. The ledger is read, not provisioned. Restart resolves
current identity and permissions rather than trusting cached browser or saved
purpose claims; active media/PM permission refresh runs during restoration.
The existing composed authority alarm performs bounded C2 retention before
refreshing participation and running its tick, without changing the existing
sixty-second schedule. Fresh writes always
recheck current rows; passive media cleanup waits for that successful refresh.
Refresh failure remains unconfirmed and uses existing bounded retry behavior.
There is no real guardian withdrawal endpoint or external instant-notification
claim. The [own sharing controls](HANGOUT_OWN_SHARING_CONTROLS.md) add a
participant-only reduction and immediate local refresh after its commit. A
fully withdrawn live socket loses public presence and media while retaining
only bounded same-connection reporting/blocking/leaving; it cannot perform
staff actions or receive the staff queue. Authenticated revocation cleanup
retains its separate lifecycle authority.

The internal retention method is called only by the actual C3 alarm, under its
existing event gate. It performs at most four sequential native transaction
steps. Each step processes at most one partition and commits its reference/index
changes with the cursor; a failed step cannot advance that cursor. Earlier steps
may already have committed. An empty end-of-cycle step consumes one of the four
steps, wraps to the beginning and stops, so later insertions are revisited. After
a cold restart, the next alarm resumes from the stored position.

The single `authority-participation-maintenance:v1` record has exactly
`{version: 1, communityRef, after}`. It records advisory scan progress, not chat,
an identity proof or permission. A missing cursor permits an initial rescan only
after the actual C3 authority marker/configuration and existing valid policy
community are checked. Present malformed, wrong-community or unsupported-version
metadata fails without reset. Missing or corrupt authority, policy or partition
routes fail closed. No public maintenance endpoint or policy initializer is added.

Cleanup reuses the existing expiry, policy-alignment and reference-ownership
rules. It can run with a structurally valid expired, unqualified or withdrawn
policy, because removing expired records grants no new participation. Stored
absolute `deleteAt` values determine eligibility; four bounded steps per alarm
do not promise an exact physical deletion deadline or backlog SLO. Reused global
references belonging to another partition are not deleted. I1 evidence and holds
retain their separate authority and retention paths. No production allocator is
configured here, and row cleanup does not claim quota release.

Cloudflare documents [alarm delivery and retry behavior](https://developers.cloudflare.com/durable-objects/api/alarms/)
and [native SQLite storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
This application uses its existing alarm failure/rescheduling path and native
transaction boundary; it changes no deployment or StoryPool infrastructure.
Runtime qualification of the retention addition is pending. Source behavior
does not qualify guardian verification, parental rights, legal or provider
retention, backup deletion, real enrollment or public activation. The existing
13+ chat and 18+ camera checks remain.

Private `/room` signaling is not purpose-fenced. This mode therefore refuses
its gateway, direct Worker and Durable Object admission and retires restored
private-room sockets. Authenticated disconnect cleanup still acknowledges
closure. The unfenced `/join` browser-audio entry is also unavailable before its
assets load. TURN remains unavailable; no dispatch-start/provider qualification is
supplied. These refusals do not terminate independent native/P2P sessions that
were already established outside the service.

Actual guardian verification/enrollment, authenticated parental rights and
deletion, qualified policy/purposes/deadlines, pre-consent infrastructure,
backup/recovery and any public rollout remain separate work. Jeff and his
bandmates are the planned operators in Texas; that fact does not select a legal
entity, appoint staff or resolve applicable duties. No raw ID, biometric,
guardian contact or new credential is collected by this bridge.
