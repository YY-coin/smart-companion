#!/bin/sh
set -eu
mkdir -p dist
cp server.js data.json package.json run.sh dist/
if [ -f 模型配置.json ]; then cp 模型配置.json dist/; fi
chmod 755 dist/run.sh
