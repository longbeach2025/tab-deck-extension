#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

VERSION="$(python3 -c 'import json, pathlib; print(json.loads(pathlib.Path("package.json").read_text())["version"])')"
PACKAGE_NAME="tab-deck-extension-v${VERSION}"
DIST_DIR="${ROOT_DIR}/dist"
TMP_DIR="$(mktemp -d)"
STAGE_DIR="${TMP_DIR}/${PACKAGE_NAME}"
ZIP_PATH="${DIST_DIR}/${PACKAGE_NAME}.zip"

npm run build

cp manifest.json README.md "${DIST_DIR}/unpacked/"

# Inject update_url into manifest for prod build
# This signals webstore environment, bypassing machine binding UI
python3 - <<EOF
import json, pathlib
manifest_path = pathlib.Path("${DIST_DIR}/unpacked/manifest.json")
manifest = json.loads(manifest_path.read_text())
manifest["update_url"] = "https://clients2.google.com/service/update2/crx"
manifest_path.write_text(json.dumps(manifest, indent=2))
print(f"Injected update_url into {manifest_path}")
EOF

rm -rf "${ZIP_PATH}"
cp -R "${DIST_DIR}/unpacked" "${STAGE_DIR}"

# Copy prod cloud config into the package
mkdir -p "${STAGE_DIR}/config"
cp config/cloud-config.prod.json "${STAGE_DIR}/config/cloud-config.prod.json"
echo "Copied prod cloud config to ${STAGE_DIR}/config/"

mkdir -p "${DIST_DIR}"
cd "${TMP_DIR}"
zip -qr "${ZIP_PATH}" "${PACKAGE_NAME}"

echo "${ZIP_PATH}"
