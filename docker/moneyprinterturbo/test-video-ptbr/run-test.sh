#!/bin/sh
# PT-BR vertical test for the isolated MoneyPrinterTurbo engine.
# $0 path only: no LLM (script is supplied), no stock keys (local materials),
# TTS via Edge (free, no key), subtitles on, bundled background music.
# Requires: the `mpt` console script on PATH (pip package `mpt`, official).
# Nothing is posted anywhere; the video stays in output/ for human review.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
MPT_HOME="${MPT_HOME:-$DIR/output/mpt-home}"
export MPT_HOME
mkdir -p "$MPT_HOME" "$DIR/output/materials"
if [ ! -f "$MPT_HOME/config.toml" ]; then
  sed -e 's/^listen_host = .*/listen_host = "127.0.0.1"/' \
      -e 's/^video_source = .*/video_source = "local"/' \
      -e 's/^subtitle_provider = .*/subtitle_provider = "edge"/' \
      "$DIR/../config.example.toml" > "$MPT_HOME/config.toml"
fi
sh "$DIR/make-materials.sh"
mpt cli \
  --video-subject "Aveiro, a Veneza de Portugal" \
  --video-script "$(cat "$DIR/script-ptbr.txt")" \
  --video-language "pt-BR" \
  --video-aspect "9:16" \
  --video-source local \
  --video-materials "$DIR/output/materials/clip-1.mp4,$DIR/output/materials/clip-2.mp4,$DIR/output/materials/clip-3.mp4" \
  --voice-name "pt-BR-FranciscaNeural" \
  --subtitle-enabled
echo "---"
echo "Outputs are under: $MPT_HOME/storage/tasks (copy the final MP4 to output/ for review)"
