#!/bin/sh
# Builds the Chrome Web Store package into dist/: only the files the manifest
# refers to, checked so nothing is missing.
#
#   ./build.sh
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

VERSION="$(python3 - "$BUILD" <<'EOF'
import json, os, shutil, sys
build = sys.argv[1]
m = json.load(open("manifest.json"))
needed = {"manifest.json"} | set(m["icons"].values())
for script in m["content_scripts"]:
    needed |= set(script.get("js", [])) | set(script.get("css", []))
missing = sorted(f for f in needed if not os.path.exists(f))
if missing:
    sys.exit("Missing from the package: " + ", ".join(missing))
for f in needed:
    os.makedirs(os.path.dirname(os.path.join(build, f)) or build, exist_ok=True)
    shutil.copy(f, os.path.join(build, f))
print(m["version"])
EOF
)"

OUT="$ROOT/dist/commit-span-for-bitbucket-$VERSION.zip"
mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$BUILD" && zip -r -X -q "$OUT" .)
echo "Built $OUT ($(du -k "$OUT" | cut -f1) KB)"
unzip -l "$OUT" | awk 'NR>3 && $4 {print "  " $4}' | sed '/^  $/d'
