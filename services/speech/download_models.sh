#!/usr/bin/env sh
# Downloads NVIDIA Parakeet TDT 0.6B v2 (int8) and Kokoro (English) for sherpa-onnx.
set -e
DIR="${1:-./models}"
mkdir -p "$DIR" && cd "$DIR"
base=https://github.com/k2-fsa/sherpa-onnx/releases/download
[ -d sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 ] || curl -fsSL "$base/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2" | tar xj
[ -d kokoro-en-v0_19 ] || curl -fsSL "$base/tts-models/kokoro-en-v0_19.tar.bz2" | tar xj
echo "models ready in $DIR"
