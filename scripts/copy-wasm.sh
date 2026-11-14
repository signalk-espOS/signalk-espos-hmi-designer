#!/usr/bin/env bash
# Stage the LVGL-WASM bundle into the designer's webapp/public/wasm/ so
# Vite serves it alongside the rest of the bundle. Run before
# `vite build` (wired into the build:webapp npm script).
#
# Source resolution, in order:
#   1. JLP_WASM_DIR (explicit local override)
#   2. ../espos-p4-cockpit-wasm/public (sibling checkout, local dev)
#   3. raw.githubusercontent of the wasm repo's main branch (CI, where
#      the sibling repo isn't checked out — without this the published
#      package ships no wasm and the designer's WASM canvas 404s).
#
# Only a release build (REQUIRE_WASM=1) fails if the bundle can't be
# obtained at all; any other build goes on and the WASM preview just
# won't load.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DEFAULT="${REPO_ROOT}/../espos-p4-cockpit-wasm/public"
SRC="${JLP_WASM_DIR:-$SRC_DEFAULT}"
DEST="${REPO_ROOT}/webapp/public/wasm"
RAW_BASE="${JLP_WASM_URL:-https://raw.githubusercontent.com/signalk-espOS/espos-p4-cockpit-wasm/main/public}"

mkdir -p "${DEST}"

if [[ -f "${SRC}/jlp_wasm.js" && -f "${SRC}/jlp_wasm.wasm" ]]; then
  cp -f "${SRC}/jlp_wasm.js"   "${DEST}/jlp_wasm.js"
  cp -f "${SRC}/jlp_wasm.wasm" "${DEST}/jlp_wasm.wasm"
  echo "[copy-wasm] copied wasm + glue from ${SRC}"
  exit 0
fi

echo "[copy-wasm] no local bundle at ${SRC}; fetching from ${RAW_BASE}" >&2
# Download beside the target and move into place only when both files
# arrived, so a failed fetch never removes a bundle an earlier build staged.
# The timeouts keep a network that drops packets from stalling the build.
fetch() {
  curl -fsSL --connect-timeout 10 --max-time 120 "${RAW_BASE}/$1" -o "${DEST}/$1.part"
}
if fetch jlp_wasm.js && fetch jlp_wasm.wasm; then
  mv -f "${DEST}/jlp_wasm.js.part"   "${DEST}/jlp_wasm.js"
  mv -f "${DEST}/jlp_wasm.wasm.part" "${DEST}/jlp_wasm.wasm"
  echo "[copy-wasm] fetched $(du -h "${DEST}/jlp_wasm.wasm" | cut -f1) wasm + glue"
  exit 0
fi
rm -f "${DEST}/jlp_wasm.js.part" "${DEST}/jlp_wasm.wasm.part"

# Fail loudly when publishing (publish.yml sets REQUIRE_WASM=1; true, yes and
# on count too) so a package can't reach npm without the wasm, the "blank WASM
# canvas" regression this fallback prevents. Every other build stays soft: the
# Signal K plugin registry builds the source with no network (firejail
# --net=none) and CI=true, and failing there scores the tests "not-runnable"
# although the tests never load the wasm.
require_flag="$(printf '%s' "${REQUIRE_WASM:-}" | tr '[:upper:]' '[:lower:]')"
if [[ "${require_flag}" =~ ^(1|true|yes|on)$ ]]; then
  echo "[copy-wasm] could not fetch the wasm bundle, which a release build requires" >&2
  echo "[copy-wasm] (build espos-p4-cockpit-wasm or check ${RAW_BASE})" >&2
  exit 1
fi

if [[ -f "${DEST}/jlp_wasm.js" && -f "${DEST}/jlp_wasm.wasm" ]]; then
  echo "[copy-wasm] fetch failed; keeping the bundle already in ${DEST}" >&2
  exit 0
fi

echo "[copy-wasm] could not obtain wasm bundle — WASM preview will be unavailable" >&2
echo "[copy-wasm] (build espos-p4-cockpit-wasm or check ${RAW_BASE})" >&2
exit 0
