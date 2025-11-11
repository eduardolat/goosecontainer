#!/bin/sh

set -e

apt update -qq >/dev/null 2>&1
apt install -y -qq wget libxcb1 bzip2 >/dev/null 2>&1

TMP_DIR="/tmp/goose_bin"
GOOSE_BIN="$TMP_DIR/goose"

if [ ! -f "$GOOSE_BIN" ]; then
  mkdir -p "$TMP_DIR"
  wget -q -O "$TMP_DIR/goose.tar.bz2" "https://github.com/block/goose/releases/download/v1.13.2/goose-x86_64-unknown-linux-gnu.tar.bz2"
  tar -xjf "$TMP_DIR/goose.tar.bz2" -C "$TMP_DIR"
  rm -f "$TMP_DIR/goose.tar.bz2"
  chmod +x "$GOOSE_BIN"
fi

exec "$GOOSE_BIN" mcp developer
