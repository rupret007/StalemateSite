# Selected people and deliberate nickname commands

This application contract separates choosing a particular connected visitor from
typing an IRC nickname. Nicknames can change and can be reused by someone else.
A People menu or an old message must never silently move its action to the new
holder of that name. A connection ID identifies an endpoint; it does not verify
a person, create contact consent or grant a role.

## Selection contract

The server advertises numeric `hello.features.personTargets: 1`. Selected-person
commands carry `personContext: 1`, the original `personPeer` connection ID,
the original channel and its `roomInstance` nonce. The client captures these
when it opens the menu. Changing the active channel, renaming a visitor or
recreating a room must not change that selection. A live original endpoint can
be followed through a rename; an unconfirmed endpoint or room is refused.

Public lines may carry `personPeer`, recipient-relative `personSelf` and the
original `roomInstance`. These are wire metadata added after the existing
message receipt is constructed. They do not change receipt identity or disclose
device, account or session identifiers. If a restored or held message cannot
prove its original endpoint, it must omit that correlation. The exact-message
Report flag remains the reporting path.

Legacy restored held messages do not prove an original live endpoint or room
incarnation. They must not acquire that proof through a current nickname/device
lookup. For a recipient using peer ignores, an unprovable held author is handled
conservatively: withhold that queued message and show bounded feedback rather
than risk displaying an ignored endpoint's text. This can also withhold an
unrelated legacy held message; it is an explicit limitation, not exact-person
filtering or a claim that historical correlations have been solved.

Normal composer nickname commands such as `/block`, `/ignore` and `/query`
retain named intent: they resolve the current holder when processed. A raw
frame explicitly carrying private-peer context retains that separate binding;
typing text into such a custom frame does not remove it. An explicit named prompt can use the narrow
`personNamed: true` command contract. Generic internal command helpers must not
mark every request as named intent. Missing, partial, mixed or malformed selected
context is refused rather than retried by nickname. Missing capability support
disables the selected action with a useful explanation.

The existing private-message `pmPeer`/`pmRef` contract remains separate. Public
selection does not create a PM pair or bypass request/accept rules. Historical
person menus report an exact delivered message, rather than finding the newest
message from whoever currently owns a nickname.

Removing a verified co-host is an exact account operation, not a live visitor
selection. Its explicit `cohostAccount: true` path carries the original room
nonce and checks current ownership and the stored co-host membership. A missing
account must not fall back to a nickname lookup. Neither the marker nor the
account reference grants authority to the caller.

## Effects and confirmation

Selected Block applies to the selected device without also creating a nickname
ignore. Selected Ban applies to the selected device/account without banning an
unrelated nickname successor or everyone sharing the same network. Existing
staff protections, room authority and limits still apply. Deliberate named
commands retain their separately documented literal behavior.

Selected Ignore stores a live peer reference, distinct from a deliberate named
ignore rule. Legacy names and peer references share the existing total of 50
ignore entries. Peer references survive only the exact resumed connection and
are removed when that endpoint departs; they are not a durable person identity.
Block retains its existing separate limit.

Only the caller receives `{t: 'person-preferences', names, peers}` after a
successful commit. The client updates preferences from that snapshot and
confirms an action only when the snapshot demonstrates the intended change.
Sending a WebSocket frame alone is not confirmation. Removing a literal named
ignore is a separate explicit choice; Unignore for one peer must not silently
remove a nickname rule.

The moderation panel retains exact stored ban rules. A historical nickname is
an informational label. New selected device/account rules persist that label
as optional `displayNick`; it never participates in person lookup, ban matching
or named Unban grouping. Legacy `nick` rules retain their existing separate
semantics. Strict readers validate a present label, so this field requires the
same matched reader/writer rollout and compatible-state rollback described
below. Removing a rule uses its exact stored mask, never a
lookup of that nickname's current owner. Public confirmation must not expose a
private device/account mask. Removing one rule does not imply that every other
restriction for that visitor has been removed.

## Transaction boundaries

The engine supplies private selected-peer dependencies from its trusted prepared
connection roster. The durable authority rechecks actor and selected bindings
before and after writes in the same transaction. Room dependencies bind the
original room nonce and relevant before/after permission state, including
publication modes and voice where applicable. A legitimate Kick can change
membership; a blanket requirement that membership remain unchanged would reject
the intended action.

An ordinary stale selection rolls back its effects and gives a specific refusal.
Malformed durable state retains the existing unavailable/recovery behavior.
Safety actions must remain usable without granting new contact permission.
These fences do not replace the participation authority, session revocation,
room permissions, PM consent or exact-message evidence checks.

## Compatibility and qualification

The connection preference codec adds optional `ignoredPeerIds`: absence means
an empty peer list, while malformed, duplicate or over-limit data is rejected.
This does not relax the private-message pair reader. Older strict readers can
reject a newly written preference row. Deploy the matched client, core,
authority and codec through the existing release owner, drain old writers and
sockets, and qualify rollback against compatible state. A code-only downgrade
is not a rollback plan. Do not reset durable state or widen caps to make a
reader accept incompatible data.

The session snapshot also stores the permanent lobby's `lobbyInstance`. New
snapshots preserve that room reference through a same-WebSocket wake, so an
otherwise valid selected action is not rejected because the process restarted.
The nonce is trusted namespace state, not a client-supplied identity or grant.
A malformed present value is rejected before restoration changes live state.
It remains inside the existing session byte limit and requires the same matched
reader/writer rollout and compatible-state rollback discipline.

For a legacy snapshot without this field, ordinary mode can send current lobby
metadata only to successfully resumed lobby members after roster restoration.
It replays no chat and does not rewrite a held selection's old reference. With
participation authority enabled, eager legacy roster metadata is withheld;
selected controls remain subject to the existing checks until normal authorized
channel state or a new session supplies their context. No transparent legacy C3
upgrade is claimed. Required writer/socket drain remains the release path;
reporting, Quit and existing private-peer safety do not gain a contact-consent
requirement.

Source tests must separately exercise held menus and historical authors across
rename/reuse, departed peers, recreated rooms, malformed contexts, identity-only
Block/Ban, confirmed preferences, intentional named commands and selected-target
revocation before/after durable writes. A browser WebSocket fixture proves its
controlled application path; it does not prove hosted authentication, native
audio, physical-device accessibility or deployment. Current CI and normal
review remain tied to each exact published head. This application document does
not authorize deployment or public launch; StoryPool 10-21-26 retains that work.
