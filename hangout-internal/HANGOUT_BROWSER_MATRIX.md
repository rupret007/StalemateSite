# Shared-community browser coverage

The existing phone projects select `phones`, `listen` and `play` filenames.
Their green checks did not establish that shared-site entry or music invitation
journeys ran in WebKit. The inspected PR162 report had 411 successful cases,
but `community-entry.spec.js` ran only in Chromium.

The `webkit-community` project selects these existing cases without changing
their assertions or removing any previous project:

| File | Cases | Behavior |
| --- | --- | --- |
| `community-entry.spec.js` | 2 | Separate website entrances, shared chat/drawing, badge privacy and 375/390px screenshots |
| `lobby-webjam.spec.js` | 5 | Desktop/browser invitation handoff, host-only edits, rejected origins and local Stop after an unconfirmed withdrawal |
| `lobby-invitation-lifecycle.spec.js` | 5 | Leave, room switch, host-power loss, reconnect and delayed clipboard cleanup |

Entry and handoff cases use real loopback sockets. The lifecycle file uses
the real engine through intercepted browser WebSockets. Web Join destination
opening, clipboard failure and own-sharing HTTP are explicit fixtures; these
are not real audio/enrollment, native consent transactions or hosted sign-in.
Only Chromium receives its loopback local-network permission fixture. No
camera/microphone grant is added for this project.

After resource admission, select this group with:

```sh
npx playwright test --project=webkit-community
```

The existing CI workflow already installs WebKit and runs all projects. This
change adds no workflow, browser download, timeout increase or production
configuration. Twelve newly selected cases are expected, not observed passes;
inspect actual CI outcomes, attempts and screenshots before qualifying them.

[Playwright's browser guidance](https://playwright.dev/docs/browsers#webkit)
distinguishes its WebKit build from branded Safari and notes platform-specific
media differences. Linux WebKit checks do not establish physical Mac Safari,
iPhone or Windows behavior. Keep the actual Intel Chrome evidence separate,
and retain the required ARM Mac/Intel Mac/Windows/Linux live-music matrix and
all 62 original outcomes.
