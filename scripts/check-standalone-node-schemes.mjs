#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configurations = [
  "infrastructure/standalone.yml",
  "infrastructure/standalone-latest.yml",
  "did-resolver-service/compose.e2e.yml",
  "demo/docker-compose.yml",
];

for (const file of configurations) {
  for (const scheme of ["ws", "wss"]) {
    const env = { ...process.env };
    // Exercise the explicit default as well as the documented startup override.
    delete env.LOCAL_NODE_WS_SCHEME;
    if (scheme === "wss") env.LOCAL_NODE_WS_SCHEME = scheme;
    const rendered = spawnSync("docker", [
      "compose", "--env-file", "/dev/null", "-p", "resolver-node-scheme-check",
      "-f", file, "config", "--format", "json",
    ], { cwd: root, env, encoding: "utf8" });
    if (rendered.error) throw rendered.error;
    assert.equal(rendered.status, 0, `${file}: Compose configuration failed: ${rendered.stderr}`);
    const settings = JSON.parse(rendered.stdout).services.indexer.environment;
    const expected = `${scheme}://node:9944`;
    assert.equal(settings.APP__INFRA__NODE__URL, expected, `${file}: main node scheme`);
    assert.equal(settings.APP__INFRA__SPO_NODE__URL, expected, `${file}: SPO node scheme`);
  }
}
console.log("All four standalone configurations preserve local-only ws defaults and apply the wss startup override to both node clients. Rendering is not TLS deployment validation.");
