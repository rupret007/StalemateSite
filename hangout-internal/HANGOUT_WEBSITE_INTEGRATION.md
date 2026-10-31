# Website integration: one shared Hang Out

Use this short guide to prepare the receiving owner's release. This application
session supplies source, tests and integration assets. Following Jeff's October30
clarification, application code, project CI and application PRs proceed here
independently of StoryPool/Karen. Shared StoryPool core, installed services and
operational files remain outside this task. Existing GitHub protections and
security/provider/release holds still apply. This document is not release
approval or evidence that a live website contains the candidate.

## Select one tested candidate

The current protected private website uses application source
`96f356a6f2a9af4bbd2834bb94f1e5df81d200dd`, tree
`7ffc5b662744609f92ba490c70d146cfea40676e`, matched to Worker version
`6293386f-31b8-4415-bf0b-f81296190a4d`. Its actual site/native CI and deployed
visitor journeys are in the [private release receipt](HANGOUT_PRIVATE_DEMO_20261030.md).
The explicit eighth provider-start CI mode ran with inert callbacks; it does not
prove music or activate providers. Preserve this source/assets/configuration/key
set until the existing eight-hour observer is terminal and ending deployment
identity is checked. Documentation-only merges do not change that runtime.

Current native source is `bb40fac7fcaa032c2f19cf9af8c49ac4276d3cf1`; its
[package/actual ARM GUI receipt](HANGOUT_NATIVE_PACKAGE_BB40_20261031.md) keeps
source, CI, package and physical-device proof distinct. Actual two-way music
remains required. Use these exact identities and receipts before historical
branch descriptions below.

The preceding `codex/webjam-native-ci-20261030`, based on PR169 head
`43457849374bfa00e68fcf3f224954e3f3832026`, added the separate eighth provider-start
mode to application CI.
The preceding `codex/jam-share-order-20261030` is based on
PR168 head `2c4a191915e02c73f95b1c0d2aca1082f6974649`. Its parent
`codex/jam-mobile-setup-20261030` contains the compact setup help and is based on
PR167 head `143b3905af12e029a645e96769cc1d04cec018a5`. The preceding
`codex/jam-confirmation-races-20261030` contains PR166 head
`1504f94837a68ce35844e0590cde469135c287b4`. The earlier parent
`codex/irc-webjam-polish-20261029` is based on the merged
`codex/che-demo-candidate` at `ec1eb14cfb2f7d068e5a01467193b70e21495dbc`; see the
[checkpoint](HANGOUT_DEMO_CHECKPOINT.md#previous-work-independent-application-ci)
for its exact inputs and unresolved gates. Obtain the actual reviewed current
commit, not just an input PR or branch name. This assembly includes both the
music-invitation fixes and the reconnect probe; older input results do not
qualify the merged tree.

Use the delivered source commit and its matching CI/review receipts. The entry
toolkit's `SOURCE-MANIFEST.json` names the commit used to build that archive; it
contains link tooling and documentation, not the whole application. Obtain the
application from the corresponding source branch or verified source patch.
Revalidate the exact current commit's application CI and review. Historical
dependency tables are an audit trail, not a list to cherry-pick blindly.

Retain newer Stalemate and Rad Dad pages, navigation, media consent and the
permanent Rad Dad `/tap/` to `/qr/` path. Do not replace either site with a stale
application checkout.

## Prepare entrance links

The release owner selects one approved canonical community address and one
authoritative backend/namespace. Both band sites and future links reach that
same service. Two independent Worker namespaces create two communities.

### A. Simple neutral Join link

Any website can add an ordinary link to that approved address without registering
its site, obtaining site credentials or running the package builder. Use top-level
navigation with no `via` value. For example, **replace this example.test address**
with the receiving owner's approved community entry URL:

```html
<a href="https://community.example.test/beta/" referrerpolicy="no-referrer">Hang Out</a>
```

This entrance is neutral: it attaches no site badge or registered return contract.
The community's existing invitation, sign-in and admission rules still apply;
linking grants no access or staff permissions. No band-site account, shared cookie
or cross-site SSO setup is required for the link itself. Adding a future basic
link does not create another community or require enabling a new integration.

### B. Optional reviewed badge and return navigation

Use the versioned integration contract when an entrance should offer a recognized
site badge and approved return link. This registration is optional for ordinary
linking. Badges remain visitor-controlled display context, never authentication.

1. Prepare a nonsecret registry using
   [`community-integration.example.json`](community-integration.example.json).
   Approve each registered site's domain control, exact origins, permitted return
   URL, display label and `link`, `badge`, `return` scopes. Domain verification is
   the operator's recorded assertion; the builder does not perform it. Example
   fixtures do not prove real domain control. Keep unapproved entries disabled;
   an integration receives no staff powers.
2. From the application repository root or extracted toolkit root, generate the
   snippets with an installed Node runtime. Choose a new output directory whose
   parent already exists; the builder refuses to replace an existing directory.

   ```sh
   node scripts/package-community-entry.mjs --config /path/to/approved-sites.json --out /path/to/generated-links
   ```

3. For additional badge sites, the release owner also sets the canonical
   Worker's public `HANGOUT_ENTRY_SITES` JSON array to the reviewed generated
   `manifest.json` → `entrySites` value. The built-in band entries stay built in.
   The Worker supplies the sanitized registry to both client and engine. A
   custom link without this matching configuration joins with a neutral badge;
   the link builder itself does not configure the Worker or verify domains.
4. Add each generated Hang Out link to the relevant site's existing navigation.
   Use the same community address with its registered entry identifier. Never
   put a private invitation, email code, cookie or credential in the link.

Disabling a registered site prevents new approved-link generation. A custom
source is neutral when it is absent from the runtime registry in use; existing
delivered labels stay with their messages. This does not invalidate copied
ordinary links, ban visitors or remove their accounts/rooms.

Both options share channels, room IDs, moderation and first-party community
sessions. The optional “via Stalemate” or “via Rad Dad” badge describes this
entrance only. Visitors can hide it. It grants no identity or permissions; direct
entry stays neutral. Do not copy cookies across band domains or assume an existing
site-account SSO service.

## Release the matching application and state

The release owner follows [session-authority migration and recovery](HANGOUT_SESSION_AUTHORITY.md)
and the [full handoff](HANGOUT_SHARED_COMMUNITY_HANDOFF.md). Preserve bindings,
IDs, account-key continuity, room ownership, bans and selected evidence.
Independently establish old-writer, socket and in-flight drain; a mode flag or
export is not drain proof. The opt-in Lobby authority mode is not activated by
the entry archive. A flag reversal is not sufficient rollback between different
authorities. Qualify recoverable state and matched assets/backend before use.

Before activation or rollback, check the actual saved fields and connected-client
versions against these compatibility contracts. Preserve compatible readers and
matched clients/backend; reversing a source patch or mode flag does not migrate
stored state or establish a verified drain.

| State or protocol | Contract | Receiving-owner compatibility condition |
| --- | --- | --- |
| `jamShareResults:1` / `jam-share-result` | [One pending Share](HANGOUT_JAM_SHARE_FEEDBACK.md#compatibility-and-qualification) | Deliver matching HTML/CSS/JS and engine. Older clients keep state-based behavior; a new client with an older engine does not establish the correlated rejection/single-pending guarantee. No stored schema is added, but existing drain and recovery contracts still apply. |
| Room `keepRef` | [Keep-room state and rollback](HANGOUT_KEEP_ROOM_SIGNIN.md#compatibility-and-rollback-boundary) | Preserve a reader that accepts the room-instance reference and preflight snapshot/indexed-record sizes within unchanged caps. Older indexed readers can refuse the field; qualify a compatible reader or the documented drained rollback conditions before use. |
| Restricted `safetyOnly` sessions and `sharing-stopped` | [Own-sharing integration](HANGOUT_OWN_SHARING_CONTROLS.md#integration-and-rollback-boundary) | Keep compatible stored-session readers and current clients. An older client can ignore media teardown; qualify current assets/cache delivery and drain older sockets. Do not remove the restriction to resume sharing. |
| Required C3 `participationMode` marker | [Required-mode and rollback rules](HANGOUT_OWN_SHARING_CONTROLS.md#integration-and-rollback-boundary) | Preserve the latch and matching reviewed configuration. Old unlatched domains need separately qualified drained mode admission; deleting policy/latch state or removing flags is not recovery. |
| `publicOrigin` receipts/reports and incident-source index | [Incident-source activation boundary](HANGOUT_INCIDENT_SOURCES.md#configuration-and-activation-boundary) | Preserve compatible stamp/index readers and generation under the required mode. An initialized source namespace has no supplied downgrade path; do not erase stamps/index or flip the flag to make an older reader load. |

These contracts supply no new migration API or live state-repair procedure.
Actual writer/socket drain, recoverable backup and matched rollback qualification
remain with the receiving deployment owner.

Publish only intended site/application assets. Local role selectors, incident
fixtures, synthetic bootstrap Workers, raw evidence and operational files are
not authentication services or website content. Keep existing holds and trust
checks. Configuration names are documented without supplying secret values.

## Verify the staged visitor journey

Use two separate browser contexts entering through the actual two site links:

1. Join as guests, exchange text in the same lobby and inspect both entry badges
   in messages and People. Hide one badge; try neutral direct entry separately.
2. Create and join a permitted room, draw together and exercise watch controls.
   Invite a guest to a Jam room and verify the full WebJam invitation handoff.
3. Confirm a fresh visitor receives no earlier chat. Test long text and controls
   at 375/390px, keyboard navigation, reconnect and expired-session recovery.
4. Report only a benign synthetic message. An authorized moderator reviews it;
   an ordinary visitor cannot access staff actions. Preserve unrelated reports.
   Check block/mute behavior and changed roles on existing connections.
5. Verify logout/revocation and private-room denial. If testing camera blocking,
   use updated clients and server: signaling denial alone cannot terminate an
   already established P2P connection between two outdated clients. Check that
   an unrelated participant continues and no new camera prompt is triggered.
6. Verify a separately registered third test-site entrance reaches the same
   service without gaining moderator or owner permissions.

Record the actual deployed revision, environment, observed results and failures.
Local fixtures do not establish real Access sign-in, public all-ages readiness,
physical-device accessibility, hosted capacity or native audio. Keep current
safeguards until qualified guardian/legal/staffing paths are ready. AI and TURN
activation remain separate owner-qualified work; Windows remains unsigned.

Use [the Che demo guide](HANGOUT_DEMO_GUIDE.md) for the short walkthrough. A
cross-house native session additionally needs actual installation, trust,
join/leave and bidirectional audio evidence on the advertised platforms.
