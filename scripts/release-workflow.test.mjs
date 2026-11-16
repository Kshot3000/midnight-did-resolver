// This file is part of midnightntwrk/midnight-did-resolver.
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const publication = parse(read(".github/workflows/release-docker.yml"));
const ci = parse(read(".github/workflows/ci.yml"));
const output = (step, key) => `\${{ steps.${step}.outputs.${key} }}`;
const releaseIf = "github.event_name == 'workflow_dispatch' && github.ref_type == 'branch' && ((inputs.channel == 'rc' && (github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main')) || (inputs.channel == 'release' && github.ref == 'refs/heads/main'))";
const normalize = (s) => s.replace(/\s+/g, " ").trim();
const guard = `set -euo pipefail
[[ "\${EVENT_NAME}" == workflow_dispatch && "\${REF_TYPE}" == branch ]]
case "\${CHANNEL}:\${REF}" in
  rc:refs/heads/develop|rc:refs/heads/main|release:refs/heads/main) ;;
  *) echo "::error::Unsupported publication channel/source ref"; exit 1 ;;
esac
`;

// Check actual consumer wiring, not merely policy helpers. Mutation tests below
// prove unsafe workflow edits fail this same contract check in CI.
function checkWorkflow(w, c) {
  assert.deepEqual(w.on, { workflow_dispatch: { inputs: {
    channel: { description: "Publication channel (source eligibility is not release approval)", required: true, type: "choice", default: "rc", options: ["rc", "release"] },
    version: { description: "Full image version: X.Y.Z-rc.N for rc, X.Y.Z for release", required: true, type: "string" },
    platforms: { description: "Buildx target platforms", required: false, default: "linux/amd64,linux/arm64", type: "string" },
  } } });
  assert.deepEqual(w.permissions, { contents: "read" });
  assert.equal(w.env, undefined);
  assert.deepEqual(Object.keys(w.jobs).sort(), ["release", "validate-dispatch"]);
  const preflight = w.jobs["validate-dispatch"];
  assert.deepEqual(preflight.permissions, {});
  assert.equal(preflight.steps.length, 1);
  assert.deepEqual(preflight.steps[0].env, {
    EVENT_NAME: "${{ github.event_name }}", REF_TYPE: "${{ github.ref_type }}", REF: "${{ github.ref }}", CHANNEL: "${{ inputs.channel }}",
  });
  assert.equal(preflight.steps[0].run, guard);
  assert.equal(preflight.if, undefined);
  const job = w.jobs.release;
  assert.equal(job.needs, "validate-dispatch");
  assert.equal(normalize(job.if), releaseIf);
  assert.deepEqual(job.permissions, { contents: "read", packages: "write", "id-token": "write" });
  assert.deepEqual(job.env, { INPUT_CHANNEL: "${{ inputs.channel }}", INPUT_VERSION: "${{ inputs.version }}", INPUT_PLATFORMS: "${{ inputs.platforms }}" });
  const steps = job.steps;
  assert.equal(steps.length, 14);
  for (const step of steps) {
    assert.equal(step.if, undefined, "No consumer or validation step may be skipped");
    assert.equal(step["continue-on-error"], undefined);
    assert.equal(step["working-directory"], undefined);
    if (step.uses) assert.match(step.uses, /@[0-9a-f]{40}$/);
  }
  assert.deepEqual(steps[0].with, { ref: "${{ github.sha }}", "persist-credentials": false });
  assert.equal(steps[0].uses, "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
  assert.equal(steps[1].uses, "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38");
  assert.deepEqual(steps[1].with, { "node-version": "24" });
  assert.equal(steps[2].id, "meta");
  assert.equal(steps[2].run, "node scripts/release-context.mjs resolve");
  assert.equal(steps[2].env, undefined);
  assert.equal(steps[3].uses, "docker/setup-qemu-action@c7c53464625b32c7a7e944ae62b3e17d2b600130");
  assert.equal(steps[4].uses, "docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f");
  assert.equal(steps[5].uses, "docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9");
  assert.deepEqual(steps[5].with, { registry: "ghcr.io", username: "${{ github.repository_owner }}", password: "${{ secrets.GITHUB_TOKEN }}" });
  for (const [index, service] of [[6, "resolver"], [8, "manager"]]) {
    const boundary = steps[index];
    assert.equal(boundary.id, `${service}_context`);
    assert.equal(boundary.run, "node scripts/release-context.mjs boundary");
    assert.deepEqual(boundary.env, { RELEASE_CONTEXT: output("meta", "context") });
    const build = steps[index + 1];
    assert.equal(build.id, `build_${service}`);
    assert.equal(build.uses, "docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8");
    assert.deepEqual(build.with, {
      context: ".", file: `did-${service}-service/Dockerfile`,
      platforms: output(`${service}_context`, "platforms"), tags: output(`${service}_context`, `${service}_tags`),
      labels: `org.opencontainers.image.revision=${output(`${service}_context`, "source_sha")}\norg.opencontainers.image.source=https://github.com/midnightntwrk/midnight-did-resolver\norg.opencontainers.image.version=${output(`${service}_context`, "version")}\n`,
      push: true, provenance: "mode=max", sbom: true,
    });
    assert.equal(build.env, undefined);
  }
  assert.equal(steps[10].uses, "sigstore/cosign-installer@7e8b541eb2e61bf99390e1afd4be13a184e9ebc5");
  assert.deepEqual(steps[10].with, { "cosign-release": "v2.6.1" });
  for (const [index, command] of [[11, "sign"], [12, "verify"], [13, "summary"]]) {
    // Index assertions also ensure no mutation step intervenes between a
    // boundary and its consumer.
    const step = steps[index];
    assert.equal(step.run, `node scripts/release-context.mjs ${command}`);
    assert.deepEqual(step.env, {
      RELEASE_CONTEXT: output("meta", "context"),
      RESOLVER_DIGEST: output("build_resolver", "digest"), MANAGER_DIGEST: output("build_manager", "digest"),
    });
  }
  assert.deepEqual(c.on, { push: { branches: ["develop", "main"] }, pull_request: { branches: ["develop", "main"] }, workflow_dispatch: {} });
  assert.ok(c.jobs.validate.steps.some((s) => s.run === "npm run test:release-policy" && s.if === undefined && s["continue-on-error"] === undefined));
  assert.ok(c.jobs.validate.steps.some((s) => s.run === "npm audit --omit=dev --audit-level=high"));
  assert.deepEqual(c.permissions, { contents: "read" });
}

test("publication workflow consumes only validated source/version/tags; preserves security controls and CI coverage", () => {
  checkWorkflow(publication, ci);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["test:release-policy"], "node --test scripts/release-context.test.mjs scripts/release-workflow.test.mjs");
});

test("actual pre-checkout guard fails closed for the event/ref/channel matrix", () => {
  const script = publication.jobs["validate-dispatch"].steps[0].run;
  for (const channel of ["rc", "release", "snapshot", "", "RC"]) {
    for (const ref of ["refs/heads/develop", "refs/heads/main", "refs/tags/main", "refs/tags/develop", "refs/tags/v0.1.0",
      "refs/heads/feature/main", "refs/heads/main/child", "refs/heads/develop/child", "refs/heads/develop-evil", "refs/heads/main-evil", "refs/heads/milestone-x"]) {
      for (const event of ["workflow_dispatch", "push"]) {
        const result = spawnSync("bash", ["-c", script], { env: { ...process.env, CHANNEL: channel, REF: ref, EVENT_NAME: event, REF_TYPE: "branch" }, encoding: "utf8" });
        const allowed = event === "workflow_dispatch" && ((channel === "rc" && ["refs/heads/develop", "refs/heads/main"].includes(ref)) || (channel === "release" && ref === "refs/heads/main"));
        assert.equal(result.status === 0, allowed, `${event}:${channel}:${ref}`);
      }
    }
  }
  assert.notEqual(spawnSync("bash", ["-c", script], { env: { ...process.env, CHANNEL: "rc", REF: "refs/heads/develop", EVENT_NAME: "workflow_dispatch", REF_TYPE: "tag" } }).status, 0);
});

test("unsafe workflow mutations are rejected: triggers, source, tags/latest, identity CLI and bypassed boundaries", () => {
  const mutations = [
    (w) => { w.on.push = { tags: ["v*"] }; },
    (w) => { w.on.pull_request = {}; },
    (w) => { w.on.workflow_call = {}; },
    (w) => { w.on.workflow_dispatch.inputs.channel.options.push("snapshot"); },
    (w) => { w.on.workflow_dispatch.inputs.version.required = false; },
    (w) => { w.jobs["validate-dispatch"].steps[0].run = "true"; },
    (w) => { w.jobs.release.needs = []; },
    (w) => { w.jobs.release.if = "always()"; },
    (w) => { w.jobs.release.steps[0].with.ref = "develop"; },
    (w) => { w.jobs.release.steps[0].with["persist-credentials"] = true; },
    (w) => { w.jobs.release.env.GITHUB_SHA = "attacker"; },
    (w) => { w.jobs.release.steps[6].run = "true"; },
    (w) => { w.jobs.release.steps[8].env.RELEASE_CONTEXT = "{}"; },
    (w) => { w.jobs.release.steps[7].with.tags = "ghcr.io/midnightntwrk/midnight-did-resolver-service:latest"; },
    (w) => { w.jobs.release.steps[9].with.tags = output("meta", "manager_tags"); },
    (w) => { w.jobs.release.steps[7].with.labels = "org.opencontainers.image.revision=wrong"; },
    (w) => { w.jobs.release.steps[9].with.context = "https://github.com/attacker/repo.git"; },
    (w) => { w.jobs.release.steps[7].with.provenance = false; },
    (w) => { w.jobs.release.steps[9].with.sbom = false; },
    (w) => { w.jobs.release.steps[6]["continue-on-error"] = true; },
    (w) => { w.jobs.release.steps[8].if = "false"; },
    (w) => { w.jobs.release.steps[11].env.RESOLVER_DIGEST = "sha256:wrong"; },
    (w) => { w.jobs.release.steps[12].run = "cosign verify --certificate-identity-regexp '.*' attacker:latest"; },
    (w) => { w.jobs.release.steps[10].with["cosign-release"] = "main"; },
    (w) => { w.jobs.release.permissions.contents = "write"; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(publication); mutate(changed);
    assert.throws(() => checkWorkflow(changed, ci), String(mutate));
  }
  const changedCI = structuredClone(ci);
  changedCI.jobs.validate.steps = changedCI.jobs.validate.steps.filter((s) => s.run !== "npm run test:release-policy");
  assert.throws(() => checkWorkflow(publication, changedCI));
});
