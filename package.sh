#!/bin/sh
# Package this directory as a Zotero .xpi (a zip with manifest.json at the root).
set -e; V=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
# Exactly the files the served .xpi carries: no LICENSE, README, test/ or this script.
T=$(mktemp -d); zip -qr -X "$T/citestamp-$V.xpi" manifest.json bootstrap.js icon.png content lib locale -x '*/.*' '*.DS_Store'
mv -f "$T/citestamp-$V.xpi" "../citestamp-$V.xpi"; echo "wrote ../citestamp-$V.xpi"
