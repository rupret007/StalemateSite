# Hang Out demo walkthrough and integration handoff

Recorded November 3, 2026. This note is for Jeff’s **private** WebJam/Hang Out demo.
It does not approve deployment, public site changes, provider activation or physical
music. It complements the [62-outcome audit](HANGOUT_ACCEPTANCE_AUDIT_20261031.md)
and [website integration guide](HANGOUT_WEBSITE_INTEGRATION.md).

## Qualified application baseline (revalidated)

| Deliverable | Head | Notes |
| --- | --- | --- |
| Website assembly (demo workstream) | `572cbd9197aac092c5dce2fe82308425b477bf36` | Merge of [PR190](https://github.com/rupret007/StalemateSite/pull/190) (`codex/application-proof-handoff-20261031`). Contains PR188 keyboard/reflow CI and pinned proof assets. **Not** on `origin/main` (`ebbcab4`); main consolidated via PR189/192 on a separate line. |
| `origin/main` (public site) | `ebbcab4fb…` | Browser CI pinning (PR192) and site-wide content outside this demo assembly. Do not treat main as the demo candidate without revalidation. |
| Native repository | `aed38d62299726f6f58747cc7e0dd672576fe7aa` | Merge of [PR415](https://github.com/rupret007/webjam/pull/415); equals `origin/master` and worktree `.local/join-before-audio-20261030`. Issuer TTL semantics only; frozen packages remain `bf24e7d`. |
| Last qualified **hosted** private beta | Source `4ed1525` / Worker `a9724702-3ce5-418a-bbd4-950f2e169c9e` | Dated October 31 evidence; newer merged website source is **not** implied deployed. |

Older handoff text still names **PR188/414**; current qualified merges are **PR190/415** with the heads above.

## One community, two band entrances

- **Canonical address (private beta):** `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/`
- **Product rule:** Stalemate and Rad Dad both open the **same** community—shared people,
  channels, rooms, identity and moderation—not separate backends per band.
- **Entry badges:** `?via=stalemate` → “via Stalemate”; `?via=rad-dad` → “via Rad Dad”.
  Badges are display context beside names/messages and in People; they can be hidden.
  Direct, unknown or repeated `via` values stay neutral.
- **Authority boundary:** A badge never grants verified identity, band membership, room
  powers or staff permission. Staff remains Cloudflare Access and explicit roles.
- **Future sites:** Use the [entry toolkit](HANGOUT_WEBSITE_INTEGRATION.md#export-a-self-contained-entry-toolkit)
  and `community-integration.example.json` pattern—verified domains, exact HTTPS origins,
  scoped permissions (`link`, `badge`, `return`) and revocation—without copying the repo
  or embedding invitation secrets in public pages.
- **Return navigation:** Trusted return links to `https://stalemate.band/` and
  `https://raddadband.com/`; preserve Rad Dad `/tap/` → `/qr/` and newer band page content
  when integrating.

## EFnet-shaped experience (what visitors should see)

- Guest **nicknames** without band accounts (subject to private invitation admission).
- **Anyone** may host permitted temporary rooms; registered “keep this room” flows stay
  email-verified and separate.
- **IRC-style** channels and commands (`/join`, `/msg`, host tools), presence, and a
  welcoming quiet lobby with starters and room discovery.
- **Chat at join** with **connected-session scrollback only**—reload, fresh profile, or
  new device should not replay earlier lobby/room transcript (hosted reload checks exist;
  retain that boundary in demo narration).

## Hosted demo script (human, with invitation)

Automated headless checks on November 3 reached the gate only (see status receipt).
Run these steps in a **normal browser** with Jeff’s current private invitation (fragment
or code)—never paste invitation material into band-site HTML or git.

**Setup:** Two independent profiles (or two people). Optional: one opens
`/beta/?via=stalemate`, the other `/beta/?via=rad-dad`.

1. **Gate:** Confirm invitation-only admission, participation notices, and guest path
   without staff sign-in.
2. **Lobby chat:** Exchange hello; confirm badges in chat and People; hide one badge and
   send another line; confirm direct entry stays neutral.
3. **Room:** Ordinary guest starts a drawing (or chat) room; second guest joins from
   directory; collaborate; leave and rejoin; host controls visible to host only.
4. **Fresh join:** Third profile (or cleared storage) joins after activity—no earlier
   chat backlog; only live room state where designed (e.g. canvas), not transcript.
5. **Mobile layout:** At 375/390px width, long lines and error toasts wrap; message
   input and Send stay visible; inputs at least 16px (see source `@media` rules in
   `r/…/lobby/lobby.css` and local CI captures under `pr-assets/beta-collaboration/`).
6. **Keyboard:** Tab through composer and Send; room tools dialogs return focus on Escape
   (local Chromium CI covers this at loopback; repeat on hosted if demonstrating a11y).
7. **Moderation (optional):** Synthetic report only; staff sign-in for disposition—report
   289035 remains Jeff’s separate review item.

**Out of scope for this walkthrough:** WebJam two-way music, provider/TURN activation,
third live test site, and public Stalemate/Rad Dad homepage navigation (still pending
observed journeys).

## Integration handoff for receiving owner

1. Select **one row** from the [delivery table](HANGOUT_WEBSITE_INTEGRATION.md#select-one-tested-candidate)—website source, native source, frozen packages, toolkit ZIP, and deployed Worker are different artifacts.
2. Export or reuse the verified eight-file toolkit; do not overwrite published asset dirs.
3. Wire band links to the **same** community URL; keep `join/PROVENANCE.json` aligned with
   qualified browser modules—do not swap in unqualified `94f3205` package bytes without
   a new package cohort.
4. Preserve `HANGOUT_BETA_*` bindings, session keys, namespaces, `providerQualified:false`,
   AI off, and Hang Out chat/media TURN off unless a separate qualified review says otherwise.
5. After any private deploy, re-run hosted layout and guest journeys before inviting external
   viewers.

## Local engineer check (no deploy)

From commit `572cbd9`:

```sh
npm ci   # if needed; skip full CI matrix under resource pressure
npx playwright test tests/e2e/lobby-accessibility.spec.js -g "phone375: long|phone390: long" --project=chromium --workers=1
```

November 3: both viewport tests **passed** on this machine after installing Playwright Chromium only.

## Related reading

- [Shared community contract](HANGOUT_SHARED_COMMUNITY.md)
- [Demo guide (five-minute journey)](HANGOUT_DEMO_GUIDE.md)
- [Private music activation review](HANGOUT_PRIVATE_MUSIC_ACTIVATION_REVIEW.md) — authorized bounded trials only; prerequisites still open
- [Music demo acceptance](HANGOUT_MUSIC_DEMO_ACCEPTANCE.md) — physical matrix **PENDING-Jeff**
