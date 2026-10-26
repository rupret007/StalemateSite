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
connection/session binding determines its principal: a verified account when
present, otherwise `s_` plus that issued beta SID. This is an internal identity,
not proof of consent or guardianship. A different SID, account transition,
nickname, device token or website badge cannot carry a previous grant forward.
The current session, binding, expiry and staff role are validated again inside
the same native transaction as the current partitioned C2 records and existing
lobby effect writes. No nested transaction substitutes for that final check.

Missing, corrupt, expired, unqualified or withdrawn policy/grant records deny
new gated publication. The ledger is read, not provisioned. Restart resolves
current identity and permissions rather than trusting cached browser or saved
purpose claims; active media/PM permission refresh runs during restoration.
The existing composed authority alarm refreshes participation before its tick,
without changing the existing sixty-second schedule. Fresh writes always
recheck current rows; passive media cleanup waits for that successful refresh.
Refresh failure remains unconfirmed and uses existing bounded retry behavior.
There is no real guardian withdrawal endpoint or instant notification claim.
Reporting, blocking, leaving and authenticated revocation cleanup retain their
separate safety/lifecycle authority.

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
