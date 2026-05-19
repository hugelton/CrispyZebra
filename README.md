# <img width="547" height="159" alt="image" src="https://github.com/user-attachments/assets/21dece7f-f301-4545-8ff0-a22f9298c768" />


**CrispyZebra** is a lightweight, high-performance C++ synthesizer core engine designed to replicate the Phase Distortion (PD) synthesis of the 1980s CZ-series synthesizers. 

## Live Demo
[https://kurogedelic.github.io/CrispyZebra/wasm](https://kurogedelic.github.io/CrispyZebra/wasm)
The interactive WebAssembly (WASM) implementation with a full GUI is available.



## Features
* **Authentic PD Synthesis:** Reproduces the Phase Distortion waveforms including Saw, Square, Pulse, Double Sine, Saw-Pulse, and Resonance windows (Saw, Triangle, Trapezoid).
* **8-Stage Envelopes:** Three independent 8-stage EGs (DCO, DCW, DCA) per voice, fully compatible with vintage hardware SysEx point systems (Sustain/End points).
* **Fixed-Point Math:** Designed with platform-independent integer arithmetic (int32_t / Q16) for minimal CPU overhead.
* **WASM & Embedded Ready:** Zero external dependencies (header-only wrapper ready). Suitable for both browser-based execution and microcontrollers.
* **Modulation & Master Section:** Built-in Vibrato LFO, Detuning, Key Follow (DCA/DCW), Ring Modulation, Noise Modulation, Portamento, and Master Drive/Pan controls.

## Code Architecture
The engine is structured within the `CrispyZebra` namespace:
* `Oscillator`: The core Phase Distortion engine utilizing a custom Sine Look-Up Table (LUT) to warp phases dynamically.
  
  <img width="299" height="105" alt="image" src="https://github.com/user-attachments/assets/6894ff94-8fbd-4a15-bfbd-75797126c206" />
* `Envelope`: High-precision Q16 internal state envelope generator supporting up to 8 stages with rate/level configurations.
* `LFO`: Low-frequency oscillator providing Triangle, Square, Saw Up, and Saw Down shapes for pitch modulation.
  
  <img width="290" height="51" alt="image" src="https://github.com/user-attachments/assets/f00b5ee1-1dd4-4853-8ee0-7ad8314ad988" />
 
* `Voice`: A polyphonic container that couples two parallel lines (Oscillators) with routing, detuning, and modulation options.
* `Engine<MaxVoices>`: The template-driven master class that handles MIDI inputs (`midiNoteOn` / `midiNoteOff`) and renders block buffers.

## Quick Start
CrispyZebra is a single-header engine. Include `CrispyZebra.h` into your project.

```cpp
#include "CrispyZebra.h"

// Prepare your Sine Look-Up Table
const int16_t my_sine_lut[2048] = { /* pre-calculated sine values */ };

// Instantiate the engine with 8-voice polyphony
CrispyZebra::Engine<8> synthEngine;

void initAudio() {
    uint32_t sampleRate = 44100;
    synthEngine.setup(my_sine_lut, 2048, sampleRate);
}

void processAudio(float* buffer, uint32_t numSamples) {
    // Render stereo float samples directly into your audio callback
    synthEngine.processBlock<float, true>(buffer, numSamples);
}

void onMidiEvent(uint8_t status, uint8_t note, uint8_t velocity) {
    if (status == 0x90 && velocity > 0) {
        synthEngine.midiNoteOn(note);
    } else if (status == 0x80 || (status == 0x90 && velocity == 0)) {
        synthEngine.midiNoteOff(note);
    }
}

```

## Related Projects
* [**PicoCZ:**](https://github.com/kurogedelic/PicoCZ/) A hardware port of the CrispyZebra engine optimized for the RP2040 (Raspberry Pi Pico) microcontroller. 


## License
This project is licensed under the GNU General Public License v3.0 (GPL-3.0) - see the LICENSE file for details.
Copyright (C) 2026 Leo Kuroshita (@kurogedelic)

## Disclaimer
CrispyZebra is an independent open-source project developed by Leo Kuroshita. It is not affiliated with, endorsed by, or associated with CASIO Computer Co., Ltd. in any way. "CZ-101", "CZ-series", and "Phase Distortion" are referenced solely for historical and educational compatibility purposes.
