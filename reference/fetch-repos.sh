#!/usr/bin/env bash
# Re-clone the reference repos (gitignored) into reference/repos/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p repos
clone() { [ -d "repos/$2" ] || git clone --depth 1 "https://github.com/$1/$2.git" "repos/$2"; }
clone launchdarkly-labs statsig-to-ld
clone launchdarkly-labs ld-migration-scripts
clone statsig-io node-js-server-sdk
clone statsig-io python-sdk
clone statsig-io statsig-server-core
