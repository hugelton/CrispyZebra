/*
 * CrispyZebra.h
 * v1.0.0
 * Copyright (C) 2026 Leo Kuroshita @kurogedelic
 * https://github.com/kurogedelic/CrispyZebra/
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#pragma once

#include <cstdint>

namespace CrispyZebra {

// Fixed-point arithmetic support macros and inline functions
inline int32_t multiply_q15(int32_t a, int32_t b) { return (a * b) >> 15; }
inline int32_t multiply_q16(int32_t a, int32_t b) { return (a * b) >> 16; }

enum class Waveform : uint8_t {
    SAW         = 1, // Sawtooth
    SQUARE      = 2, // Square wave
    PULSE       = 3, // Pulse wave
    DOUBLE_SINE = 4, // Double sine
    SAW_PULSE   = 5, // Saw-pulse
    REZ_SAW     = 6, // Resonance (sawtooth window)
    REZ_TRI     = 7, // Resonance (triangle window)
    REZ_TRAP    = 8  // Resonance (trapezoid window)
};

enum class LineSelectMode : uint8_t {
    LINE1_ONLY  = 0, // LINE 1 only
    LINE2_ONLY  = 1, // LINE 2 only
    LINE1_2     = 2, // LINE 1 + 2 (normal)
    LINE1_2_INV  = 3 // LINE 1 + 2' (phase inverted)
};

enum class LfoWaveform : uint8_t {
    TRIANGLE    = 0, // Triangle wave
    SQUARE      = 1, // Square wave
    SAW_UP      = 2, // Upward sawtooth
    SAW_DOWN    = 3  // Downward sawtooth
};

// ==========================================
// 1. Platform-independent ultra-lightweight envelope
// ==========================================
class Envelope {
public:
    struct Stage {
        uint32_t rate;   // Speed (Q16 increment amount per sample)
        uint16_t level;  // Target value (0 to 65535)
    };

    Stage stages[8];
    uint32_t current_level = 0; // Q16 internal state
    uint8_t current_stage = 0;

    // 【CZ-101実機完全準拠】SysExからそのまま代入できるポイント制
    uint8_t sustain_point = 0xFF; // 0〜7, 0xFFはサスティンなし
    uint8_t end_point = 7;        // 0〜7, ここに達したら終了

    bool is_key_on = false;

    // CZ-101標準エンベロープ設定で初期化
    void initCz101Defaults() {
        stages[0] = {0xFFFFFFFF, 25000};
        stages[1] = {500000, 22000};
        stages[2] = {300000, 20000};
        stages[3] = {0, 20000};          // サスティンポイント (Rate=0でホールド)
        stages[4] = {200000, 10000};     // リリース1
        stages[5] = {200000, 0};         // リリース2
        stages[6] = {0, 0};              // End
        stages[7] = {0, 0};

        sustain_point = 3;
        end_point = 6;
    }

    void keyOn() {
        current_stage = 0;
        is_key_on = true;
    }

    void keyOff() {
        is_key_on = false;
        if (sustain_point != 0xFF && current_stage <= sustain_point) {
            current_stage = sustain_point + 1;
        }
    }

    // 32サンプルに1回呼ばれる
    inline uint16_t update() {
        uint8_t release_stage = end_point < 7 ? end_point + 1 : end_point;
        if (current_stage > release_stage) {
            current_level = 0;
            return 0;
        }

        uint32_t target = (current_stage > end_point) ? 0 : (stages[current_stage].level << 16);
        uint32_t step = stages[current_stage].rate;

        // 目標値への接近処理（オーバーフロー/アンダーフロー保護付）
        if (current_level < target) {
            current_level += step;
            if (current_level > target || current_level < step) current_level = target;
        } else if (current_level > target) {
            current_level = (current_level > step) ? (current_level - step) : 0;
            if (current_level < target) current_level = target;
        }

        // ステージ遷移チェック
        if (current_level == target) {
            if (is_key_on && current_stage == sustain_point) {
                return current_level >> 16;
            }
            current_stage++;
        }
        return current_level >> 16;
    }
};

// ==========================================
// 2. LFO for Vibrato
// ==========================================
class LFO {
private:
    uint32_t phase = 0;
    uint32_t phase_inc = 0;
    uint16_t delay_counter = 0;
    bool is_active = false;

public:
    LfoWaveform waveform = LfoWaveform::TRIANGLE;
    uint16_t rate = 0;        
    uint16_t depth = 0;       
    uint16_t delay = 0;       
    uint16_t delay_samples = 0; 

    void setSampleRate(uint32_t sr) {
        float freq = 0.1f + (static_cast<float>(rate) / 99.0f) * 19.9f;
        phase_inc = static_cast<uint32_t>((freq * 4294967296.0f) / sr);
        delay_samples = (static_cast<uint32_t>(delay) * sr) / 100; 
    }

    void trigger() {
        phase = 0;
        delay_counter = 0;
        is_active = true;
    }
    void release() { is_active = false; }

    inline int32_t nextSample() {
        if (!is_active) return 0;
        if (delay_counter < delay_samples) {
            delay_counter++;
            return 0;
        }

        phase += phase_inc;
        uint16_t phase_16 = phase >> 16;
        int32_t output = 0;

        switch (waveform) {
            case LfoWaveform::TRIANGLE:
                if (phase_16 < 32768) output = (phase_16 << 1) - 32768; 
                else output = 65535 - (phase_16 << 1); 
                break;
            case LfoWaveform::SQUARE:
                output = (phase_16 < 32768) ? 32767 : -32768;
                break;
            case LfoWaveform::SAW_UP:
                output = static_cast<int32_t>(phase_16) - 32768;
                break;
            case LfoWaveform::SAW_DOWN:
                output = 32767 - static_cast<int32_t>(phase_16);
                break;
        }
        return (output * depth) / 99;
    }
};

// ==========================================
// 3. Waveform tables 
// ==========================================
struct Tables {
    const int16_t* sin_lut;
    uint16_t lut_size;
};

// ==========================================
// 4. CZ-style Oscillator Core with 3 independent EGs
// ==========================================
class Oscillator {
private:
    uint32_t phase = 0;  
    uint8_t eg_divider = 0;  
    uint16_t cached_dco = 0;  
    uint16_t cached_dcw = 0;  
    uint16_t cached_dca = 0;  
    bool wave_cycle_toggle = false;
public:
    uint32_t base_phase_inc = 0;  
    uint32_t phase_inc = 0;  

    Waveform wave1 = Waveform::REZ_SAW;  
    Waveform wave2 = Waveform::REZ_SAW;  

    Envelope dco_eg;  
    Envelope dcw_eg;  
    Envelope dca_eg;  

    void resetForNoteOn() {
        eg_divider = 31;  
        cached_dco = 0;
        cached_dcw = 0;
        cached_dca = 0;
        wave_cycle_toggle = false;
    }

    inline int32_t nextSample(const Tables& tables) {
        if (++eg_divider >= 32) {
            eg_divider = 0;
            cached_dco = dco_eg.update();
            cached_dcw = dcw_eg.update();
            cached_dca = dca_eg.update();
        }

        uint32_t previous_phase = phase;
        phase += phase_inc;
        if (phase < previous_phase) wave_cycle_toggle = !wave_cycle_toggle;

        uint16_t dcw = cached_dcw;
        uint16_t dca = cached_dca;

        uint16_t phase_16 = phase >> 16;
        int32_t raw_sample = 0;
        uint8_t shift_bits = 16 - (32 - __builtin_clz(tables.lut_size - 1));

        uint16_t local_phase = phase_16;
        Waveform current_wave = wave1;

        if (wave2 != Waveform(0) && wave2 != wave1) {
            current_wave = wave_cycle_toggle ? wave2 : wave1;
        }

        uint32_t pd_phase = local_phase;

        switch (current_wave) {
            case Waveform::SAW: {
                // dcw=0 で対称(32768), dcw=65535 で最大非対称(65535) へ折れ曲がり点を推し進める
                uint32_t xp_saw = 32768 + ((static_cast<uint32_t>(dcw) * 32767) >> 16);
                if (local_phase < xp_saw) {
                    pd_phase = (static_cast<uint32_t>(local_phase) * 32768) / xp_saw;
                } else {
                    uint32_t denom = 65535 - xp_saw;
                    if (denom == 0) denom = 1;
                    pd_phase = 32768 + ((static_cast<uint32_t>(local_phase) - xp_saw) * 32767) / denom;
                }
                raw_sample = static_cast<int32_t>(tables.sin_lut[pd_phase >> shift_bits]) + 32768;
                break;
            }
            case Waveform::SQUARE: {
                // 前半パルス幅をdcwで削る。オーバーフロー防止のため 31120/65536 で安全にスケーリング
                uint32_t xp_sq = 32768 - ((static_cast<uint32_t>(dcw) * 31120) >> 16);
                if (local_phase < xp_sq) {
                    pd_phase = (static_cast<uint32_t>(local_phase) * 32768) / xp_sq;
                } else if (local_phase < 32768) {
                    pd_phase = 32768;
                } else if (local_phase < 32768 + xp_sq) {
                    pd_phase = 32768 + ((static_cast<uint32_t>(local_phase) - 32768) * 32767) / xp_sq;
                } else {
                    pd_phase = 65535;
                }
                raw_sample = static_cast<int32_t>(tables.sin_lut[pd_phase >> shift_bits]) + 32768;
                break;
            }
            case Waveform::PULSE: {
                // 安全な固定数乗算スケーリングにより、JSで起きていたビットオーバーフローを根絶
                uint32_t xp_pulse = 65535 - ((static_cast<uint32_t>(dcw) * 63487) >> 16);
                if (local_phase < xp_pulse) {
                    pd_phase = (static_cast<uint32_t>(local_phase) * 65535) / xp_pulse;
                } else {
                    pd_phase = 65535;
                }
                raw_sample = static_cast<int32_t>(tables.sin_lut[pd_phase >> shift_bits]) + 32768;
                break;
            }
            case Waveform::DOUBLE_SINE: {
                uint32_t xp_dsin = 65535 - ((static_cast<uint32_t>(dcw) * 49151) >> 16);
                if (local_phase < xp_dsin) {
                    pd_phase = (static_cast<uint32_t>(local_phase) * 65535) / xp_dsin;
                } else {
                    uint32_t denom = 65535 - xp_dsin;
                    if (denom == 0) denom = 1;
                    pd_phase = ((static_cast<uint32_t>(local_phase) - xp_dsin) * 65535) / denom;
                }
                raw_sample = static_cast<int32_t>(tables.sin_lut[pd_phase >> shift_bits]) + 32768;
                break;
            }
            case Waveform::SAW_PULSE: {

                // 1. 活性区間の圧縮限界を最大50% (32768) に設定。dcw=65535のとき xp_sp = 32768
                uint32_t xp_sp = 65535 - ((static_cast<uint32_t>(dcw) * 32767) >> 16);

                // 2. 活性区間内におけるピーク（山の頂点）の位置。dcwが上がるほど右寄り(非対称)にする
                // t_peak を 65536 スケールで計算 (dcw=0で0.5倍(32768), dcw=65535で0.95倍(62259))
                uint32_t t_peak_16 = 32768 + ((static_cast<uint32_t>(dcw) * 29491) >> 16);
                // 活性区間内の絶対座標に変換
                uint32_t peak_pos = (static_cast<uint64_t>(xp_sp) * t_peak_16) >> 16;
                if (peak_pos == 0) peak_pos = 1;

                if (local_phase < xp_sp) {
                    if (local_phase < peak_pos) {
                        // A. なだらかな立ち上がり区間: 位相は最下点(0)から最上点(32768)へ
                        pd_phase = (static_cast<uint32_t>(local_phase) * 32768) / peak_pos;
                    } else {
                        // B. 急峻な立ち下がり（崖）区間: 最上点(32768)から最下点(65535)へ急降下
                        uint32_t denom = xp_sp - peak_pos;
                        if (denom == 0) denom = 1;
                        pd_phase = 32768 + ((static_cast<uint32_t>(local_phase - peak_pos) * 32767) / denom);
                    }
                } else {
                    // C. 後半のフラット区間: 逆コサインテーブルの最下点(65535)に固定
                    pd_phase = 65535;
                }

                raw_sample = static_cast<int32_t>(tables.sin_lut[pd_phase >> shift_bits]) + 32768;
                break;
            }
            case Waveform::REZ_SAW: {
                uint32_t res_phase_32 = static_cast<uint32_t>(local_phase)
                    + ((static_cast<uint64_t>(local_phase) * dcw * 15) >> 16);
                uint16_t res_phase = static_cast<uint16_t>(res_phase_32 & 0xFFFF);
                int32_t core_bipolar = static_cast<int32_t>(tables.sin_lut[res_phase >> shift_bits]);
                uint32_t window = 65535 - local_phase;
                raw_sample = ((core_bipolar * static_cast<int32_t>(window)) >> 16) + 32768;
                break;
            }
            case Waveform::REZ_TRI: {
                uint32_t res_phase_32 = static_cast<uint32_t>(local_phase)
                    + ((static_cast<uint64_t>(local_phase) * dcw * 15) >> 16);
                uint16_t res_phase = static_cast<uint16_t>(res_phase_32 & 0xFFFF);
                int32_t core_bipolar = static_cast<int32_t>(tables.sin_lut[res_phase >> shift_bits]);
                uint32_t window = (local_phase < 32768) ? (local_phase << 1) : ((65535 - local_phase) << 1);
                raw_sample = ((core_bipolar * static_cast<int32_t>(window)) >> 16) + 32768;
                break;
            }
            case Waveform::REZ_TRAP: {
                uint32_t res_phase_32 = static_cast<uint32_t>(local_phase)
                    + ((static_cast<uint64_t>(local_phase) * dcw * 15) >> 16);
                uint16_t res_phase = static_cast<uint16_t>(res_phase_32 & 0xFFFF);
                int32_t core_bipolar = static_cast<int32_t>(tables.sin_lut[res_phase >> shift_bits]);
                uint32_t window;
                if (local_phase < 16384) window = local_phase << 2;
                else if (local_phase > 49152) window = (65535 - local_phase) << 2;
                else window = 65535;
                raw_sample = ((core_bipolar * static_cast<int32_t>(window)) >> 16) + 32768;
                break;
            }
        }
        
        int32_t sample = (raw_sample * dca) >> 16;
        return sample - (static_cast<int32_t>(dca) >> 1);
    }
};

// ==========================================
// 5. Voice container with Ring Modulation
// ==========================================
class Voice {
public:
    Oscillator line1;
    Oscillator line2;
    uint32_t sample_rate = 44100;
    uint8_t current_note = 0;
    bool is_active = false;
    uint32_t current_line1_base_phase_inc = 0;
    uint32_t current_line2_base_phase_inc = 0;
    uint32_t target_line1_base_phase_inc = 0;
    uint32_t target_line2_base_phase_inc = 0;

    uint32_t samples_since_note_off = 0;
    static const uint32_t NOTE_OFF_TIMEOUT = 44100 * 2;  

    uint8_t line1_wave1 = 6;  
    uint8_t line1_wave2 = 0;  
    uint8_t line2_wave1 = 6;  
    uint8_t line2_wave2 = 0;  

    // ROUTING detune (PARAMETERS.md 準拠: 0-based)
    uint8_t detune_octave = 0;     // 0-3
    uint8_t detune_note = 0;       // 0-11
    uint8_t detune_fine = 0;       // 0-60
    int8_t detune_sign = 1;        // -1 or 1

    uint8_t dcw_key_follow = 0;    // 0-99 (PARAMETERS.md 準拠)
    uint8_t dca_key_follow = 0;    // 0-99    

    bool noise_modulation = false;  
    uint32_t noise_phase = 0;       

    void init(uint32_t sr) { sample_rate = sr; }

    float getDetuneFactor() const {
        float oct_val = static_cast<float>(detune_octave);
        float note_val = static_cast<float>(detune_note);
        float fine_val = static_cast<float>(detune_fine);
        float sign_val = static_cast<float>(detune_sign);

        float octave_factor = __builtin_powf(2.0f, sign_val * oct_val);
        float note_factor = __builtin_powf(2.0f, sign_val * note_val / 12.0f);
        float fine_factor = __builtin_powf(2.0f, sign_val * fine_val / (12.0f * 60.0f));
        return octave_factor * note_factor * fine_factor;
    }

    void noteOn(uint8_t note, uint32_t p_inc, bool portamento_enabled = false, uint32_t previous_line1_phase_inc = 0) {
        current_note = note;
        is_active = true;
        target_line1_base_phase_inc = p_inc;
        target_line2_base_phase_inc = static_cast<uint32_t>(p_inc * getDetuneFactor());

        if (portamento_enabled && previous_line1_phase_inc > 0) {
            current_line1_base_phase_inc = previous_line1_phase_inc;
            current_line2_base_phase_inc = static_cast<uint32_t>(previous_line1_phase_inc * getDetuneFactor());
        } else {
            current_line1_base_phase_inc = target_line1_base_phase_inc;
            current_line2_base_phase_inc = target_line2_base_phase_inc;
        }

        line1.base_phase_inc = current_line1_base_phase_inc;
        line2.base_phase_inc = current_line2_base_phase_inc;
    }

    void noteOff() {
        line1.dcw_eg.keyOff(); line1.dca_eg.keyOff();
        line2.dcw_eg.keyOff(); line2.dca_eg.keyOff();
        samples_since_note_off = 0;  
    }

    inline bool shouldRelease() {
        if (!is_active) return false;
        if (!line1.dca_eg.is_key_on && !line2.dca_eg.is_key_on) {
            samples_since_note_off++;
            uint32_t dca1_level = line1.dca_eg.current_level;
            uint32_t dca2_level = line2.dca_eg.current_level;
            if (dca1_level < 100 && dca2_level < 100) return true;
            if (samples_since_note_off > NOTE_OFF_TIMEOUT) return true;
        } else {
            samples_since_note_off = 0;
        }
        return false;
    }

    inline int32_t process(const Tables& tables, bool ring_modulation = false) {
        if (!is_active) return 0;
        int32_t s1 = line1.nextSample(tables);
        int32_t s2 = line2.nextSample(tables);

        if (noise_modulation) {
            noise_phase = noise_phase * 1103515245 + 12345;  
            int32_t noise = (noise_phase >> 16) & 0xFFFF;
            s1 = (s1 * 9 + noise) / 10;
            s2 = (s2 * 9 + noise) / 10;
        }

        if (ring_modulation) {
            int32_t ring = (s1 * s2) >> 16;
            return ring;
        } else {
            return (s1 + s2) >> 1;
        }
    }
};

// ==========================================
// 6. [Core] Template-driven engine class
// ==========================================
template <uint8_t MaxVoices = 8>
class Engine {
private:
    Voice voices[MaxVoices];
    Tables tables;
    uint32_t sample_rate = 44100;
    Waveform current_waveform = Waveform::REZ_SAW;  

    LFO vibrato_lfo;
    LineSelectMode line_select = LineSelectMode::LINE1_2;
    bool ring_modulation = false;
    bool noise_modulation = false;
    int32_t master_dc_offset = 0;

    // MASTER section (PARAMETERS.md)
    uint8_t master_octave = 1;         // 0-2 (1=center)
    uint8_t master_note = 0;           // 0-11
    uint8_t master_fine = 30;          // 0-60 (30=center)
    uint8_t master_pan = 50;           // 0-99 (50=center)
    uint8_t master_drive = 0;          // 0-99
    uint8_t master_volume = 80;        // 0-99
    bool portamento_enabled = false;
    uint8_t portamento_time = 0;       // 0-99
    uint8_t pitch_bend_up_semitones = 2;
    uint8_t pitch_bend_down_semitones = 2;
    int16_t pitch_bend_value = 0;      // -8192 to +8191
    uint32_t last_note_phase_inc = 0;

    // Preset system
    uint8_t current_preset_index = 0;  // 0-15 (PARAMETERS.md: 1-16)
    char preset_name[21] = "Default";
    char preset_category[21] = "User";
    bool dark_mode = true;

public:
    void setup(const int16_t* sin_lut, uint16_t lut_size, uint32_t sr) {
        tables.sin_lut = sin_lut;
        tables.lut_size = lut_size;
        sample_rate = sr;
        for (auto& v : voices) {
            v.init(sr);
            v.line1.dco_eg.initCz101Defaults();
            v.line1.dcw_eg.initCz101Defaults();
            v.line1.dca_eg.initCz101Defaults();
            v.line2.dco_eg.initCz101Defaults();
            v.line2.dcw_eg.initCz101Defaults();
            v.line2.dca_eg.initCz101Defaults();
        }
        vibrato_lfo.setSampleRate(sr);
    }

    void setSampleRate(uint32_t sr) {
        sample_rate = sr;
        for (auto& v : voices) v.sample_rate = sr;
        vibrato_lfo.setSampleRate(sr);  
    }

    uint32_t convertCzRateToInternal(uint8_t cz_rate, int eg_type) const {
        static const uint8_t rate_points[5] = {0, 25, 50, 75, 99};
        static const double dco_seconds[5] = {235.0, 14.0, 0.921, 0.054, 0.004};
        static const double dca_dcw_seconds[5] = {104.0, 7.0, 0.544, 0.038, 0.004};

        const double* seconds_points = (eg_type == 0) ? dco_seconds : dca_dcw_seconds;
        int segment = 3;
        for (int i = 0; i < 4; i++) {
            if (cz_rate <= rate_points[i + 1]) {
                segment = i;
                break;
            }
        }

        double r0 = static_cast<double>(rate_points[segment]);
        double r1 = static_cast<double>(rate_points[segment + 1]);
        double t = (static_cast<double>(cz_rate) - r0) / (r1 - r0);
        double log_seconds = __builtin_log(seconds_points[segment])
            + t * (__builtin_log(seconds_points[segment + 1]) - __builtin_log(seconds_points[segment]));
        double seconds = __builtin_exp(log_seconds);

        double updates = (static_cast<double>(sample_rate) / 32.0) * seconds;
        if (updates < 1.0) updates = 1.0;

        double step_per_update = 4294901760.0 / updates;
        if (step_per_update < 1.0) return 1;
        if (step_per_update > 4294967295.0) return 0xFFFFFFFF;
        return static_cast<uint32_t>(step_per_update);
    }

void setEgRate(int line, int eg_type, int stage, uint8_t value) {
    if (stage < 0 || stage > 7) return;
    
    // 定義に合わせて名前を修正
    uint32_t internal_rate = convertCzRateToInternal(value, eg_type);
    
    for (auto& v : voices) {
        Oscillator& osc = (line == 1) ? v.line1 : v.line2;
        if (eg_type == 0) osc.dco_eg.stages[stage].rate = internal_rate;
        else if (eg_type == 1) osc.dcw_eg.stages[stage].rate = internal_rate;
        else if (eg_type == 2) osc.dca_eg.stages[stage].rate = internal_rate;
    }
}

    void setEgLevel(int line, int eg_type, int stage, uint8_t value) {
        if (stage < 0 || stage > 7) return;
        uint16_t internal_level = (value * 65535) / 99; // 0-99 to 0-65535
        for (auto& v : voices) {
            Oscillator& osc = (line == 1) ? v.line1 : v.line2;
            Envelope* eg = nullptr;
            if (eg_type == 0) eg = &osc.dco_eg;
            else if (eg_type == 1) eg = &osc.dcw_eg;
            else if (eg_type == 2) eg = &osc.dca_eg;
            if (!eg) continue;

            eg->stages[stage].level = internal_level;
        }
    }

    void setEgSustainPoint(int line, int eg_type, uint8_t point) {
        for (auto& v : voices) {
            Oscillator& osc = (line == 1) ? v.line1 : v.line2;
            if (eg_type == 0) osc.dco_eg.sustain_point = point;
            else if (eg_type == 1) osc.dcw_eg.sustain_point = point;
            else if (eg_type == 2) osc.dca_eg.sustain_point = point;
        }
    }

    void setEgEndPoint(int line, int eg_type, uint8_t point) {
        for (auto& v : voices) {
            Oscillator& osc = (line == 1) ? v.line1 : v.line2;
            Envelope* eg = nullptr;
            if (eg_type == 0) eg = &osc.dco_eg;
            else if (eg_type == 1) eg = &osc.dcw_eg;
            else if (eg_type == 2) eg = &osc.dca_eg;
            if (!eg || point > 7) continue;

            eg->end_point = point;
        }
    }

    // 古い個別セッター（後方互換用、タイポ修正済み）
  void setDcaEgDecay2(uint8_t value) {
    for (auto& v : voices) {
        // DCAなので eg_type に「2」を指定して呼び出す
        v.line1.dca_eg.stages[2].rate = convertCzRateToInternal(value, 2);
        v.line2.dca_eg.stages[2].rate = v.line1.dca_eg.stages[2].rate;
    }
}

    // ==========================================
    // その他のセッター群
    // ==========================================
    void setWaveform(Waveform wave) { current_waveform = wave; }
    void setLine1Wave1(uint8_t wave) { for (auto& v : voices) v.line1_wave1 = wave; }
    void setLine1Wave2(uint8_t wave) { for (auto& v : voices) v.line1_wave2 = wave; }
    void setLine2Wave1(uint8_t wave) { for (auto& v : voices) v.line2_wave1 = wave; }
    void setLine2Wave2(uint8_t wave) { for (auto& v : voices) v.line2_wave2 = wave; }
    void setWave1(uint8_t wave) { setLine1Wave1(wave); setLine2Wave1(wave); }
    void setWave2(uint8_t wave) { setLine1Wave2(wave); setLine2Wave2(wave); }

    void setLineSelect(LineSelectMode mode) { line_select = mode; }
    void setRingModulation(bool enable) { ring_modulation = enable; }
    void setNoiseModulation(bool enable) {
        noise_modulation = enable;
        for (auto& v : voices) v.noise_modulation = enable;
    }

    void setVibratoWaveform(LfoWaveform waveform) { vibrato_lfo.waveform = waveform; }
    void setVibratoDelay(uint16_t delay) { vibrato_lfo.delay = delay; vibrato_lfo.setSampleRate(sample_rate); }
    void setVibratoRate(uint16_t rate) { vibrato_lfo.rate = rate; vibrato_lfo.setSampleRate(sample_rate); }
    void setVibratoDepth(uint16_t depth) { vibrato_lfo.depth = depth; }

    void setDetuneOctave(uint8_t octave) { for (auto& v : voices) v.detune_octave = octave; }
    void setDetuneNote(uint8_t note) { for (auto& v : voices) v.detune_note = note; }
    void setDetuneFine(uint8_t fine) { for (auto& v : voices) v.detune_fine = fine; }
    void setDetuneSign(int8_t sign) { for (auto& v : voices) v.detune_sign = sign; }

    void setDCWKeyFollow(uint8_t amount) { for (auto& v : voices) v.dcw_key_follow = amount; }
    void setDCAKeyFollow(uint8_t amount) { for (auto& v : voices) v.dca_key_follow = amount; }

    // ─── MASTER section ───
    void setMasterOctave(uint8_t oct) { master_octave = oct; }
    void setMasterNote(uint8_t note) { master_note = note; }
    void setMasterFine(uint8_t fine) { master_fine = fine; }
    void setMasterPan(uint8_t pan) { master_pan = pan; }
    void setMasterDrive(uint8_t drive) { master_drive = drive; }
    void setMasterVolume(uint8_t vol) { master_volume = vol; }
    void setPortamentoEnabled(bool enabled) { portamento_enabled = enabled; }
    void setPortamentoTime(uint8_t time) { portamento_time = time; }
    void setPitchBendRangeUp(uint8_t semitones) { pitch_bend_up_semitones = semitones; }
    void setPitchBendRangeDown(uint8_t semitones) { pitch_bend_down_semitones = semitones; }
    void setPitchBend(int16_t value) {
        if (value < -8192) value = -8192;
        if (value > 8191) value = 8191;
        pitch_bend_value = value;
    }

    // ─── Preset system ───
    void setPresetIndex(uint8_t idx) { if (idx < 16) current_preset_index = idx; }
    uint8_t getPresetIndex() const { return current_preset_index; }
    const char* getPresetName() const { return preset_name; }
    const char* getPresetCategory() const { return preset_category; }
    void setPresetName(const char* name) {
        for (int i = 0; i < 20 && name[i]; i++) preset_name[i] = name[i];
        preset_name[20] = '\0';
    }
    void setPresetCategory(const char* cat) {
        for (int i = 0; i < 20 && cat[i]; i++) preset_category[i] = cat[i];
        preset_category[20] = '\0';
    }
    void setDarkMode(bool on) { dark_mode = on; }
    bool getDarkMode() const { return dark_mode; }

    // Debug getters
    int getActiveVoiceCount() const {
        int count = 0;
        for (auto& v : voices) if (v.is_active) count++;
        return count;
    }
    uint16_t getDcaLevel(int voiceIdx) const {
        if (voiceIdx < 0 || voiceIdx >= MaxVoices) return 0;
        return voices[voiceIdx].line1.dca_eg.current_level >> 16;
    }
    uint8_t getDcaEndPoint() const {
        return voices[0].line1.dca_eg.end_point;
    }
    uint8_t getDcaSustainPoint() const {
        return voices[0].line1.dca_eg.sustain_point;
    }
    uint32_t getDcaRate(int stage) const {
        return voices[0].line1.dca_eg.stages[stage].rate;
    }
    uint16_t getDcaLevelStage(int stage) const {
        return voices[0].line1.dca_eg.stages[stage].level;
    }

    void midiNoteOn(uint8_t note) {
        bool any_active = false;
        for (auto& v : voices) {
            if (v.is_active) {
                any_active = true;
                break;
            }
        }
        if (!any_active) vibrato_lfo.trigger();

        // MASTER transposition
        int master_semitones = (static_cast<int>(master_octave) - 1) * 12 + static_cast<int>(master_note);
        float master_cents = (static_cast<int>(master_fine) - 30);
        float master_factor = __builtin_powf(2.0f, (master_semitones + master_cents / 100.0f) / 12.0f);

        for (auto& v : voices) {
            if (!v.is_active) {
                float freq = 440.0f * __builtin_powf(2.0f, (note - 69) / 12.0f) * master_factor;
                uint32_t p_inc = static_cast<uint32_t>((freq * 4294967296.0f) / sample_rate);  

                float kf_factor = (static_cast<int16_t>(note) - 60) / 48.0f;

                uint32_t base_dca_rate = 15;  
                if (v.dca_key_follow > 0) {
                    base_dca_rate = static_cast<uint32_t>(base_dca_rate * (1.0f + kf_factor * (static_cast<float>(v.dca_key_follow) / 99.0f)));
                }

                uint16_t base_dcw_level = 32767;
                if (v.dcw_key_follow > 0) {
                    float reduction = 1.0f - (kf_factor * (static_cast<float>(v.dcw_key_follow) / 99.0f) * 0.5f);
                    if (reduction > 1.0f) reduction = 1.0f;
                    if (reduction < 0.0f) reduction = 0.0f;
                    base_dcw_level = static_cast<uint16_t>(base_dcw_level * reduction);
                }

                v.line1.wave1 = v.line1_wave1 != 0 ? (CrispyZebra::Waveform)v.line1_wave1 : current_waveform;
                v.line1.wave2 = v.line1_wave2 != 0 ? (CrispyZebra::Waveform)v.line1_wave2 : v.line1.wave1;
                v.line2.wave1 = v.line2_wave1 != 0 ? (CrispyZebra::Waveform)v.line2_wave1 : current_waveform;
                v.line2.wave2 = v.line2_wave2 != 0 ? (CrispyZebra::Waveform)v.line2_wave2 : v.line2.wave1;

                v.noteOn(note, p_inc, portamento_enabled && any_active, last_note_phase_inc);
                last_note_phase_inc = p_inc;

                v.line1.dco_eg.keyOn();
                v.line1.dcw_eg.keyOn();
                v.line1.dca_eg.keyOn();
                v.line2.dco_eg.keyOn();
                v.line2.dcw_eg.keyOn();
                v.line2.dca_eg.keyOn();

                v.line1.resetForNoteOn();
                v.line2.resetForNoteOn();
                break;
            }
        }
    }

    void midiNoteOff(uint8_t note) {
        for (auto& v : voices) {
            if (v.is_active && v.current_note == note) v.noteOff();
        }
        bool any_active = false;
        for (auto& v : voices) {
            if (v.is_active) {
                any_active = true;
                break;
            }
        }
        if (!any_active) vibrato_lfo.release();
    }

    template <typename SampleType, bool Stereo = true>
    void processBlock(SampleType* outputBuffer, uint32_t numSamples) {
        for (uint32_t i = 0; i < numSamples; i++) {
            int32_t lfo_mod = vibrato_lfo.nextSample();
            int32_t mix = 0;
            float bend_norm = pitch_bend_value >= 0
                ? static_cast<float>(pitch_bend_value) / 8191.0f
                : static_cast<float>(pitch_bend_value) / 8192.0f;
            float bend_semitones = bend_norm >= 0
                ? bend_norm * static_cast<float>(pitch_bend_up_semitones)
                : bend_norm * static_cast<float>(pitch_bend_down_semitones);
            float pitch_bend_factor = __builtin_powf(2.0f, bend_semitones / 12.0f);

            for (auto& v : voices) {
                if (!v.is_active) continue;

                if (portamento_enabled && portamento_time > 0) {
                    uint32_t glide = 1 + static_cast<uint32_t>(portamento_time) * 16;
                    int64_t diff1 = static_cast<int64_t>(v.target_line1_base_phase_inc) - v.current_line1_base_phase_inc;
                    int64_t diff2 = static_cast<int64_t>(v.target_line2_base_phase_inc) - v.current_line2_base_phase_inc;
                    v.current_line1_base_phase_inc += static_cast<int32_t>(diff1 / glide);
                    v.current_line2_base_phase_inc += static_cast<int32_t>(diff2 / glide);
                    if (diff1 > -2 && diff1 < 2) v.current_line1_base_phase_inc = v.target_line1_base_phase_inc;
                    if (diff2 > -2 && diff2 < 2) v.current_line2_base_phase_inc = v.target_line2_base_phase_inc;
                } else {
                    v.current_line1_base_phase_inc = v.target_line1_base_phase_inc;
                    v.current_line2_base_phase_inc = v.target_line2_base_phase_inc;
                }

                v.line1.base_phase_inc = v.current_line1_base_phase_inc;
                v.line2.base_phase_inc = v.current_line2_base_phase_inc;

                uint32_t line1_phase_inc = static_cast<uint32_t>(v.line1.base_phase_inc * pitch_bend_factor);
                uint32_t line2_phase_inc = static_cast<uint32_t>(v.line2.base_phase_inc * pitch_bend_factor);

                uint32_t dco_mod1 = (line1_phase_inc * (v.line1.dco_eg.current_level >> 16)) >> 16;
                uint32_t dco_mod2 = (line2_phase_inc * (v.line2.dco_eg.current_level >> 16)) >> 16;
                line1_phase_inc += dco_mod1;
                line2_phase_inc += dco_mod2;

                if (vibrato_lfo.depth > 0) {
                    int32_t lfo_range1 = v.line1.base_phase_inc >> 4;
                    int32_t lfo_pitch_mod1 = (static_cast<int64_t>(lfo_mod) * lfo_range1) >> 15;
                    line1_phase_inc += lfo_pitch_mod1;

                    int32_t lfo_range2 = v.line2.base_phase_inc >> 4;
                    int32_t lfo_pitch_mod2 = (static_cast<int64_t>(lfo_mod) * lfo_range2) >> 15;
                    line2_phase_inc += lfo_pitch_mod2;
                }

                v.line1.phase_inc = line1_phase_inc;
                v.line2.phase_inc = line2_phase_inc;

                mix += v.process(tables, ring_modulation);
            }

            master_dc_offset += (mix - master_dc_offset) / 512;
            mix = mix - master_dc_offset;

            mix = mix >> 1;  
            if (mix > 24576) {
                int32_t excess = mix - 24576;
                mix = 24576 + ((excess * 8192) / (8192 + excess));
            } else if (mix < -24576) {
                int32_t excess = -mix - 24576;
                mix = -24576 - ((excess * 8192) / (8192 + excess));
            }
            if (mix > 32767) mix = 32767;
            else if (mix < -32768) mix = -32768;

            // MASTER drive (soft distortion)
            if (master_drive > 0) {
                float drive_amount = 1.0f + static_cast<float>(master_drive) / 99.0f * 4.0f;
                float f = static_cast<float>(mix) / 32768.0f;
                f = f * drive_amount;
                f = (f > 1.0f) ? 1.0f : (f < -1.0f) ? -1.0f : f;
                mix = static_cast<int32_t>(f * 32768.0f);
            }

            // MASTER volume
            float vol = static_cast<float>(master_volume) / 99.0f;
            mix = static_cast<int32_t>(mix * vol);

            SampleType out_val;
            if (sizeof(SampleType) == sizeof(float)) {
                out_val = static_cast<float>(mix) / 32768.0f; 
            } else {
                out_val = static_cast<SampleType>(mix);       
            }

            if (Stereo) {
                // MASTER pan: 0=full left, 50=center, 99=full right
                float pan = static_cast<float>(master_pan) / 99.0f;
                float pan_left = (pan <= 0.5f) ? 1.0f : 1.0f - (pan - 0.5f) * 2.0f;
                float pan_right = (pan >= 0.5f) ? 1.0f : pan * 2.0f;
                outputBuffer[i * 2] = static_cast<SampleType>(static_cast<float>(out_val) * pan_left);
                outputBuffer[i * 2 + 1] = static_cast<SampleType>(static_cast<float>(out_val) * pan_right);
            } else {
                outputBuffer[i] = out_val;
            }
        }

        for (auto& v : voices) {
            if (v.shouldRelease()) v.is_active = false;
        }
    }
};

} // namespace CrispyZebra
