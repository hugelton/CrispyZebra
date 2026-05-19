const EXP = {
  init_engine: "f", setup_engine: "g", generate_sin_lut: "h",
  midi_note_on: "i", midi_note_off: "j",
  process_audio_variable: "k", process_audio: "l",
  get_audio_buffer: "m", get_audio_buffer_size: "n", copy_audio_buffer: "o",
  set_waveform: "p", set_line_select: "q",
  set_ring_modulation: "r", set_noise_modulation: "s",
  set_vibrato_waveform: "t", set_vibrato_rate: "u",
  set_vibrato_depth: "v", set_vibrato_delay: "w",
  set_detune_octave: "x", set_detune_note: "y", set_detune_fine: "z",
  set_detune_sign: "A",
  set_master_octave: "B", set_master_note: "C",
  set_master_fine: "D", set_master_pan: "E",
  set_master_drive: "F", set_master_volume: "G",
  set_portamento_enabled: "H", set_portamento_time: "I",
  set_pitch_bend_range_up: "J", set_pitch_bend_range_down: "K",
  set_pitch_bend: "L",
  set_preset_index: "M", get_preset_index: "N",
  get_preset_name: "O", get_preset_category: "P",
  set_dark_mode: "Q", get_dark_mode: "R",
  set_dcw_key_follow: "S", set_dca_key_follow: "T",
  set_line1_wave1: "U", set_line1_wave2: "V",
  set_line2_wave1: "W", set_line2_wave2: "X",
  set_eg_rate: "Y", set_eg_level: "Z",
  set_eg_sustain_point: "_", set_eg_end_point: "$",
  set_dco_eg_attack: "aa", set_dco_eg_decay1: "ba",
  set_dco_eg_decay2: "ca", set_dco_eg_release: "da",
  set_dcw_eg_attack: "ea",
  set_dcw_eg_decay1: "fa", set_dcw_eg_decay2: "ga",
  set_dcw_eg_release: "ha",
  set_dca_eg_attack: "ia", set_dca_eg_decay1: "ja",
  set_dca_eg_decay2: "ka", set_dca_eg_release: "la",
  debug_envelope_state: "ma", debug_active_voices: "na",
  debug_dca_level: "oa", debug_dca_end_point: "pa",
  debug_dca_sustain_point: "qa", debug_dca_rate: "ra",
  debug_dca_level_stage: "sa"
};

class CrispyZebraProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.fn = {};
    this.mem = null;
    this.ready = false;
    this.wasmBytes = null;
    this.sampleRate = 44100;
    this._dbg = 0;
    this.port.onmessage = (e) => this._onMsg(e);
  }

  async _initWasm(buf, sr, readyType = 'ready', requestId = null) {
    try {
      this.ready = false;
      this.mem = null;
      this.sampleRate = sr;
      this.wasmBytes = buf.slice(0);
      console.log('[Processor] _initWasm starting, sr:', sr);
      let wasmMem = null;
      const fdWrite = (_fd, iov, iovcnt, pnum) => {
        if (!wasmMem) return 0;
        const view = new DataView(wasmMem.buffer);
        let written = 0;
        for (let i = 0; i < iovcnt; i++) {
          written += view.getUint32(iov + i * 8 + 4, true);
        }
        view.setUint32(pnum, written, true);
        return 0;
      };
      const ex = { a: {
        a: fdWrite,
        b: () => {},
        c: (sz) => {
          if (!wasmMem) return 0;
          const cur = wasmMem.buffer.byteLength;
          const need = Math.ceil((sz - cur) / 65536);
          if (need > 0) wasmMem.grow(need);
          return 1;
        }
      }};
      const r = await WebAssembly.instantiate(buf, ex);
      wasmMem = r.instance.exports.d;
      this.mem = wasmMem;
      const raw = r.instance.exports;
      for (const [name, mangle] of Object.entries(EXP)) {
        this.fn['_' + name] = raw[mangle];
      }
      console.log('[Processor] WASM instantiated, calling init_engine...');
      this.fn._init_engine();
      const lut = this.fn._generate_sin_lut(1024);
      console.log('[Processor] lut ptr:', lut);
      this.fn._setup_engine(lut, 1024, sr);
      const bufPtr = this.fn._get_audio_buffer();
      const bufSize = this.fn._get_audio_buffer_size();
      console.log('[Processor] audio buf ptr:', bufPtr, 'size:', bufSize);
      this.port.postMessage({t:'sr', s: sr});
      this.ready = true;
      console.log('[Processor] ready=true');
      this.port.postMessage({ type: readyType, requestId });
    } catch (e) {
      console.error('[Processor] _initWasm error:', e);
      this.port.postMessage({ type: 'error', msg: 'initWasm: ' + e.message, requestId });
    }
  }

  _call(f, ...a) {
    if (!this.ready) { console.log('[Processor] _call not ready:', f); return; }
    const fn = this.fn['_' + f];
    if (fn) { fn(...a); } else { console.log('[Processor] _call fn not found:', f); }
  }

  _onMsg(e) {
    const m = e.data;
    console.log('[Processor] msg:', m.type, m.f ? m.f : '', m.a ? m.a : '');
    switch (m.type) {
      case 'wasm': this._initWasm(m.buf, m.sr); break;
      case 'reset':
        if (this.wasmBytes) this._initWasm(this.wasmBytes.slice(0), this.sampleRate, 'resetReady', m.requestId);
        break;
      case 'nOn':
        console.log('[Processor] noteOn:', m.n);
        this.port.postMessage({t:'nOn', n: m.n});
        this._call('midi_note_on', m.n);
        break;
      case 'nOff': this._call('midi_note_off', m.n); break;
      case 'set':  this._call(m.f, ...m.a); break;
      case 'debug':
        const voices = this.fn._debug_active_voices();
        const dcaLvl = this.fn._debug_dca_level(0);
        const dcaEp = this.fn._debug_dca_end_point();
        const dcaSus = this.fn._debug_dca_sustain_point();
        const dcaR0 = this.fn._debug_dca_rate(0);
        const dcaL0 = this.fn._debug_dca_level_stage(0);
        console.log('[Processor DEBUG] voices:', voices, 'dcaLvl:', dcaLvl, 'dcaEp:', dcaEp, 'dcaSus:', dcaSus, 'dcaR0:', dcaR0, 'dcaL0:', dcaL0);
        this.port.postMessage({t:'debug', voices, dcaLvl, dcaEp, dcaSus, dcaR0, dcaL0});
        break;
    }
  }

  process(_i, outputs) {
    if (!this.ready) return true;
    const o = outputs[0];
    if (!o || !o[0]) return true;
    const n = o[0].length;
    this.fn._process_audio_variable(n);
    const p = this.fn._get_audio_buffer();
    const b = new Int16Array(this.mem.buffer, p, n * 2);
    let sum = 0;
    let maxVal = 0;
    for (let i = 0; i < n; i++) {
      const s = b[i * 2] / 32768;
      o[0][i] = s;
      if (o[1]) o[1][i] = s;
      const abs = Math.abs(s);
      sum += abs;
      if (abs > maxVal) maxVal = abs;
    }
    this._dbg++;
    if (this._dbg <= 3) {
      console.log('[Process] call#', this._dbg, 'n=', n, 'bufPtr=', p, 'max=', maxVal.toFixed(4), 'first4=', Array.from(b.slice(0,4)));
    }
    if (this._dbg % 344 === 0) {
      const rms = sum / n;
      this.port.postMessage({t:'dbg', rms: rms.toFixed(3)});
    }
    return true;
  }
}

registerProcessor('cz-proc', CrispyZebraProcessor);
