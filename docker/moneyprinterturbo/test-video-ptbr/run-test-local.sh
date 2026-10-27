#!/bin/sh
# PT-BR vertical test, fully local variant (no Edge TTS, no stock keys).
# Narration: Piper pt-BR (offline) -> --custom-audio-file.
# Subtitles: faster-whisper tiny, pre-downloaded to $MPT_HOME/models/whisper-tiny.
# Materials: local clips. Script: supplied (no LLM). Music: bundled BGM.
# Requires: `mpt` and `piper` console scripts on PATH.
# Nothing is posted anywhere; the video stays in output/ for human review.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
MPT_HOME="${MPT_HOME:-$DIR/output/mpt-home}"
export MPT_HOME
mkdir -p "$MPT_HOME" "$DIR/output/materials" "$MPT_HOME/models/whisper-tiny"
if [ ! -f "$MPT_HOME/config.toml" ]; then
  sed -e 's/^listen_host = .*/listen_host = "127.0.0.1"/' \
      -e 's/^video_source = .*/video_source = "local"/' \
      -e 's/^subtitle_provider = .*/subtitle_provider = "whisper"/' \
      "$DIR/../config.example.toml" > "$MPT_HOME/config.toml"
  printf '\n[whisper]\nmodel_size = "tiny"\ndevice = "cpu"\ncompute_type = "int8"\n' >> "$MPT_HOME/config.toml"
fi
sh "$DIR/make-materials.sh"
if [ ! -f "$DIR/output/narration.wav" ]; then
  echo "Missing narration: run make-narration.sh first (piper pt-BR)." >&2
  exit 1
fi
mpt cli \
  --video-subject "Aveiro, a Veneza de Portugal" \
  --video-script "$(cat "$DIR/script-ptbr.txt")" \
  --video-language "pt-BR" \
  --video-aspect "9:16" \
  --video-source local \
  --video-materials "$DIR/output/materials/clip-1.mp4,$DIR/output/materials/clip-2.mp4,$DIR/output/materials/clip-3.mp4" \
  --custom-audio-file "$DIR/output/narration.wav" \
  --subtitle-enabled
echo "---"
echo "Outputs are under: $MPT_HOME/storage/tasks (copy the final MP4 to output/ for review)"
