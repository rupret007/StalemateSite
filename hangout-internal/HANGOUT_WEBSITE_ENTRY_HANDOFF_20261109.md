# Website entry package — private handoff

Stalemate and Rad Dad are two entrances to one community. This package prepares
the website integration; it does not authorize publishing either entrance.
The complete band rehearsal and public readiness requirements remain open in
the [current readiness handoff](HANGOUT_CURRENT_PRIVATE_READINESS_20261108.md).

## Files for the receiving website session

Download the [verified entry toolkit](../pr-assets/community-entry/20261109/community-entry-toolkit.zip)
and its [verification receipt](../pr-assets/community-entry/20261109/verification-receipt.json).
The ZIP is 8,620 bytes, with SHA256:

```text
aa9ab817da737474a025a8f8fcb2997197fdc1be1b84f27a899a44f00557d162
```

It is the actual `community-entry-toolkit-42574199274-1` artifact from the
successful website PR CI, not a fresh untested export. Its manifest records the
tested checkout `40f88d8ad02c4bc9d999c809546c365654e2bbf9`; the source inputs and
exporter also match merged revision `1045f440937234ccd4679d95bcaa78785a59a274`.
The tested and merged tree is `f91aca63cf79264b27e7e497d8fe8c27fd225b1b`.
All seven payload hashes and the exact eight-file archive allowlist were checked
after download. No application checkout, secret configuration or invitation is
included. Preserve `SOURCE-MANIFEST.json` and `LICENSE-NOTICE.txt`.

## Intended visitor experience

1. A visitor selects Hang Out on either website and opens the shared community.
2. During this private phase, normal invitation admission is still required.
   A site link or badge does not grant access. Do not embed the private
   invitation in this package, repository, site navigation or screenshots.
3. The visitor chooses a nickname and whether to show the source-site badge.
   Both entrances lead to the same people, channels, rooms and moderation.
4. The shared application offers the appropriate return link. The visitor can
   hide the badge; source context is never verified identity or staff authority.

The existing registered private source links are:

- Stalemate: `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/?via=stalemate`
- Rad Dad: `https://stalemate-hangout-beta.jeffstory007.workers.dev/beta/?via=rad-dad`

Actual deployed prejoin checks cover both source choices and return links.
Joined cross-entry chat on this candidate remains unverified; do not present
these links as completion evidence for that journey.

## Integration and release boundary

For an ordinary neutral entry, the toolkit's `neutral-link.html` needs no site
credential, account sharing or domain registration. For a future registered
site, follow the included README and disabled example configuration. Its
Node.js 22+ builder writes a new output directory; it does not register a domain,
change the community server or publish a site. Operator review and real domain
verification remain separate. Do not enable examples or expand origins simply
to make a demonstration pass.

Public code redistribution permissions have not been qualified: the package
adds no license grant, and its notice records that no recognized repository-root
license file was present. Keep that limitation explicit before distributing
the implementation publicly. This does not add a credential requirement to
ordinary links.

Leave the public websites and navigation unchanged until the receiving owner
has the completed private acceptance evidence and existing release approval.
No recording, AI, TURN setting, namespace, admission control or release hold is
changed by this package.
