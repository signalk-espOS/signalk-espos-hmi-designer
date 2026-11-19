#!/usr/bin/env bash
# Stage the LVGL-WASM bundle into the designer's webapp/public/wasm/ so
# Vite serves it alongside the rest of the bundle. Run before
# `vite build` (wired into the build:webapp npm script).
#
# Source resolution, in order:
#   1. JLP_WASM_DIR (explicit local override)
#   2. ../espos-p4-cockpit-wasm/public (sibling checkout, local dev)
#   3. raw.githubusercontent of the wasm repo at JLP_WASM_REF (CI, where
#      the sibling repo isn't checked out — without this the published
#      package ships no wasm and the designer's WASM canvas 404s).
#
# JLP_WASM_REF defaults to a pinned commit of the wasm repo, not main: a
# release then ships the bundle this designer was written against, and
# taking a newer one is a commit here, which is what cuts the release that
# delivers it. Bump it to the wasm repo's latest "build: rebuild WASM
# bundle" commit after a rebuild.
#
# Only a release build (REQUIRE_WASM=1) fails if the bundle can't be
# obtained at all; any other build goes on and the WASM preview just
# won't load.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DEFAULT="${REPO_ROOT}/../espos-p4-cockpit-wasm/public"
SRC="${JLP_WASM_DIR:-$SRC_DEFAULT}"
DEST="${REPO_ROOT}/webapp/public/wasm"
JLP_WASM_REF="${JLP_WASM_REF:-123b971634f2639df1e7aaa3052ca7c7cb6b4e30}"
RAW_BASE="${JLP_WASM_URL:-https://raw.githubusercontent.com/signalk-espOS/espos-p4-cockpit-wasm/${JLP_WASM_REF}/public}"

require_flag="$(printf '%s' "${REQUIRE_WASM:-}" | tr '[:upper:]' '[:lower:]')"
required() { [[ "${require_flag}" =~ ^(1|true|yes|on)$ ]]; }

# The designer resizes the preview with jlp_resize for any device that is
# not 1024x600, and a bundle without it leaves that preview blank. A release
# build refuses such a bundle.
check_bundle() {
  if required && ! grep -q '_jlp_resize' "$1"; then
    echo "[copy-wasm] $2 has no jlp_resize; a release build needs a newer bundle" >&2
    rm -f "${DEST}/jlp_wasm.js.part" "${DEST}/jlp_wasm.wasm.part"
    exit 1
  fi
}

mkdir -p "${DEST}"

if [[ -f "${SRC}/jlp_wasm.js" && -f "${SRC}/jlp_wasm.wasm" ]]; then
  check_bundle "${SRC}/jlp_wasm.js" "the bundle in ${SRC}"
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
  check_bundle "${DEST}/jlp_wasm.js.part" "the bundle at ${RAW_BASE}"
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
if required; then
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
