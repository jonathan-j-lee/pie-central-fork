#!/bin/bash -ex

npm run build
mkdir -p dist
tar \
  --create \
  --file dist/shepherd-$(git describe --tags).tar.gz \
  --gzip \
  --exclude '*.map' \
  --transform s/build/shepherd/ \
  build \
