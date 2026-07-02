#!/usr/bin/env python3
"""
Generate MeetBook opening ringtone — short melodic phrase.

A warm, uplifting 5-note rising melody (C-E-G-C-E) that sounds like
a premium app ringtone.  Uses triangle-wave with harmonics for a
marimba/music-box tone — organic, not synthetic.

Output: 44100Hz, 16-bit mono WAV at assets/sounds/opening-chime.wav

Usage:  python3 scripts/generate-chime.py
"""

import math
import struct
import sys
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────
SAMPLE_RATE = 44100
BITS = 16
CHANNELS = 1

# ─── Melody ──────────────────────────────────────────────────────
# (note_name, frequency_hz, start_ms, duration_ms, volume)
# A simple rising phrase in C major — warm, positive, ringtone-like
NOTES = [
    ('C5',  523.25,   0,   280, 0.45),   # C — anchor
    ('E5',  659.25, 200,   240, 0.40),   # E — lift
    ('G5',  783.99, 380,   220, 0.35),   # G — peak
    ('C6', 1046.50, 540,   300, 0.30),   # C — resolution
    ('E6', 1318.50, 720,   400, 0.18),   # E — sparkle tail
]

# Add a soft bass pad underneath for warmth
BASS = [
    ('C3', 130.81,   0, 1000, 0.12),     # C3 — warm sub
    ('G3', 196.00, 400,  800, 0.08),     # G3 — gentle movement
]

TOTAL_DURATION = 1.3  # seconds
NUM_SAMPLES = int(SAMPLE_RATE * TOTAL_DURATION)

# ─── Synthesize a single note ────────────────────────────────────
def synthesize(freq: float, duration_s: float, start_s: float,
               volume: float, sample_rate: int, num_samples: int) -> list[float]:
    """Generate a marimba-like note with triangle wave + harmonics."""
    buf = [0.0] * num_samples
    start_i = int(start_s * sample_rate)
    end_i = min(num_samples, start_i + int(duration_s * sample_rate))

    # Triangle wave with 3 harmonics for warm timbre
    harmonics = [(1.0, 1.0), (3.0, 0.25), (5.0, 0.08)]

    for i in range(start_i, end_i):
        t = (i - start_i) / sample_rate
        rel_dur = t / duration_s

        # Exponential decay envelope
        env = math.exp(-t * 4.0 / duration_s)
        # Fast attack (3ms)
        attack = min(1.0, t / 0.003)

        sample = 0.0
        for h_mult, h_gain in harmonics:
            h_freq = freq * h_mult
            # Triangle wave formula
            p = (h_freq * t) % 1.0
            if p < 0.5:
                val = 4.0 * p - 1.0
            else:
                val = 3.0 - 4.0 * p
            sample += val * h_gain

        sample *= volume * env * attack
        buf[i] += sample

    return buf

# ─── Main synthesis ──────────────────────────────────────────────
def generate():
    mix = [0.0] * NUM_SAMPLES

    # Render all notes
    for name, freq, start_ms, dur_ms, vol in NOTES:
        note = synthesize(freq, dur_ms / 1000, start_ms / 1000,
                          vol, SAMPLE_RATE, NUM_SAMPLES)
        for i in range(NUM_SAMPLES):
            mix[i] += note[i]

    # Render bass
    for name, freq, start_ms, dur_ms, vol in BASS:
        bass = synthesize(freq, dur_ms / 1000, start_ms / 1000,
                          vol * 0.6, SAMPLE_RATE, NUM_SAMPLES)
        for i in range(NUM_SAMPLES):
            mix[i] += bass[i]

    # Soft saturation for warmth
    for i in range(NUM_SAMPLES):
        mix[i] = math.tanh(mix[i] * 1.5)

    # Normalize to 0.95 peak
    peak = max(abs(s) for s in mix) or 1
    for i in range(NUM_SAMPLES):
        mix[i] *= 0.95 / peak

    return mix

# ─── Simple reverb ──────────────────────────────────────────────
def add_reverb(samples: list[float], sample_rate: int, mix: float = 0.18):
    """Add a simple reverb tail."""
    delays = [(0.025, 0.30), (0.047, 0.22), (0.073, 0.15)]
    wet = [0.0] * len(samples)

    for delay_s, gain in delays:
        delay_i = int(delay_s * sample_rate)
        for i in range(delay_i, len(samples)):
            wet[i] += samples[i - delay_i] * gain

    # Normalize wet
    w_peak = max(abs(w) for w in wet) or 1
    for i in range(len(wet)):
        wet[i] *= mix / w_peak

    return [samples[i] + wet[i] for i in range(len(samples))]

# ─── WAV writer ──────────────────────────────────────────────────
def write_wav(filename: str, samples: list[float], rate: int):
    num = len(samples)
    bps = BITS // 8
    data_size = num * bps
    file_size = 36 + data_size

    buf = bytearray(44 + data_size)
    off = 0

    buf[off:off+4] = b'RIFF';                           off += 4
    struct.pack_into('<I', buf, off, file_size);         off += 4
    buf[off:off+4] = b'WAVE';                            off += 4
    buf[off:off+4] = b'fmt ';                            off += 4
    struct.pack_into('<I', buf, off, 16);                off += 4
    struct.pack_into('<H', buf, off, 1);                 off += 2
    struct.pack_into('<H', buf, off, CHANNELS);          off += 2
    struct.pack_into('<I', buf, off, rate);              off += 4
    struct.pack_into('<I', buf, off, rate * CHANNELS * bps); off += 4
    struct.pack_into('<H', buf, off, CHANNELS * bps);    off += 2
    struct.pack_into('<H', buf, off, BITS);              off += 2
    buf[off:off+4] = b'data';                            off += 4
    struct.pack_into('<I', buf, off, data_size);         off += 4

    for s in samples:
        val = max(-32768, min(32767, int(s * 32767)))
        struct.pack_into('<h', buf, off, val)
        off += 2

    Path(filename).parent.mkdir(parents=True, exist_ok=True)
    with open(filename, 'wb') as f:
        f.write(buf)

    sz = len(buf) / 1024
    print(f"✓ Written: {filename}")
    print(f"  Duration: {TOTAL_DURATION:.2f}s | {sz:.1f} KB | {rate}Hz {BITS}-bit PCM")

# ─── Main ────────────────────────────────────────────────────────
if __name__ == '__main__':
    out = str(Path(__file__).resolve().parent.parent /
              'assets' / 'sounds' / 'opening-chime.wav')
    print("→ Generating MeetBook melodic ringtone...")
    dry = generate()
    wet = add_reverb(dry, SAMPLE_RATE)
    write_wav(out, wet, SAMPLE_RATE)
