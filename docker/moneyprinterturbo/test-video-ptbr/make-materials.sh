#!/bin/sh
# Generates local test materials (no stock provider, no keys needed).
# Three 720x1280 clips, 6 s each. Output goes to output/materials/ (gitignored).
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/output/materials"
mkdir -p "$OUT"
ffmpeg -y -v error -f lavfi -i "color=c=0x1a3a5c:s=720x1280:d=6" \
  -vf "format=yuv420p" "$OUT/clip-1.mp4"
ffmpeg -y -v error -f lavfi -i "color=c=0x8a5a2b:s=720x1280:d=6" \
  -vf "format=yuv420p" "$OUT/clip-2.mp4"
ffmpeg -y -v error -f lavfi -i "color=c=0x2e6b4f:s=720x1280:d=6" \
  -vf "format=yuv420p" "$OUT/clip-3.mp4"
ls -la "$OUT"
