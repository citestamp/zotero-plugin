#!/bin/sh
# Package this directory as a Zotero .xpi (a zip with manifest.json at the root).
set -e; V=$(python3 -c 'import json;print(json.load(open("manifest.json"))["version"])')
rm -f "../citestamp-$V.xpi"; zip -qr "../citestamp-$V.xpi" . -x 'package.sh' '.git/*' '*.DS_Store'; echo "wrote ../citestamp-$V.xpi"
