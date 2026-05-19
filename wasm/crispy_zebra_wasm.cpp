#include "../CrispyZebra.h"
#include <emscripten.h>
#include <stdint.h>
#include <cstring>
#include <vector>
#include <memory>
#include <algorithm>

// Global engine instance
static CrispyZebra::Engine<8>* g_engine = nullptr;
static std::vector<int16_t>* g_audio_buffer = nullptr;
static const int16_t* g_sin_lut = nullptr;
static uint32_t g_sample_rate = 44100;

extern "C" {

// Initialize the CZ engine
EMSCRIPTEN_KEEPALIVE
void init_engine() {
    if (g_engine == nullptr) {
        g_engine = new CrispyZebra::Engine<8>();
        g_audio_buffer = new std::vector<int16_t>(8192 * 2); // 8192 samples * stereo
    }
}

// Setup the engine with sine LUT
EMSCRIPTEN_KEEPALIVE
void setup_engine(const int16_t* sin_lut, uint16_t lut_size, uint32_t sample_rate) {
    if (g_engine) {
        g_sin_lut = sin_lut;
        g_sample_rate = sample_rate;
        g_engine->setup(sin_lut, lut_size, sample_rate);
    }
}

// Generate sine LUT (returns pointer to data)
EMSCRIPTEN_KEEPALIVE
const int16_t* generate_sin_lut(uint16_t size) {
    static std::vector<int16_t>* sin_lut = nullptr;
    if (sin_lut == nullptr) {
        sin_lut = new std::vector<int16_t>(size);
        for (uint16_t i = 0; i < size; i++) {
            float phase = (2.0f * 3.14159265359f * i) / size;
            (*sin_lut)[i] = static_cast<int16_t>(-cos(phase) * 32767.0f);
        }
    }
    return sin_lut->data();
}

// MIDI Note On
EMSCRIPTEN_KEEPALIVE
void midi_note_on(uint8_t note) {
    if (g_engine) {
        g_engine->midiNoteOn(note);
    }
}

// MIDI Note Off
EMSCRIPTEN_KEEPALIVE
void midi_note_off(uint8_t note) {
    if (g_engine) {
        g_engine->midiNoteOff(note);
    }
}

// Process audio block with variable buffer size
EMSCRIPTEN_KEEPALIVE
void process_audio_variable(uint32_t num_samples) {
    if (g_engine && g_audio_buffer) {
        uint32_t total_samples = num_samples * 2;
        for (uint32_t i = 0; i < total_samples; i++) {
            (*g_audio_buffer)[i] = 0;
        }
        g_engine->processBlock<int16_t, true>(g_audio_buffer->data(), num_samples);
    }
}

// Legacy: Process fixed 8192 samples
EMSCRIPTEN_KEEPALIVE
void process_audio() {
    process_audio_variable(8192);
}

// Get audio buffer pointer for JavaScript to read
EMSCRIPTEN_KEEPALIVE
const int16_t* get_audio_buffer() {
    if (g_audio_buffer) {
        return g_audio_buffer->data();
    }
    return nullptr;
}

// Get audio buffer size
EMSCRIPTEN_KEEPALIVE
uint32_t get_audio_buffer_size() {
    if (g_audio_buffer) {
        return g_audio_buffer->size();
    }
    return 0;
}

// Copy audio buffer to JavaScript array (safe method)
EMSCRIPTEN_KEEPALIVE
void copy_audio_buffer(int16_t* dest, uint32_t num_samples) {
    if (g_audio_buffer) {
        uint32_t copy_size = (num_samples < g_audio_buffer->size()) ? num_samples : g_audio_buffer->size();
        memcpy(dest, g_audio_buffer->data(), copy_size * sizeof(int16_t));
    }
}

// CZ Parameter setters
EMSCRIPTEN_KEEPALIVE
void set_waveform(uint8_t wave) {
    if (g_engine) {
        g_engine->setWaveform(static_cast<CrispyZebra::Waveform>(wave));
    }
}

EMSCRIPTEN_KEEPALIVE
void set_line_select(uint8_t mode) {
    if (g_engine) {
        g_engine->setLineSelect(static_cast<CrispyZebra::LineSelectMode>(mode));
    }
}

EMSCRIPTEN_KEEPALIVE
void set_ring_modulation(bool enable) {
    if (g_engine) {
        g_engine->setRingModulation(enable);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_noise_modulation(bool enable) {
    if (g_engine) {
        g_engine->setNoiseModulation(enable);
    }
}

// Vibrato/LFO parameters
EMSCRIPTEN_KEEPALIVE
void set_vibrato_waveform(uint8_t waveform) {
    if (g_engine) {
        g_engine->setVibratoWaveform(static_cast<CrispyZebra::LfoWaveform>(waveform));
    }
}

EMSCRIPTEN_KEEPALIVE
void set_vibrato_rate(uint16_t rate) {
    if (g_engine) {
        g_engine->setVibratoRate(rate);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_vibrato_depth(uint16_t depth) {
    if (g_engine) {
        g_engine->setVibratoDepth(depth);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_vibrato_delay(uint16_t delay) {
    if (g_engine) {
        g_engine->setVibratoDelay(delay);
    }
}

// Detune parameters
EMSCRIPTEN_KEEPALIVE
void set_detune_octave(int8_t octave) {
    if (g_engine) {
        g_engine->setDetuneOctave(octave);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_detune_note(int8_t note) {
    if (g_engine) {
        g_engine->setDetuneNote(note);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_detune_fine(uint8_t fine) {
    if (g_engine) {
        g_engine->setDetuneFine(fine);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_detune_sign(int8_t sign) {
    if (g_engine) {
        g_engine->setDetuneSign(sign);
    }
}

// ─── MASTER section ───
EMSCRIPTEN_KEEPALIVE
void set_master_octave(uint8_t oct) {
    if (g_engine) g_engine->setMasterOctave(oct);
}

EMSCRIPTEN_KEEPALIVE
void set_master_note(uint8_t note) {
    if (g_engine) g_engine->setMasterNote(note);
}

EMSCRIPTEN_KEEPALIVE
void set_master_fine(uint8_t fine) {
    if (g_engine) g_engine->setMasterFine(fine);
}

EMSCRIPTEN_KEEPALIVE
void set_master_pan(uint8_t pan) {
    if (g_engine) g_engine->setMasterPan(pan);
}

EMSCRIPTEN_KEEPALIVE
void set_master_drive(uint8_t drive) {
    if (g_engine) g_engine->setMasterDrive(drive);
}

EMSCRIPTEN_KEEPALIVE
void set_master_volume(uint8_t vol) {
    if (g_engine) g_engine->setMasterVolume(vol);
}

EMSCRIPTEN_KEEPALIVE
void set_portamento_enabled(bool enabled) {
    if (g_engine) g_engine->setPortamentoEnabled(enabled);
}

EMSCRIPTEN_KEEPALIVE
void set_portamento_time(uint8_t time) {
    if (g_engine) g_engine->setPortamentoTime(time);
}

EMSCRIPTEN_KEEPALIVE
void set_pitch_bend_range_up(uint8_t semitones) {
    if (g_engine) g_engine->setPitchBendRangeUp(semitones);
}

EMSCRIPTEN_KEEPALIVE
void set_pitch_bend_range_down(uint8_t semitones) {
    if (g_engine) g_engine->setPitchBendRangeDown(semitones);
}

EMSCRIPTEN_KEEPALIVE
void set_pitch_bend(int16_t value) {
    if (g_engine) g_engine->setPitchBend(value);
}

// ─── Preset system ───
EMSCRIPTEN_KEEPALIVE
void set_preset_index(uint8_t idx) {
    if (g_engine) g_engine->setPresetIndex(idx);
}

EMSCRIPTEN_KEEPALIVE
uint8_t get_preset_index() {
    if (g_engine) return g_engine->getPresetIndex();
    return 0;
}

EMSCRIPTEN_KEEPALIVE
const char* get_preset_name() {
    if (g_engine) return g_engine->getPresetName();
    return "Default";
}

EMSCRIPTEN_KEEPALIVE
const char* get_preset_category() {
    if (g_engine) return g_engine->getPresetCategory();
    return "User";
}

EMSCRIPTEN_KEEPALIVE
void set_dark_mode(bool on) {
    if (g_engine) g_engine->setDarkMode(on);
}

EMSCRIPTEN_KEEPALIVE
bool get_dark_mode() {
    if (g_engine) return g_engine->getDarkMode();
    return true;
}

// Key follow parameters
EMSCRIPTEN_KEEPALIVE
void set_dcw_key_follow(uint8_t amount) {
    if (g_engine) {
        g_engine->setDCWKeyFollow(amount);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dca_key_follow(uint8_t amount) {
    if (g_engine) {
        g_engine->setDCAKeyFollow(amount);
    }
}

// Wave parameters (Line 1)
EMSCRIPTEN_KEEPALIVE
void set_line1_wave1(uint8_t wave) {
    if (g_engine) {
        g_engine->setLine1Wave1(wave);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_line1_wave2(uint8_t wave) {
    if (g_engine) {
        g_engine->setLine1Wave2(wave);
    }
}

// Wave parameters (Line 2)
EMSCRIPTEN_KEEPALIVE
void set_line2_wave1(uint8_t wave) {
    if (g_engine) {
        g_engine->setLine2Wave1(wave);
    }
}

EMSCRIPTEN_KEEPALIVE
void set_line2_wave2(uint8_t wave) {
    if (g_engine) {
        g_engine->setLine2Wave2(wave);
    }
}

// ==========================================
// Ultimate 8-stage EG generic setter
// ==========================================

// EG Rate (0-99) - supports all 8 stages
EMSCRIPTEN_KEEPALIVE
void set_eg_rate(int line, int eg_type, int stage, uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(line, eg_type, stage, value);
    }
}

// EG Level (0-99) - supports all 8 stages
EMSCRIPTEN_KEEPALIVE
void set_eg_level(int line, int eg_type, int stage, uint8_t value) {
    if (g_engine) {
        g_engine->setEgLevel(line, eg_type, stage, value);
    }
}

// Sustain Point (0-7, or 255 for no sustain)
EMSCRIPTEN_KEEPALIVE
void set_eg_sustain_point(int line, int eg_type, uint8_t point) {
    if (g_engine) {
        g_engine->setEgSustainPoint(line, eg_type, point);
    }
}

// End Point (0-7)
EMSCRIPTEN_KEEPALIVE
void set_eg_end_point(int line, int eg_type, uint8_t point) {
    if (g_engine) {
        g_engine->setEgEndPoint(line, eg_type, point);
    }
}

// ==========================================
// Legacy wrappers for compatibility (deprecated)
// ==========================================

// DCO Envelope parameters (Line 1) - LEGACY
EMSCRIPTEN_KEEPALIVE
void set_dco_eg_attack(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 0, 0, value); // line=1, eg_type=0(DCO), stage=0(Attack)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dco_eg_decay1(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 0, 1, value); // line=1, eg_type=0(DCO), stage=1(Decay1)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dco_eg_decay2(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 0, 2, value); // line=1, eg_type=0(DCO), stage=2(Decay2)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dco_eg_release(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 0, 5, value); // line=1, eg_type=0(DCO), stage=5(Release)
    }
}

// DCW Envelope parameters (Line 1)
EMSCRIPTEN_KEEPALIVE
void set_dcw_eg_attack(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 1, 0, value); // line=1, eg_type=1(DCW), stage=0(Attack)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dcw_eg_decay1(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 1, 1, value); // line=1, eg_type=1(DCW), stage=1(Decay1)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dcw_eg_decay2(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 1, 2, value); // line=1, eg_type=1(DCW), stage=2(Decay2)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dcw_eg_release(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 1, 5, value); // line=1, eg_type=1(DCW), stage=5(Release)
    }
}

// DCA Envelope parameters (Line 1)
EMSCRIPTEN_KEEPALIVE
void set_dca_eg_attack(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 2, 0, value); // line=1, eg_type=2(DCA), stage=0(Attack)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dca_eg_decay1(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 2, 1, value); // line=1, eg_type=2(DCA), stage=1(Decay1)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dca_eg_decay2(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 2, 2, value); // line=1, eg_type=2(DCA), stage=2(Decay2)
    }
}

EMSCRIPTEN_KEEPALIVE
void set_dca_eg_release(uint8_t value) {
    if (g_engine) {
        g_engine->setEgRate(1, 2, 5, value); // line=1, eg_type=2(DCA), stage=5(Release)
    }
}

// Debug: dump envelope state
EMSCRIPTEN_KEEPALIVE
void debug_envelope_state() {
    if (!g_engine) {
        printf("Engine not initialized\n");
        return;
    }

    printf("Debug: Engine initialized, but cannot access private envelope members from WASM\n");
    printf("Hint: Add public getter methods to CrispyZebra.h for debugging\n");
}

EMSCRIPTEN_KEEPALIVE
int32_t debug_active_voices() {
    if (!g_engine) return -1;
    return g_engine->getActiveVoiceCount();
}

EMSCRIPTEN_KEEPALIVE
uint16_t debug_dca_level(int voice_idx) {
    if (!g_engine) return 0;
    return g_engine->getDcaLevel(voice_idx);
}

EMSCRIPTEN_KEEPALIVE
uint8_t debug_dca_end_point() {
    if (!g_engine) return 0;
    return g_engine->getDcaEndPoint();
}

EMSCRIPTEN_KEEPALIVE
uint8_t debug_dca_sustain_point() {
    if (!g_engine) return 0;
    return g_engine->getDcaSustainPoint();
}

EMSCRIPTEN_KEEPALIVE
uint32_t debug_dca_rate(int stage) {
    if (!g_engine) return 0;
    return g_engine->getDcaRate(stage);
}

EMSCRIPTEN_KEEPALIVE
uint16_t debug_dca_level_stage(int stage) {
    if (!g_engine) return 0;
    return g_engine->getDcaLevelStage(stage);
}

}
