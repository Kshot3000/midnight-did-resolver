#!/usr/bin/env bash
set -euo pipefail

source ./scripts/run-common.sh
run_common_ensure_node

if [[ ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH+x} == x ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH-$PWD/node_modules/.cache/ms-playwright}"
  node ./scripts/playwright-browser.mjs --validate
fi

run_common_auto_proof_server_image "manager"

export DID_MANAGER_SETUP="${DID_MANAGER_SETUP:-standalone}"

echo "[manager] Check DID package refs"
npm run build:did-prereqs

echo "[manager] Build secret-storage dependency"
npm run build -w @midnight-ntwrk/midnight-did-secret-storage

echo "[manager] Lint"
npm run lint -w @midnight-ntwrk/midnight-did-manager-service

echo "[manager] Build"
npm --ignore-scripts run build -w @midnight-ntwrk/midnight-did-manager-service

echo "[manager] Unit tests"
npm --ignore-scripts run test -w @midnight-ntwrk/midnight-did-manager-service

if [[ "${SKIP_LONG_RUNNING:-0}" == "1" ]]; then
  echo "[manager] Skip Playwright E2E (SKIP_LONG_RUNNING=1)"
else
  if [[ ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH+x} == x ]]; then
    echo "[manager] Packaged Chromium: ${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}"
    echo "[manager] Playwright ffmpeg install (cache: ${PLAYWRIGHT_BROWSERS_PATH})"
    npm exec -w @midnight-ntwrk/midnight-did-manager-service -- playwright install ffmpeg

    echo "[manager] Playwright E2E (standalone)"
    npm run test:e2e:standalone -w @midnight-ntwrk/midnight-did-manager-service
  else
    echo "[manager] Playwright install"
    env -u PLAYWRIGHT_BROWSERS_PATH npm run playwright:install -w @midnight-ntwrk/midnight-did-manager-service

    echo "[manager] Playwright E2E (standalone)"
    env -u PLAYWRIGHT_BROWSERS_PATH npm run test:e2e:standalone -w @midnight-ntwrk/midnight-did-manager-service
  fi
fi

echo "[manager] Done"
