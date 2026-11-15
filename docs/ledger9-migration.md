# Ledger9 migration (DID 1.0.0-rc1)

This coordinated resolver/manager/secret-storage upgrade consumes the five public
`@midnight-ntwrk/midnight-did{,-api,-contract,-domain,-jubjub-schnorr}` packages at
**1.0.0-rc1**, including the contract alias. Do not use npm `latest` (0.7.0).
Owning source: `midnightntwrk/midnight-did` commit
`750268664278c162e9171406983dc45f24bb5be7`, release `v1.0.0-rc1`.

## Exact runtime profile

| Component | Selected identity |
| --- | --- |
| DID packages/artifacts | 1.0.0-rc1, public npm/GitHub release |
| Compact generated compiler | 0.36.0, compiler commit b5d9e4dfc532fe47011c4f6296e254f4853eb469 |
| Compact language / runtime | 0.28.0 / @midnight-ntwrk/compact-runtime 0.21.0 |
| Runtime state backend | @midnightntwrk/onchain-runtime-v4 4.0.0 (lockfile); distinct from compiler identity |
| Compact JS / Midnight JS | 3.0.0 / 5.0.0 |
| Ledger | @midnightntwrk/ledger-v9 1.0.0 |
| Wallet facade / DUST | 5.0.0 / 5.0.0 |
| Wallet HD / shielded / unshielded / address-format | 4.0.0 / 4.0.0 / 4.0.0 / 4.0.0 |
| Wallet abstractions / capabilities | 3.0.0 / 4.0.0 |
| Local Node / npm tested during upgrade | 24.22.1 / 11.19.1 |
| Standalone node / indexer / proof | 2.1.101 / 4.4.101 / 9.0.1 (local undeployed live flows validated) |
| Disposable topology tooling | testcontainers 11.14.0 (SDK5 node-client optional peer requires ^11.12.0) |
| Published ZKIR | 3.1; generated artifacts consumed, no local compiler invocation |

The SDK/Compact JS graph intentionally retains internal Ledger8/onchain-runtime-v3
packages. They do **not** establish public Ledger8 operating support. Decode SDK5
`read.contractState` with the **owning Compact runtime's** Ledger9 decoder, not a
Ledger/WASM instance from a different package. The SDK5 network-id singleton is
removed; use captured wallet/provider network identity.

Public ZK archive SHA-256:
`cc997da6cc56bef638e57d27eb08b9923990c64f81330e25236d85c8ad942f9f`.
`npm run smoke:did-zk-release-artifacts` independently validates package and archive
payloads through SDK5 Node and Fetch providers with compiler integrity manifests;
it does not mutate installed contract artifacts or compile a contract.

## Ledger9-only replacement deployment

Old Ledger8 contracts are unsupported. Deploy a **replacement** with this cohort;
the new contract address is a **new DID**. On-chain history is not automatically
preserved. No dual-era service support, transparent old-DID continuity, CMA or
verifier-key migration is provided. Do not relabel old serialized state or snapshots.

The resolver remains read-only and indexer-backed. A public resolution request
requires neither a wallet/funding, node/proof service nor a local Compact compiler.
Indexer endpoints remain startup configuration, never caller-selected routing.
Wallet/node/proof infrastructure belongs to manager mutations and live test fixtures.

## Local state and custody

Wallet snapshots are version 3 / `ledger9-sdk5`, and include the opaque SDK
transaction lifecycle bytes as well as shielded/unshielded/DUST/history state.
A missing lifecycle or incompatible snapshot is moved intact to
`backup/wallet-state/<network>/<profile>/<seedHash>-incompatible-<unique id>` before
fresh sync can overwrite its location. Backup failure must stop restoration.
Seed/session/key-store files are not erased or rewritten by cache invalidation.
The seed remains in-memory only: process restart requires explicitly re-supplying
it. Standalone preserves its existing fresh-resync policy (no persisted wallet
cache), avoiding stale state after a disposable chain reset; public-network
profiles use the guarded snapshot restore/quarantine policy.
Backups contain sensitive wallet data and must retain the same local custody controls.

Private state uses a new `midnight-level-db-ledger9/<seedHash>` namespace. Existing
`midnight-level-db` is left untouched for operator backup; it is not reused for a
replacement contract. Existing secret-store deterministic derivation and canonical
fixed-width big-endian Jubjub encodings/signatures remain unchanged. HD4 renamed
its Metadata enum; secret storage explicitly freezes its pre-upgrade numeric
metadata path `m/44'/2400'/account'/4/index`. Nine independently compared baseline
HD3/DID0.7-to-HD4/rc1 vectors and fixed native point/signature bytes protect it. The earlier
0.7.0 JWK-cache invalidation requirement still applies when upgrading from <=0.6.0.

Manager DUST bootstrap uses the API's explicit indexed-block-time readiness
adapter with a bounded deadline, not wall-clock balance. Positive DUST readiness
is not a promise that an arbitrary transaction is affordable.

## Validation status

Local validation includes clean install/full installed graph, typecheck, strict
light/service pipelines, unit/coverage/docs and actual public release-artifact
smoke. The disposable Ledger9 resolver flow tests real wallet lifecycle snapshot
restoration and DID deploy/update/resolve/deactivate through REST. Manager
Chromium E2E covers all three signing curves, indexer-only verification, restart
with explicit seed entry, fresh resync/explicit join/post-restart mutation and
deactivation. Both locally built service images pass the CI-style demo runtime
health/readiness smoke. Exact-head results and any later CI gaps are recorded on
the draft PR; none of these claims are inferred from upstream DID tests.
Public preprod/mainnet combinations remain unverified. See the upgrade draft PR
for exact-head commands, evidence and final limitations. No production deployment,
release or package publication is performed by this migration.

`npm audit` also reports inherited high/critical issues in baseline test/docs
packages; the migration does not disable audit checks or claim those advisories
are resolved. The unchanged production high-severity gate passes. A narrowly
scoped `dockerode@4.0.12` child override pins `uuid@11.1.1`: SDK5's optional
Testcontainers11 peer otherwise introduces vulnerable UUID10. Dockerode uses
only zero-argument CJS `v4`; that actual call site and real topology are tested.
This is an explicit compatibility exception, not an advisory waiver. Baseline-to-
final audit root comparison finds no new root advisories. Full audit debt remains
tracked separately; do not interpret a passing threshold as an entirely clean audit.
