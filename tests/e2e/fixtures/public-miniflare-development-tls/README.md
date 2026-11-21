# Public development TLS fixture

This is the unchanged development key/certificate pair distributed in the existing locked `miniflare@5.20261019.2-beta` package. It is already public test material, never a live/provider/user credential. Its only consumer binds to loopback for disposable protected-newcomer browser tests. Never use it for a deployed service. Never install it into a system/browser trust store. Keep its material out of logs and test reports.

The package declares MIT; the upstream copyright and full permission notice are preserved in LICENSE-MIT. PROVENANCE.json records both the installed upstream module and fixture hashes. No dependency was added and no new key or certificate was minted. The app packager excludes the entire tests directory.
