"""Hang Up speech service.

NVIDIA Parakeet TDT 0.6B v2 for speech-to-text and Kokoro for text-to-speech,
both run with sherpa-onnx. Uses CUDA when available (Nebius AI Cloud GPU),
otherwise CPU, which is fast enough for a demo.
"""

import io
import os
import threading
import time
import wave

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

MODELS = os.environ.get("MODELS_DIR", "/models")
PROVIDER = os.environ.get("ONNX_PROVIDER", "cpu")  # "cuda" on a GPU box
THREADS = int(os.environ.get("NUM_THREADS", "4"))

PARAKEET = os.path.join(MODELS, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8")
KOKORO = os.path.join(MODELS, "kokoro-en-v0_19")

# Speaker ids of kokoro-en-v0_19
VOICES = {
    "af": 0, "af_bella": 1, "af_nicole": 2, "af_sarah": 3, "af_sky": 4,
    "am_adam": 5, "am_michael": 6, "bf_emma": 7, "bf_isabella": 8,
    "bm_george": 9, "bm_lewis": 10,
}

recognizer = sherpa_onnx.OfflineRecognizer.from_transducer(
    encoder=os.path.join(PARAKEET, "encoder.int8.onnx"),
    decoder=os.path.join(PARAKEET, "decoder.int8.onnx"),
    joiner=os.path.join(PARAKEET, "joiner.int8.onnx"),
    tokens=os.path.join(PARAKEET, "tokens.txt"),
    model_type="nemo_transducer",
    num_threads=THREADS,
    provider=PROVIDER,
)

tts = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=os.path.join(KOKORO, "model.onnx"),
                voices=os.path.join(KOKORO, "voices.bin"),
                tokens=os.path.join(KOKORO, "tokens.txt"),
                data_dir=os.path.join(KOKORO, "espeak-ng-data"),
            ),
            num_threads=THREADS,
            provider=PROVIDER,
        ),
        max_num_sentences=1,
    )
)

# onnxruntime sessions are not guaranteed thread-safe for concurrent runs
stt_lock = threading.Lock()
tts_lock = threading.Lock()

app = FastAPI(title="Hang Up speech")


@app.get("/health")
def health():
    return {"stt": "parakeet-tdt-0.6b-v2", "tts": "kokoro-en-v0_19", "provider": PROVIDER, "voices": list(VOICES)}


@app.post("/stt")
async def stt(request: Request):
    raw = await request.body()
    if len(raw) < 3200:  # under 0.1 s
        return {"text": ""}
    samples = np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    t = time.time()
    with stt_lock:
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        text = stream.result.text.strip()
    return JSONResponse({"text": text, "ms": int((time.time() - t) * 1000)})


class TtsBody(BaseModel):
    text: str
    voice: str = "af_bella"
    speed: float = 1.0
    phone: bool = False


def phone_line(x: np.ndarray, sr: int) -> np.ndarray:
    """Band-limit to 300-3400 Hz and add gentle saturation, like a phone call."""
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    spec[(freqs < 300) | (freqs > 3400)] *= 0.03
    y = np.fft.irfft(spec, n=len(x))
    y = np.tanh(y * 1.6) / np.tanh(1.6)
    return y.astype(np.float32)


@app.post("/tts")
def synth(body: TtsBody):
    text = body.text.strip()[:600]
    if not text:
        raise HTTPException(400, "empty text")
    sid = VOICES.get(body.voice, 1)
    with tts_lock:
        audio = tts.generate(text, sid=sid, speed=max(0.6, min(1.6, body.speed)))
    samples = np.asarray(audio.samples, dtype=np.float32)
    if body.phone:
        samples = phone_line(samples, audio.sample_rate)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(audio.sample_rate)
        w.writeframes(pcm)
    return Response(buf.getvalue(), media_type="audio/wav")
