# Docker demo

This demo builds the current Ledger9 resolver and manager source locally with
node 2.1.101, indexer 4.4.101 and proof-server 9.0.1. It is intended for evaluation
and API/UI exploration, not production deployment. Midnight DID Manager is a
browser-only demo application; its DID CRUD flows are illustrative and should
be implemented as issuer/verifier bootstrap or business logic in a real
application.

The demo binds both application ports to `127.0.0.1` by default. Do not change
these mappings to `0.0.0.0` or expose the manager port on a shared network.
Manager recovery is not implemented in this release, and the secret-store
passphrase must be entered again after a manager restart.

## Prerequisites

- Docker Engine with the Docker Compose v2 plugin
- `curl` for the health command
- Network access to pull Node/Midnight base images and public npm dependencies

No new service image is published by this upgrade. Older published service RCs
use Ledger8 and must not be mixed with the new topology. Compose waits for the
proof-server HTTP healthcheck; its first launch can download proving parameters.
See [the migration profile](../docs/ledger9-migration.md): old contracts require
replacement deployment, a new DID/address, and explicit cache invalidation.

## Start

From the repository root, run the complete demo with one command:

```bash
just demo
```

The equivalent explicit commands are:

```bash
./demo/run.sh up
./demo/run.sh health
```

Open:

- Resolver API and Swagger UI: <http://127.0.0.1:3001>
- Manager wallet UI: <http://127.0.0.1:3010/wallet>

Stop and remove the demo containers and network:

```bash
./demo/run.sh down
```

Manager state is persisted in `~/.midnight-did/manager` on the host by default,
so wallet/session data survives demo restarts. Override `MANAGER_DATA_DIR` in
`demo/.env` to use another directory. The container runs with the invoking
user's UID/GID so the bind-mounted state remains writable.

Remove the demo containers, network, and any demo volumes:

```bash
just demo-clean
```

Follow logs or inspect the resolved configuration:

```bash
just demo-logs
just demo-config
```

## Configuration

Copy the example overrides before starting:

```bash
cp demo/.env.example demo/.env
```

The file controls the application image references and host ports. Set
`RESOLVER_IMAGE` or `MANAGER_IMAGE` to a locally built image to test changes
without publishing them. The internal application endpoints use Compose service
names and should not be changed to `127.0.0.1`.

## Local application images

The defaults are `midnight-did-resolver:ledger9-local` and
`midnight-did-manager:ledger9-local`. Run `./demo/run.sh up --build` to rebuild
changed source. Supply explicit local tags for isolated validation. A future
service release/publication needs separate authorization; this migration neither
publishes images nor advances `latest`.
