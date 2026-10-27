#!/bin/sh
# Offline PT-BR narration with Piper (free, no key, no network at run time).
# Voice files are downloaded once (see README note in this directory) to
# output/piper-voices/; synthesis itself is fully local.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
VOICE_DIR="${VOICE_DIR:-$DIR/output/piper-voices}"
VOICE="$VOICE_DIR/pt_BR-cadu-medium.onnx"
if [ ! -f "$VOICE" ]; then
  echo "Missing voice model: $VOICE" >&2
  echo "Download once with curl:" >&2
  echo "  curl -L -o $VOICE https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx" >&2
  echo "  curl -L -o $VOICE.json https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/cadu/medium/pt_BR-cadu-medium.onnx.json" >&2
  exit 1
fi
piper --model "$VOICE" --output_file "$DIR/output/narration.wav" < "$DIR/script-ptbr.txt"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$DIR/output/narration.wav"
