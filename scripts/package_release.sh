#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

VERSION="$(python3 -c 'import json, pathlib; print(json.loads(pathlib.Path("manifest.json").read_text())["version"])')"
PACKAGE_NAME="tab-deck-extension-v${VERSION}"
DIST_DIR="${ROOT_DIR}/dist"
TMP_DIR="$(mktemp -d)"
STAGE_DIR="${TMP_DIR}/${PACKAGE_NAME}"
ZIP_PATH="${DIST_DIR}/${PACKAGE_NAME}.zip"

mkdir -p "${STAGE_DIR}"

cp manifest.json newtab.html popup.html README.md "${STAGE_DIR}/"
mkdir -p "${STAGE_DIR}/src"
cp src/app.js src/popup.js src/storage.js src/styles.css "${STAGE_DIR}/src/"

mkdir -p "${DIST_DIR}"
cd "${TMP_DIR}"
zip -qr "${ZIP_PATH}" "${PACKAGE_NAME}"

echo "${ZIP_PATH}"
