const faderCount = 8;
const horizontalControls = [
    { key: 'sustain-point', label: 'SUS\nPNT.' },
    { key: 'end-point', label: 'END\nPNT.' },
    { key: 'key-follow', label: 'KEY FOLLOW' }
];
const routingState = {
    lineSelect: 0,
    ring: false,
    noise: false,
    detuneSign: 1,
    detuneOctave: 0,
    detuneNote: 0,
    detuneFine: 0
};
const masterState = {
    volume: 80,
    octave: 1,
    pan: 50,
    drive: 0,
    noteSemitone: 0,
    fineTuning: 30,
    portamentoEnabled: false,
    portamentoTime: 0,
    pitchBendUp: 2,
    pitchBendDown: 2
};
const vibratoState = {
    waveform: 0,
    delay: 0,
    rate: 0,
    depth: 0
};
const PRESET_COUNT = 100;
const PRESET_PATH = 'presets/';
const WASM_ASSET_VERSION = '23';
const PRESET_ASSET_VERSION = Date.now();
let currentPresetIndex = 0;
let currentPresetKind = 'factory';
let currentUserPresetId = null;
let currentPresetMeta = {
    bank: 'Factory',
    category: 'User',
    presetName: 'Init'
};
const presetNameCache = new Map();
const USER_PRESET_STORAGE_KEY = 'crispy-zebra-user-presets-v1';
let userPresets = [];
const defaultEgState = {
    rates: [50, 85, 92, 45, 60, 45, 70, 60],
    levels: [99, 70, 65, 20, 85, 45, 75, 0],
    sustainPoint: 5,
    endPoint: 8,
    keyFollow: 0,
    waveforms: [0, 1]
};
const waveforms = [
    { name: 'SAW', path: 'M 12,80 L 12,20 L 88,80' },
    { name: 'SQUARE', path: 'M 12,80 L 12,20 L 47.16,20 L 47.16,80 L 88,80' },
    { name: 'PULSE', path: 'M 12,80 L 15,20 L 30,80 L 45,80 L 88,80' },
    { name: 'DBL-SINE', path: 'M 12,80 L 23.51,20 L 35.03,80 C 48.27,80 48.27,20 61.51,20 S 74.75,80 88,80' },
    { name: 'SAW-PULSE', path: 'M 12,80 C 16.19,80 20.37,20 47.13,20 L 47.13,80 L 88,80' },
    { name: 'RESONANCE-1', path: 'M 88,80 C 84.22,80 84.22,78.96 80.45,78.96 S 76.68,80 72.91,80 S 69.13,62.91 65.36,62.91 S 61.59,80 57.82,80 S 54.04,50.18 50.27,50.18 S 46.5,80 42.73,80 S 38.95,40.48 35.18,40.48 S 31.41,80 27.64,80 S 23.86,30.98 20.09,30.98 S 16.32,80 12.55,80 S 8.77,1 5,1 S 1.23,80 -2.55,80' },
    { name: 'RESONANCE-2', path: 'M 88,80 C 84.82,80 84.82,75.38 81.65,75.38 S 78.47,80 75.3,80 S 72.13,49.03 68.95,49.03 S 65.78,80 62.6,80 S 59.43,1 56.26,1 S 53.08,80 49.91,80 S 46.73,1 43.56,1 S 40.39,80 37.21,80 S 34.04,49.03 30.86,49.03 S 27.69,80 24.52,80 S 21.34,75.38 18.17,75.38 S 14.99,80 11.82,80' },
    { name: 'RESONANCE-3', path: 'M 88,80 C 84.82,80 84.82,67.14 81.65,67.14 S 78.47,80 75.3,80 S 72.13,57.17 68.95,57.17 S 65.78,80 62.6,80 S 59.43,41.97 56.26,41.97 S 53.08,80 49.91,80 S 46.73,1 43.56,1 S 40.39,80 37.21,80 S 34.04,1 30.86,1 S 27.69,80 24.52,80 S 21.34,1 18.17,1 S 14.99,80 11.82,80' },
];

const vibratoForms = [{ name: 'VIB-TRIANGLE', path: 'M 88,50.31 L 69.04,80.31 L 50.07,50.31 L 31.11,20.31 L 12,50.31' },
{ name: 'VIB-SAW-UP', path: 'M 12,80 L 12,20 L 88,80' },
{ name: 'VIB-SAW-DOWN', path: 'M 88,80 L 88,20 L 12,80' },
{ name: 'VIB-SQUARE', path: 'M 12,80 L 12,20 L 47.16,20 L 47.16,80 L 88,80 L 88,20' }];

const valuePopover = document.getElementById('valuePopover');
const controlRegistry = new Map();
const egStates = {};
let activeWaveformTarget = null;
let activeFader = null;
let activePointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// ─── AudioWorklet State ───
let audioCtx = null, workletNode = null, isRunning = false;
const activeNotes = new Set();
const kbNotes = new Set();
let midiAccess = null;
let midiConnected = false;
let midiModWheel = 1;
const midiHeldNotes = new Set();

// ─── AudioWorklet Init ───
async function initAudio() {
    console.log('[initAudio] starting...');
    if (audioCtx) { console.log('[initAudio] audioCtx already exists'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    console.log('[initAudio] audioCtx created, state:', audioCtx.state);
    // setStatus('⏳ Loading worklet...');
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    if (!audioCtx.audioWorklet) {
        setStatus('❌ AudioWorklet not supported');
        console.log('[initAudio] AudioWorklet not supported');
        return;
    }

    try {
        await audioCtx.audioWorklet.addModule(`crispy_zebra_processor.js?v=${WASM_ASSET_VERSION}`);
        console.log('[initAudio] worklet module loaded');
    } catch (e) {
        setStatus('❌ Worklet: ' + e.message);
        console.log('[initAudio] worklet module error:', e);
        return;
    }

    workletNode = new AudioWorkletNode(audioCtx, 'cz-proc', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
    });
    workletNode.channelCount = 2;
    workletNode.channelCountMode = 'explicit';
    workletNode.channelInterpretation = 'speakers';
    console.log('[initAudio] workletNode created, audioCtx.state:', audioCtx.state);
    const dest = workletNode.connect(audioCtx.destination);
    console.log('[initAudio] connected, destination:', dest, 'audioCtx.state:', audioCtx.state);
    
    // Force resume immediately
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log('[initAudio] forced resume, state:', audioCtx.state);
    }

    let _resolve, _reject;
    workletNode.port.onmessage = e => {
        const d = e.data;
        console.log('[Worklet msg]', d);
        if (d.type === 'ready') { if (_resolve) _resolve(); }
        else if (d.type === 'error') { if (_reject) _reject(new Error(d.msg)); }
    };

    // setStatus('Loading WASM...');
    try {
        const resp = await fetch(`crispy_zebra.wasm?v=${WASM_ASSET_VERSION}`);
        const wasmBytes = await resp.arrayBuffer();
        console.log('[initAudio] WASM fetched, size:', wasmBytes.byteLength);
        const readyPromise = new Promise((res, rej) => { _resolve = res; _reject = rej; });
        const timer = setTimeout(() => { _reject(new Error('Timeout')); }, 15000);
        workletNode.port.postMessage({ type: 'wasm', buf: wasmBytes, sr: audioCtx.sampleRate }, [wasmBytes]);
        console.log('[initAudio] WASM sent to worklet, waiting for ready...');
        await readyPromise;
        clearTimeout(timer);
        console.log('[initAudio] WASM ready');
    } catch (e) {
        setStatus('❌ WASM: ' + e.message);
        console.log('[initAudio] WASM error:', e);
        return;
    }

    console.log('[initAudio] calling fullSync...');
    fullSync();
    isRunning = true;
    console.log('[initAudio] isRunning=true');
    
    // Force resume if still suspended
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log('[initAudio] forced resume, new state:', audioCtx.state);
    }
    console.log('[initAudio] final audioCtx.state:', audioCtx.state);
    const startOverlay = document.getElementById('start-overlay');
    if (startOverlay) {
        startOverlay.classList.add('hidden');
        startOverlay.disabled = true;
    }
}

function setStatus(msg) {
    const lcd2 = document.getElementById('lcd-line2');
    if (lcd2) lcd2.textContent = msg;
}

function sendWorkletSet(f, ...a) {
    if (workletNode) workletNode.port.postMessage({ type: 'set', f, a });
}

function getEffectiveVibratoDepth() {
    return Math.max(0, Math.min(99, Math.round(vibratoState.depth * midiModWheel)));
}

function syncVibratoDepth() {
    sendWorkletSet('set_vibrato_depth', getEffectiveVibratoDepth());
}

function nOn(n) {
    console.log('[nOn]', n, 'isRunning=', isRunning);
    if (isRunning) {
        workletNode.port.postMessage({ type: 'nOn', n });
        activeNotes.add(n);
        // Debug: check engine state after note on
        setTimeout(() => {
            const p = workletNode.port;
            p.postMessage({ type: 'debug' });
        }, 100);
    }
}

function nOff(n) {
    console.log('[nOff]', n);
    if (isRunning) {
        workletNode.port.postMessage({ type: 'nOff', n });
        activeNotes.delete(n);
    }
}

function setMidiLamp(on) {
    const midiBtn = document.querySelector('.midi-btn');
    const lamp = midiBtn?.closest('.btn-container')?.querySelector('.lamp');
    if (lamp) lamp.classList.toggle('is-active', on);
}

function updateMidiConnectionState() {
    midiConnected = !!midiAccess && Array.from(midiAccess.inputs.values())
        .some((input) => input.state === 'connected');
    setMidiLamp(midiConnected);
}

function handleMidiMessage(event) {
    const [status, data1, data2] = event.data;
    const command = status & 0xF0;

    if (command === 0x90) {
        if (data2 === 0) {
            midiHeldNotes.delete(data1);
            nOff(data1);
        } else {
            midiHeldNotes.add(data1);
            nOn(data1);
        }
        return;
    }

    if (command === 0x80) {
        midiHeldNotes.delete(data1);
        nOff(data1);
        return;
    }

    if (command === 0xB0 && data1 === 1) {
        midiModWheel = Math.max(0, Math.min(1, data2 / 127));
        syncVibratoDepth();
        return;
    }

    if (command === 0xE0) {
        const bend = ((data2 << 7) | data1) - 8192;
        sendWorkletSet('set_pitch_bend', bend);
    }
}

function attachMidiInputs() {
    if (!midiAccess) return;
    midiAccess.inputs.forEach((input) => {
        input.onmidimessage = handleMidiMessage;
    });
    updateMidiConnectionState();
}

async function connectMidi() {
    if (!navigator.requestMIDIAccess) {
        setMidiLamp(false);
        console.warn('[MIDI] Web MIDI API not supported');
        return;
    }

    if (!audioCtx) {
        await initAudio();
    } else if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    try {
        midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        midiAccess.onstatechange = attachMidiInputs;
        attachMidiInputs();
        midiModWheel = 0;
        syncVibratoDepth();
    } catch (e) {
        console.error('[MIDI] requestMIDIAccess failed:', e);
        setMidiLamp(false);
    }
}

// ─── fullSync: UI → Worklet ───
function fullSync() {
    const p = () => workletNode && workletNode.port;
    if (!p()) { console.log('[fullSync] workletNode not ready'); return; }
    const s = (f, ...a) => { console.log('[fullSync] set:', f, a); p().postMessage({ type: 'set', f, a }); };

    s('set_line_select', routingState.lineSelect);
    s('set_ring_modulation', routingState.ring);
    s('set_noise_modulation', routingState.noise);
    s('set_detune_sign', routingState.detuneSign);
    s('set_detune_octave', routingState.detuneOctave);
    s('set_detune_note', routingState.detuneNote);
    s('set_detune_fine', routingState.detuneFine);

    s('set_vibrato_waveform', vibratoState.waveform);
    s('set_vibrato_delay', vibratoState.delay);
    s('set_vibrato_rate', vibratoState.rate);
    s('set_vibrato_depth', getEffectiveVibratoDepth());

    s('set_master_octave', masterState.octave);
    s('set_master_note', masterState.noteSemitone);
    s('set_master_fine', masterState.fineTuning);
    s('set_master_pan', masterState.pan);
    s('set_master_drive', masterState.drive);
    s('set_master_volume', masterState.volume);
    s('set_portamento_enabled', masterState.portamentoEnabled);
    s('set_portamento_time', masterState.portamentoTime);
    s('set_pitch_bend_range_up', masterState.pitchBendUp);
    s('set_pitch_bend_range_down', masterState.pitchBendDown);

    // DCO waves: UI 0-7 → Backend 1-8 (+1)
    ['dco1', 'dco2'].forEach(prefix => {
        const eg = ensureEgState(prefix);
        const w1 = eg.waveforms[0] + 1;
        const w2 = eg.waveforms[1] + 1;
        if (prefix === 'dco1') {
            s('set_line1_wave1', w1);
            s('set_line1_wave2', w2);
        } else {
            s('set_line2_wave1', w1);
            s('set_line2_wave2', w2);
        }
    });

    // EG: 6 columns
    const EG_MAP = [
        { prefix: 'dco1', line: 1, eg: 0 },
        { prefix: 'dco2', line: 2, eg: 0 },
        { prefix: 'dcw1', line: 1, eg: 1 },
        { prefix: 'dcw2', line: 2, eg: 1 },
        { prefix: 'dca1', line: 1, eg: 2 },
        { prefix: 'dca2', line: 2, eg: 2 }
    ];

    EG_MAP.forEach(cfg => {
        const eg = ensureEgState(cfg.prefix);
        for (let st = 0; st < 8; st++) {
            s('set_eg_rate', cfg.line, cfg.eg, st, eg.rates[st]);
            s('set_eg_level', cfg.line, cfg.eg, st, eg.levels[st]);
        }
        // SUS/END: 1-based → 0-based
        s('set_eg_sustain_point', cfg.line, cfg.eg, eg.sustainPoint - 1);
        s('set_eg_end_point', cfg.line, cfg.eg, eg.endPoint - 1);
        if (cfg.eg === 1) s('set_dcw_key_follow', eg.keyFollow);
        if (cfg.eg === 2) s('set_dca_key_follow', eg.keyFollow);
    });

    s('set_dark_mode', document.body.classList.contains('is-dark'));
}

// ─── Event Bridge: CustomEvent → fullSync ───
function emitUiChange(type, detail) {
    document.dispatchEvent(new CustomEvent(type, { detail }));
    fullSync();
}

// ─── EG State ───
function ensureEgState(egPrefix) {
    if (!egStates[egPrefix]) {
        egStates[egPrefix] = {
            rates: [...defaultEgState.rates],
            levels: [...defaultEgState.levels],
            sustainPoint: defaultEgState.sustainPoint,
            endPoint: defaultEgState.endPoint,
            keyFollow: defaultEgState.keyFollow,
            waveforms: [...defaultEgState.waveforms]
        };
    }
    return egStates[egPrefix];
}

function waveformSvg(index, isVibrato = false) {
    const waveform = isVibrato ? vibratoForms[index] : waveforms[index];
    return `
        <svg class="wave-svg" viewBox="${waveform.viewBox || '0 0 100 100'}" aria-hidden="true">
            <path class="wave-path" d="${waveform.path}" />
        </svg>
    `;
}

function createWaveformSelector(egPrefix) {
    const egState = ensureEgState(egPrefix);
    const selector = document.createElement('div');
    selector.className = 'waveform-selector';

    for (let slot = 0; slot < 2; slot += 1) {
        const item = document.createElement('div');
        item.className = 'waveform-selector-item';
        const button = document.createElement('button');
        const index = egState.waveforms[slot];
        button.className = 'waveform-window';
        button.type = 'button';
        button.dataset.egPrefix = egPrefix;
        button.dataset.waveSlot = slot;
        button.dataset.waveIndex = index;
        button.innerHTML = `
            <span class="wave-number">${index + 1}</span>
            ${waveformSvg(index)}
        `;
        button.addEventListener('click', (e) => {
            activeWaveformTarget = button;
            openWaveformCatalog(button, e.clientX, e.clientY);
        });
        const label = document.createElement('div');
        label.className = 'waveform-selector-label';
        label.textContent = `WAVE ${slot + 1}`;
        item.appendChild(button);
        item.appendChild(label);
        selector.appendChild(item);
    }

    return selector;
}

function openWaveformCatalog(target, clientX, clientY) {
    const catalog = document.getElementById('waveformCatalog');
    activeWaveformTarget = target;
    catalog.innerHTML = '';

    const isVibrato = target.dataset.egPrefix === 'vibrato';
    const waveformList = isVibrato ? vibratoForms : waveforms;

    waveformList.forEach((waveform, index) => {
        const button = document.createElement('button');
        button.className = 'waveform-card';
        button.type = 'button';
        button.innerHTML = `
            <span class="wave-number">${index + 1}</span>
            ${waveformSvg(index, isVibrato)}
        `;
        button.addEventListener('click', () => {
            selectWaveform(index);
        });
        catalog.appendChild(button);
    });

    catalog.classList.add('is-visible');
    moveFloatingPanel(catalog, clientX, clientY);
}

function selectWaveform(index) {
    if (!activeWaveformTarget) return;

    const egPrefix = activeWaveformTarget.dataset.egPrefix;
    const isVibrato = egPrefix === 'vibrato';

    if (isVibrato) {
        vibratoState.waveform = index;
        activeWaveformTarget.dataset.waveIndex = index;
        activeWaveformTarget.innerHTML = `
            <span class="wave-number">${index + 1}</span>
            ${waveformSvg(index, true)}
        `;
        emitUiChange('waveformChange', { key: 'vibrato-waveform', index });
    } else {
        const slot = Number(activeWaveformTarget.dataset.waveSlot);
        const egState = ensureEgState(egPrefix);
        const key = `${egPrefix}-waveform-${slot + 1}`;
        egState.waveforms[slot] = index;
        activeWaveformTarget.dataset.waveIndex = index;
        activeWaveformTarget.innerHTML = `
            <span class="wave-number">${index + 1}</span>
            ${waveformSvg(index)}
        `;
        emitUiChange('waveformChange', { key, index });
    }

    closeWaveformCatalog();
}

function closeWaveformCatalog() {
    document.getElementById('waveformCatalog').classList.remove('is-visible');
    activeWaveformTarget = null;
}

function initVibratoPanel() {
    const vibWaveBtn = document.getElementById('vibrato-waveform');
    if (vibWaveBtn) {
        vibWaveBtn.addEventListener('click', (e) => {
            activeWaveformTarget = vibWaveBtn;
            openWaveformCatalog(vibWaveBtn, e.clientX, e.clientY);
        });
    }

    ['vibrato-delay', 'vibrato-rate', 'vibrato-depth'].forEach(controlId => {
        const knob = document.getElementById(controlId);
        if (knob) {
            registerControl(knob, {
                key: controlId,
                value: '0',
                kind: 'standalone',
                min: 0,
                max: 99,
                onChange: (value) => {
                    const key = controlId.replace('vibrato-', '');
                    vibratoState[key] = Number(value);
                    emitUiChange('vibratoChange', { key, value: vibratoState[key] });
                }
            });
        }
    });
}

function initRoutingPanel() {
    const lineButtons = document.querySelectorAll('.routing-line-btn');
    lineButtons.forEach(btn => {
        const tile = btn.closest('.btn-container');
        const lamp = tile.querySelector('.lamp');
        const index = Number(btn.dataset.lineIndex);

        btn.addEventListener('click', () => {
            routingState.lineSelect = index;
            document.querySelectorAll('.routing-line-btn').forEach((b, i) => {
                const l = b.closest('.btn-container').querySelector('.lamp');
                l.classList.toggle('is-active', i === index);
            });
            emitUiChange('routingChange', { key: 'line-select', index, value: ['LINE 1', 'LINE 2', 'LINE 1+2', "LINE 1+2'"][index] });
        });
    });

    document.querySelector('.routing-line-btn[data-line-index="0"]')
        ?.closest('.btn-container')?.querySelector('.lamp')?.classList.add('is-active');

    const modButtons = document.querySelectorAll('.routing-mod-btn');
    modButtons.forEach(btn => {
        const tile = btn.closest('.btn-container');
        const lamp = tile.querySelector('.lamp');
        const modType = btn.dataset.modType;

        btn.addEventListener('click', () => {
            routingState[modType] = !routingState[modType];
            lamp.classList.toggle('is-active', routingState[modType]);
            emitUiChange('routingChange', { key: modType, value: routingState[modType] });
        });
    });
}

function initDetunePanel() {
    const downBtn = document.querySelector('.routing-detune-down-btn');
    const upBtn = document.querySelector('.routing-detune-up-btn');
    if (!downBtn || !upBtn) return;
    const downLamp = downBtn.closest('.btn-container').querySelector('.lamp');
    downBtn.addEventListener('click', () => {
        routingState.detuneSign = -1;
        downLamp.classList.add('is-active');
        upLamp.classList.remove('is-active');
        emitUiChange('routingChange', { key: 'detune-sign', value: routingState.detuneSign });
    });

    const upLamp = upBtn.closest('.btn-container').querySelector('.lamp');
    upBtn.addEventListener('click', () => {
        routingState.detuneSign = 1;
        upLamp.classList.add('is-active');
        downLamp.classList.remove('is-active');
        emitUiChange('routingChange', { key: 'detune-sign', value: routingState.detuneSign });
    });

    downLamp.classList.toggle('is-active', routingState.detuneSign === -1);
    upLamp.classList.toggle('is-active', routingState.detuneSign === 1);

    ['detune-octave', 'detune-note', 'detune-fine'].forEach(controlId => {
        const knob = document.getElementById(controlId);
        if (knob) {
            const limits = { octave: [0, 3], note: [0, 11], fine: [0, 60] };
            const key = controlId.replace('detune-', '');
            registerControl(knob, {
                key: controlId,
                value: '0',
                kind: 'detune',
                min: limits[key][0],
                max: limits[key][1],
                onChange: (value) => {
                    const stateKey = key === 'octave' ? 'detuneOctave' : 'detune' + key.charAt(0).toUpperCase() + key.slice(1);
                    routingState[stateKey] = Number(value);
                    emitUiChange('routingChange', { key: 'detune-' + key, value: Number(value) });
                }
            });
        }
    });
}

function initMasterPanel() {
    const masterControls = [
        { id: 'master-volume', stateKey: 'volume', min: 0, max: 99 },
        { id: 'master-octave', stateKey: 'octave', min: 0, max: 2 },
        { id: 'master-pan', stateKey: 'pan', min: 0, max: 99 },
        { id: 'master-drive', stateKey: 'drive', min: 0, max: 99 },
        { id: 'master-note-semitone', stateKey: 'noteSemitone', min: 0, max: 11 },
        { id: 'master-fine-tune', stateKey: 'fineTuning', min: 0, max: 60 },
        { id: 'master-portamento-time', stateKey: 'portamentoTime', min: 0, max: 99 },
        { id: 'master-pitch-bend-up', stateKey: 'pitchBendUp', min: 0, max: 24 },
        { id: 'master-pitch-bend-down', stateKey: 'pitchBendDown', min: 0, max: 24 }
    ];

    masterControls.forEach(control => {
        const knob = document.getElementById(control.id);
        if (knob) {
            const defaultVal = masterState[control.stateKey];
            knob.dataset.controlValue = String(defaultVal);
            registerControl(knob, {
                key: control.id,
                value: String(defaultVal),
                kind: 'standalone',
                min: control.min,
                max: control.max,
                onChange: (value) => {
                    masterState[control.stateKey] = Number(value);
                    emitUiChange('masterChange', { key: control.stateKey, value: masterState[control.stateKey] });
                }
            });
        }
    });

    const portamentoBtn = document.getElementById('master-portamento-toggle');
    if (portamentoBtn) {
        const lamp = portamentoBtn.closest('.btn-container')?.querySelector('.lamp');
        lamp?.classList.toggle('is-active', masterState.portamentoEnabled);
        portamentoBtn.addEventListener('click', () => {
            masterState.portamentoEnabled = !masterState.portamentoEnabled;
            lamp?.classList.toggle('is-active', masterState.portamentoEnabled);
            emitUiChange('masterChange', { key: 'portamentoEnabled', value: masterState.portamentoEnabled });
        });
    }
}

function initAppearanceButton() {
    const appearanceBtn = document.getElementById('appearance-toggle');
    if (!appearanceBtn) return;

    const tile = appearanceBtn.closest('.btn-container');
    const lamp = tile.querySelector('.lamp');

    appearanceBtn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('is-dark');
        document.getElementById('app').classList.toggle('is-dark', isDark);
        lamp.classList.toggle('is-active', isDark);
        appearanceBtn.classList.toggle('is-active', isDark);
        emitUiChange('appearanceChange', { darkMode: isDark });
    });
}

function initMidiButton() {
    const midiBtn = document.querySelector('.midi-btn');
    if (!midiBtn) return;
    midiBtn.addEventListener('click', connectMidi);
}

function openAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (!modal) return;
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
    modal.querySelector('.modal-close')?.focus();
}

function closeAboutModal() {
    const modal = document.getElementById('aboutModal');
    if (!modal) return;
    modal.classList.remove('is-visible');
    modal.setAttribute('aria-hidden', 'true');
}

function initAboutModal() {
    const aboutBtn = document.querySelector('#brand-logo');
    const modal = document.getElementById('aboutModal');
    if (!aboutBtn || !modal) return;

    aboutBtn.addEventListener('click', openAboutModal);
    modal.querySelector('.modal-close')?.addEventListener('click', closeAboutModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAboutModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('is-visible')) {
            closeAboutModal();
        }
    });
}

function createTopControlFader(egPrefix, control, sizeClass = '') {
    const controlId = `${egPrefix}-${control.key}`;
    const egState = ensureEgState(egPrefix);
    const initialValue = getHorizontalControlValue(egState, control.key);
    const container = document.createElement('div');
    const orientationClass = control.key === 'key-follow' ? 'is-horizontal' : 'is-top-control';
    const resolvedSizeClass = control.key === 'key-follow' ? '' : sizeClass;
    container.className = `fader-container ${orientationClass} ${resolvedSizeClass}`.trim();
    container.dataset.controlId = controlId;

    const isKeyFollow = control.key === 'key-follow';
    const controlAttrs = isKeyFollow
        ? `data-control-min="0" data-control-max="99"`
        : '';

    container.innerHTML = `
        <div class="fader-layout">
            <div class="fader-well">
                <div class="fader-slot"></div>
                <div class="fader-knob" id="${controlId}" data-control-id="${controlId}" data-control-value="${initialValue}" ${controlAttrs}></div>
            </div>
        </div>
        <div class="top-control-label">${control.label}</div>
    `;

    const controlConfig = {
        key: controlId,
        value: `${initialValue}`,
        kind: 'top-control',
        onChange: (value) => updateEgStateFromControl(controlId, value)
    };

    if (isKeyFollow) {
        controlConfig.min = 0;
        controlConfig.max = 99;
    }

    registerControl(container.querySelector('.fader-knob'), controlConfig);

    return container;
}

function createEgCanvas(egPrefix) {
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'eg-canvas-wrap';
    canvasWrap.innerHTML = `<canvas class="eg-canvas" id="${egPrefix}-eg-canvas" data-eg-canvas="${egPrefix}"></canvas>`;
    return canvasWrap;
}

function createFader(egPrefix, stage, parameter, sizeClass = '') {
    const controlId = `${egPrefix}-eg-${stage}-${parameter}`;
    const egState = ensureEgState(egPrefix);
    const initialValue = parameter === 'rate' ? egState.rates[stage - 1] : egState.levels[stage - 1];
    const container = document.createElement('div');
    container.className = `fader-container is-panel ${sizeClass}`.trim();
    container.dataset.controlId = controlId;
    container.innerHTML = `
        <div class="fader-layout">
            <div class="fader-well">
                <div class="fader-slot"></div>
                <div class="fader-knob" id="${controlId}" data-control-id="${controlId}" data-control-value="${initialValue}" data-control-kind="eg"></div>
            </div>
        </div>
    `;
    registerControl(container.querySelector('.fader-knob'), {
        key: controlId,
        value: `${initialValue}`,
        kind: 'eg',
        onChange: (value) => updateEgStateFromControl(controlId, value)
    });

    return container;
}

function createEgStage(egPrefix, stage) {
    const stageElement = document.createElement('div');
    stageElement.className = 'eg-stage';
    stageElement.dataset.egPrefix = egPrefix;
    stageElement.dataset.stage = stage;
    stageElement.appendChild(createFader(egPrefix, stage, 'level', 'is-mid'));
    
    const stageLabel = document.createElement('div');
    stageLabel.className = 'eg-stage-label';
    stageLabel.textContent = stage;
    stageElement.appendChild(stageLabel);
    stageElement.appendChild(createFader(egPrefix, stage, 'rate', 'is-mid'));

    return stageElement;
}
function updateEgStageMarkers(egPrefix) {
    const egState = ensureEgState(egPrefix);

    document.querySelectorAll(`.eg-stage[data-eg-prefix="${egPrefix}"]`).forEach((stageElement) => {
        const stage = Number(stageElement.dataset.stage);
        const label = stageElement.querySelector('.eg-stage-label');
        const isSustainStage = stage === egState.sustainPoint;
        const isEndStage = stage === egState.endPoint;
        const isReleaseStage = stage === egState.endPoint + 1 && egState.endPoint < 8;
        const isDisabled = stage > egState.endPoint + 1;

        stageElement.dataset.disabled = isDisabled ? 'true' : 'false';
        stageElement.dataset.releaseStage = isReleaseStage ? 'true' : 'false';
        
        // 1. ステージ全体（親）のクラス制御
        stageElement.classList.toggle('is-disabled', isDisabled);
        stageElement.classList.toggle('is-release-stage', isReleaseStage);
        stageElement.classList.toggle('is-theme-stage', !isDisabled && (isSustainStage || isEndStage));
        label.textContent = isReleaseStage ? 'REL' : isEndStage ? 'END' : isSustainStage ? 'SUS' : stage;

        // 2. 【ここを書き換え】レベル側の fader-well だけを狙い撃ちして is-disabled をつける
        // このステージ内にある、IDまたはdata-control-idがお尻「-level」で終わるフェーダーコンテナを探す
        const levelContainer = stageElement.querySelector('.fader-container[data-control-id$="-level"]');
        
        if (levelContainer) {
            // そのコンテナの中にある「fader-well」を探す
            const levelWell = levelContainer.querySelector('.fader-well');
            if (levelWell) {
                // リリースステージ（isReleaseStage）なら is-disabled クラスをつける、そうでないなら外す
                levelWell.classList.toggle('is-disabled', isReleaseStage);
            }
        }
    });
}


function registerControl(element, control) {
    controlRegistry.set(element, {
        key: control.key,
        value: control.value ?? '',
        kind: control.kind ?? 'generic',
        min: control.min,
        max: control.max,
        onChange: control.onChange
    });

    element.addEventListener('pointerenter', (e) => {
        if (isControlDisabled(element)) return;
        activePointer = { x: e.clientX, y: e.clientY };
        showPopover(element, e.clientX, e.clientY);
    });

    element.addEventListener('pointermove', (e) => {
        if (isControlDisabled(element)) return;
        activePointer = { x: e.clientX, y: e.clientY };
        if (!activeFader) {
            showPopover(element, e.clientX, e.clientY);
        }
    });

    element.addEventListener('pointerleave', hidePopover);
}

function isControlDisabled(element) {
    const stage = element.closest('.eg-stage');
    if (!stage) return false;
    if (stage.dataset.disabled === 'true') return true;
    return stage.dataset.releaseStage === 'true' && element.dataset.controlId?.endsWith('-level');
}

function setControlValue(element, value) {
    const control = controlRegistry.get(element);
    if (!control) return;

    control.value = `${value}`;
    element.dataset.controlValue = `${value}`;
    if (typeof control.onChange === 'function') {
        control.onChange(value, element);
    } else if (control.kind === 'eg') {
        updateEgStateFromControl(element.dataset.controlId, value);
    }
}

function getHorizontalControlValue(egState, key) {
    if (key === 'sustain-point') return egState.sustainPoint;
    if (key === 'end-point') return egState.endPoint;
    if (key === 'key-follow') return egState.keyFollow;
    return 0;
}

function getDisplayValue(controlId, percent) {
    if (controlId.endsWith('-sustain-point') || controlId.endsWith('-end-point')) {
        return Math.max(1, Math.min(8, Math.round((percent / 100) * 7) + 1));
    }
    return Math.max(0, Math.min(99, Math.round((percent / 100) * 99)));
}

function getPercentFromDisplayValue(controlId, value) {
    if (controlId.endsWith('-sustain-point') || controlId.endsWith('-end-point')) {
        return ((Number(value) - 1) / 7) * 100;
    }
    return (Number(value) / 99) * 100;
}

function updateEgStateFromControl(controlId, value) {
    const parts = controlId.split('-');
    const egPrefix = parts[0];
    const egState = ensureEgState(egPrefix);
    let numericValue = Number(value);

    if (controlId.includes('-eg-')) {
        const stage = Number(parts[2]) - 1;
        const parameter = parts[3];
        if (parameter === 'rate') egState.rates[stage] = numericValue;
        if (parameter === 'level') {
            if (stage === egState.endPoint && egState.endPoint < 8) {
                numericValue = 0;
                setFaderById(controlId, numericValue);
            }
            egState.levels[stage] = numericValue;
        }
    } else if (controlId.endsWith('-sustain-point')) {
        egState.sustainPoint = numericValue;
    } else if (controlId.endsWith('-end-point')) {
        egState.endPoint = numericValue;
        if (numericValue < 8) {
            egState.levels[numericValue] = 0;
            setFaderById(`${egPrefix}-eg-${numericValue + 1}-level`, 0);
        }
    } else if (controlId.endsWith('-key-follow')) {
        egState.keyFollow = numericValue;
    }

    updateEgStageMarkers(egPrefix);
    drawEg(egPrefix);
    fullSync();
}

function movePopover(clientX, clientY) {
    moveFloatingPanel(valuePopover, clientX, clientY);
}

function moveFloatingPanel(panel, clientX, clientY) {
    const offset = 14;
    const marginFromEdge = 8;
    const rect = panel.getBoundingClientRect();
    let x = clientX + offset;
    let y = clientY - rect.height - offset;

    if (x + rect.width + marginFromEdge > window.innerWidth) {
        x = clientX - rect.width - offset;
    }

    if (y < marginFromEdge) {
        y = clientY + offset;
    }

    x = Math.max(marginFromEdge, Math.min(x, window.innerWidth - rect.width - marginFromEdge));
    y = Math.max(marginFromEdge, Math.min(y, window.innerHeight - rect.height - marginFromEdge));

    panel.style.transform = `translate(${x}px, ${y}px)`;
}

function showPopover(element, clientX = activePointer.x, clientY = activePointer.y) {
    const control = controlRegistry.get(element);
    if (!control) return;

    valuePopover.textContent = `${control.key}\n${control.value}`;
    valuePopover.classList.add('is-visible');
    movePopover(clientX, clientY);
}

function hidePopover() {
    if (!activeFader) {
        valuePopover.classList.remove('is-visible');
    }
}

function updateFaderPosition(fader, clientX, clientY) {
    const { well, knob } = fader;
    const wellRect = well.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();
    const computedWell = window.getComputedStyle(well);
    const margin = parseFloat(computedWell.getPropertyValue('--fader-margin')) || 0;
    const isHorizontal = well.closest('.fader-container').classList.contains('is-horizontal');
    const control = controlRegistry.get(knob);
    const hasRange = control && typeof control.min === 'number' && typeof control.max === 'number';

    if (isHorizontal) {
        const minLeft = margin;
        const maxLeft = wellRect.width - knobRect.width - margin;
        let currentLeft = clientX - wellRect.left - (knobRect.width / 2);
        currentLeft = Math.max(minLeft, Math.min(currentLeft, maxLeft));
        knob.style.left = `${currentLeft}px`;

        if (hasRange) {
            const value = Math.round(control.min + ((currentLeft - minLeft) / (maxLeft - minLeft)) * (control.max - control.min));
            setControlValue(knob, value);
        } else {
            const percent = Math.round(((currentLeft - minLeft) / (maxLeft - minLeft)) * 100);
            setControlValue(knob, getDisplayValue(knob.dataset.controlId, percent));
        }
        return;
    }

    const minBottom = margin;
    const maxBottom = wellRect.height - knobRect.height - margin;
    let currentBottom = wellRect.bottom - clientY - (knobRect.height / 2);
    currentBottom = Math.max(minBottom, Math.min(currentBottom, maxBottom));
    knob.style.bottom = `${currentBottom}px`;

    if (hasRange) {
        const value = Math.round(control.min + ((currentBottom - minBottom) / (maxBottom - minBottom)) * (control.max - control.min));
        setControlValue(knob, value);
    } else {
        const percent = Math.round(((currentBottom - minBottom) / (maxBottom - minBottom)) * 100);
        setControlValue(knob, getDisplayValue(knob.dataset.controlId, percent));
    }
}

function setFaderToValue(knob, value) {
    const well = knob.closest('.fader-well');
    const wellRect = well.getBoundingClientRect();
    const knobRect = knob.getBoundingClientRect();
    const computedWell = window.getComputedStyle(well);
    const margin = parseFloat(computedWell.getPropertyValue('--fader-margin')) || 0;
    const isHorizontal = well.closest('.fader-container').classList.contains('is-horizontal');
    const control = controlRegistry.get(knob);
    const hasRange = control && typeof control.min === 'number' && typeof control.max === 'number';

    if (isHorizontal) {
        const minLeft = margin;
        const maxLeft = wellRect.width - knobRect.width - margin;
        const percent = hasRange
            ? (Number(value) - control.min) / (control.max - control.min)
            : getPercentFromDisplayValue(knob.dataset.controlId, value) / 100;
        knob.style.left = `${minLeft + (maxLeft - minLeft) * percent}px`;
        return;
    }

    const minBottom = margin;
    const maxBottom = wellRect.height - knobRect.height - margin;
    const percent = hasRange
        ? (Number(value) - control.min) / (control.max - control.min)
        : getPercentFromDisplayValue(knob.dataset.controlId, value) / 100;
    knob.style.bottom = `${minBottom + (maxBottom - minBottom) * percent}px`;
}

function rateToDuration(rate) {
    return (100 - rate) * 0.8 + 12;
}

function drawEg(egPrefix) {
    const canvas = document.querySelector(`[data-eg-canvas="${egPrefix}"]`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const state = ensureEgState(egPrefix);
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const pad = 10;
    const drawW = w - (pad * 2);
    const drawH = h - (pad * 2);
    const hasSustain = state.sustainPoint !== null && state.sustainPoint <= state.endPoint;
    const susIdx = hasSustain ? state.sustainPoint - 1 : -1;
    const endIdx = state.endPoint - 1;
    const releaseIdx = state.endPoint < 8 ? state.endPoint : -1;
    const durations = state.rates.map((rate) => rateToDuration(rate));
    let totalKeyOnDuration = 0;
    let totalKeyOffDuration = 0;

    for (let i = 0; i <= endIdx; i += 1) {
        if (hasSustain && i > susIdx) {
            totalKeyOffDuration += durations[i];
        } else {
            totalKeyOnDuration += durations[i];
        }
    }

    const widthKeyOn = hasSustain ? drawW * 0.50 : drawW;
    const widthSustain = hasSustain ? drawW * 0.16 : 0;
    const widthKeyOff = hasSustain ? drawW * 0.34 : 0;
    const points = [];
    let currentX = pad;

    points.push({ x: currentX, y: pad + drawH });

    const limitIdx = hasSustain ? susIdx : endIdx;
    for (let i = 0; i <= limitIdx; i += 1) {
        currentX += widthKeyOn * (durations[i] / totalKeyOnDuration);
        points.push({
            x: currentX,
            y: pad + drawH - (state.levels[i] / 99) * drawH
        });
    }

    if (hasSustain) {
        const y = pad + drawH - (state.levels[susIdx] / 99) * drawH;
        currentX += widthSustain;
        points.push({ x: currentX, y, isSustainBridge: true });

        for (let i = susIdx + 1; i <= endIdx; i += 1) {
            currentX += widthKeyOff * (durations[i] / totalKeyOffDuration);
            points.push({
                x: currentX,
                y: pad + drawH - (state.levels[i] / 99) * drawH
            });
        }
    }

    if (releaseIdx >= 0) {
        const releaseW = hasSustain ? widthKeyOff : drawW * 0.20;
        const releaseX = Math.min(pad + drawW, currentX + releaseW);
        points.push({
            x: releaseX,
            y: pad + drawH,
            isRelease: true
        });
    }

    function strokeEnvelope(offsetX, offsetY, color, lineWidth) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(points[0].x + offsetX, points[0].y + offsetY);

        for (let i = 1; i < points.length; i += 1) {
            const point = points[i];
            if (point.isSustainBridge) {
                ctx.stroke();
                ctx.beginPath();
                ctx.setLineDash([5, 4]);
                ctx.moveTo(points[i - 1].x + offsetX, points[i - 1].y + offsetY);
                ctx.lineTo(point.x + offsetX, point.y + offsetY);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(point.x + offsetX, point.y + offsetY);
            } else {
                ctx.lineTo(point.x + offsetX, point.y + offsetY);
            }
        }

        ctx.stroke();
        ctx.setLineDash([]);
    }

    strokeEnvelope(2, 2, 'rgba(0, 0, 0, 0.18)', 2.5);
    strokeEnvelope(0, 0, 'rgba(0, 0, 0, 0.65)', 2.5);
}

function waveNameToIndex(name) {
    const map = {
        'SAW': 0, 'SQUARE': 1, 'PULSE': 2,
        'DOUBLE_SINE': 3, 'DBL-SINE': 3,
        'SAW_PULSE': 4, 'SAW-PULSE': 4,
        'RESONANCE-1': 5, 'RESONANCE_1': 5,
        'RESONANCE-2': 6, 'RESONANCE_2': 6,
        'RESONANCE-3': 7, 'RESONANCE_3': 7,
        'REZ_SAW': 5, 'REZ-SAW': 5,
        'REZ_TRI': 6, 'REZ-TRI': 6,
        'REZ_TRAP': 7, 'REZ-TRAP': 7
    };
    return name in map ? map[name] : 0;
}

function vibratoNameToIndex(name) {
    const map = {
        'TRIANGLE': 0,
        'SAW-UP': 1, 'SAW_UP': 1,
        'SAW-DOWN': 2, 'SAW_DOWN': 2,
        'SQUARE': 3
    };
    const key = name.replace('VIB-', '');
    return key in map ? map[key] : 0;
}

function waveformIndexToName(index) {
    return ['SAW', 'SQUARE', 'PULSE', 'DOUBLE_SINE', 'SAW_PULSE', 'REZ_SAW', 'REZ_TRI', 'REZ_TRAP'][index] || 'SAW';
}

function vibratoIndexToName(index) {
    return ['TRIANGLE', 'SAW_UP', 'SAW_DOWN', 'SQUARE'][index] || 'TRIANGLE';
}
function setFaderById(controlId, value) {
    const knob = document.getElementById(controlId);
    if (!knob) return;


    if (isControlDisabled(knob)) return; 

    const control = controlRegistry.get(knob);
    if (control) control.value = String(value);
    knob.dataset.controlValue = String(value);
    setFaderToValue(knob, value);
}

function loadUserPresetsFromStorage() {
    try {
        const stored = JSON.parse(localStorage.getItem(USER_PRESET_STORAGE_KEY) || '[]');
        userPresets = Array.isArray(stored) ? stored.filter((item) => item && item.preset) : [];
    } catch (e) {
        console.warn('[UserBank] failed to read localStorage:', e);
        userPresets = [];
    }
}

function saveUserPresetsToStorage() {
    localStorage.setItem(USER_PRESET_STORAGE_KEY, JSON.stringify(userPresets));
}

function addUserPreset(preset) {
    const item = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        addedAt: new Date().toISOString(),
        preset: {
            ...preset,
            bank: 'User'
        }
    };
    userPresets.push(item);
    saveUserPresetsToStorage();
    refreshPresetMenu();
    loadUserPreset(item.id);
}

function loadUserPreset(id) {
    const index = userPresets.findIndex((item) => item.id === id);
    if (index < 0) return;
    const item = userPresets[index];
    applyPreset(item.preset, `U${String(index + 1).padStart(2, '0')}`, 'user', id);
    fullSync();
}

function readPresetFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const preset = JSON.parse(String(reader.result));
            if (preset.format !== 'CrispyZebra' || !preset.global || !preset.line1 || !preset.line2) {
                throw new Error('Invalid CrispyZebra preset');
            }
            addUserPreset(preset);
        } catch (e) {
            console.error('[UserBank] load error:', e);
            document.getElementById('lcd-line2').textContent = 'Load error';
        }
    };
    reader.readAsText(file);
}

function openPresetFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (file) readPresetFile(file);
        input.remove();
    });
    input.click();
}

function updateWaveformSelector(prefix) {
    const state = ensureEgState(prefix);
    const buttons = document.querySelectorAll(`.waveform-window[data-eg-prefix="${prefix}"]`);
    buttons.forEach((btn, slot) => {
        const idx = state.waveforms[slot] ?? 0;
        btn.dataset.waveIndex = idx;
        btn.innerHTML = `<span class="wave-number">${idx + 1}</span>${waveformSvg(idx)}`;
    });
}

function loadPreset(index) {
    const padded = String(index).padStart(2, '0');
    const url = `${PRESET_PATH}${padded}.json?v=${PRESET_ASSET_VERSION}`;
    console.log('[loadPreset] fetching:', url);
    fetch(url, { cache: 'no-store' })
        .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
        .then(preset => {
            console.log('[loadPreset] loaded preset:', index);
            presetNameCache.set(index, {
                bank: preset.bank || '',
                category: preset.category || '',
                presetName: preset.presetName || padded
            });
            applyPreset(preset, index);
            fullSync();
        })
        .catch(err => {
            console.error('[loadPreset] error:', err);
            document.getElementById('lcd-line2').textContent = 'Load error';
        });
}

function applyPreset(preset, index, kind = 'factory', userId = null) {
    const g = preset.global;
    const l1 = preset.line1;
    const l2 = preset.line2;

    routingState.lineSelect = g.lineSelect.mode;
    document.querySelectorAll('.routing-line-btn').forEach((btn, i) => {
        const lamp = btn.closest('.btn-container').querySelector('.lamp');
        lamp.classList.toggle('is-active', i === g.lineSelect.mode);
    });

    routingState.detuneSign = g.detuneSign !== undefined ? g.detuneSign : (g.detuneNegative ? -1 : 1);
    document.querySelector('.routing-detune-down-btn').closest('.btn-container')
        .querySelector('.lamp').classList.toggle('is-active', routingState.detuneSign === -1);
    document.querySelector('.routing-detune-up-btn').closest('.btn-container')
        .querySelector('.lamp').classList.toggle('is-active', routingState.detuneSign === 1);

    routingState.detuneOctave = g.detune.octave;
    routingState.detuneNote = g.detune.note;
    routingState.detuneFine = g.detune.fine;
    setFaderById('detune-octave', g.detune.octave);
    setFaderById('detune-note', g.detune.note);
    setFaderById('detune-fine', g.detune.fine);

    if (g.master) {
        masterState.volume = g.master.volume ?? masterState.volume;
        masterState.octave = g.master.octave ?? g.lineSelect.octave;
        masterState.pan = g.master.pan ?? masterState.pan;
        masterState.drive = g.master.drive ?? masterState.drive;
        masterState.noteSemitone = g.master.noteSemitone ?? masterState.noteSemitone;
        masterState.fineTuning = g.master.fineTuning ?? masterState.fineTuning;
        masterState.portamentoEnabled = g.master.portamentoEnabled ?? masterState.portamentoEnabled;
        masterState.portamentoTime = g.master.portamentoTime ?? masterState.portamentoTime;
        masterState.pitchBendUp = g.master.pitchBendUp ?? masterState.pitchBendUp;
        masterState.pitchBendDown = g.master.pitchBendDown ?? masterState.pitchBendDown;
        setFaderById('master-volume', masterState.volume);
        setFaderById('master-octave', masterState.octave);
        setFaderById('master-pan', masterState.pan);
        setFaderById('master-drive', masterState.drive);
        setFaderById('master-note-semitone', masterState.noteSemitone);
        setFaderById('master-fine-tune', masterState.fineTuning);
        setFaderById('master-portamento-time', masterState.portamentoTime);
        setFaderById('master-pitch-bend-up', masterState.pitchBendUp);
        setFaderById('master-pitch-bend-down', masterState.pitchBendDown);
        document.getElementById('master-portamento-toggle')
            ?.closest('.btn-container')?.querySelector('.lamp')
            ?.classList.toggle('is-active', masterState.portamentoEnabled);
    } else {
        masterState.octave = g.lineSelect.octave;
        setFaderById('master-octave', g.lineSelect.octave);
    }

    const vibIdx = vibratoNameToIndex(g.vibratoWaveform);
    vibratoState.waveform = vibIdx;
    vibratoState.delay = g.vibratoDelay;
    vibratoState.rate = g.vibratoRate;
    vibratoState.depth = g.vibratoDepth;
    const vibBtn = document.getElementById('vibrato-waveform');
    if (vibBtn) {
        vibBtn.dataset.waveIndex = vibIdx;
        vibBtn.innerHTML = `<span class="wave-number">${vibIdx + 1}</span>${waveformSvg(vibIdx, true)}`;
    }
    setFaderById('vibrato-delay', g.vibratoDelay);
    setFaderById('vibrato-rate', g.vibratoRate);
    setFaderById('vibrato-depth', g.vibratoDepth);

    routingState.ring = l1.ringModulation;
    routingState.noise = l1.noiseModulation;
    document.querySelectorAll('.routing-mod-btn').forEach(btn => {
        const lamp = btn.closest('.btn-container').querySelector('.lamp');
        const modType = btn.dataset.modType;
        lamp.classList.toggle('is-active', routingState[modType]);
    });

    applyLinePreset('1', l1);
    applyLinePreset('2', l2);

    const name = (preset.presetName || String(index).padStart(2, '0')) + '';
    currentPresetMeta = {
        bank: preset.bank || 'Factory',
        category: preset.category || '',
        presetName: name
    };
        document.getElementById('lcd-line1').textContent = ((preset.bank || '') + '/' + (preset.category || '')).slice(0, 20);
    document.getElementById('lcd-line2').textContent = ( index+ '/' + name + '                   ').slice(0, 20);


    ['dco1', 'dcw1', 'dca1', 'dco2', 'dcw2', 'dca2'].forEach(prefix => {
        updateEgStageMarkers(prefix);
        drawEg(prefix);
    });

    currentPresetKind = kind;
    currentUserPresetId = userId;
    if (kind === 'factory') currentPresetIndex = index;
}

function applyLinePreset(suffix, line) {
    ['dco', 'dcw', 'dca'].forEach(type => {
        const prefix = type + suffix;
        const state = ensureEgState(prefix);
        const egKey = type + 'EG';
        const egArray = line[egKey];
        if (!egArray) return;

        egArray.forEach((stage, i) => {
            if (i < 8) {
                state.rates[i] = stage.rate;
                state.levels[i] = stage.level;
            }
        });

        const epKey = type + 'EndPoint';
        let ep = line[epKey];
        if (ep === undefined || ep === null || ep === 0) ep = 8;
        state.endPoint = ep;
        if (ep < 8) state.levels[ep] = 0;

        // Sustain point: read from EG stages for all types
        const susStage = egArray.findIndex(s => s.sustain === true);
        state.sustainPoint = susStage >= 0 ? susStage + 1 : ep;

        const kfKey = type + 'KeyFollow';
        if (line[kfKey] !== undefined) {
            state.keyFollow = line[kfKey];
        }

        if (type === 'dco') {
            if (line.wave1) state.waveforms[0] = waveNameToIndex(line.wave1);
            if (line.wave2 && line.wave2 !== 'NONE') state.waveforms[1] = waveNameToIndex(line.wave2);
        }
    });

    ['dco', 'dcw', 'dca'].forEach(type => {
        const prefix = type + suffix;
        const state = ensureEgState(prefix);

        for (let i = 0; i < 8; i++) {
            setFaderById(prefix + '-eg-' + (i + 1) + '-rate', state.rates[i]);
            setFaderById(prefix + '-eg-' + (i + 1) + '-level', state.levels[i]);
        }

        setFaderById(prefix + '-sustain-point', state.sustainPoint);
        setFaderById(prefix + '-end-point', state.endPoint);
        if (type !== 'dco') {
            setFaderById(prefix + '-key-follow', state.keyFollow);
        }

        if (type === 'dco') {
            updateWaveformSelector(prefix);
        }
    });
}

function buildEgJson(state) {
    return state.rates.map((rate, i) => ({
        rate,
        level: state.levels[i],
        sustain: i === state.sustainPoint - 1
    }));
}

function buildLineJson(suffix) {
    const dco = ensureEgState(`dco${suffix}`);
    const dcw = ensureEgState(`dcw${suffix}`);
    const dca = ensureEgState(`dca${suffix}`);
    const line = {
        wave1: waveformIndexToName(dco.waveforms[0] ?? 0),
        wave2: waveformIndexToName(dco.waveforms[1] ?? dco.waveforms[0] ?? 0),
        dcaKeyFollow: dca.keyFollow,
        dcwKeyFollow: dcw.keyFollow,
        dcaEndPoint: dca.endPoint,
        dcaEG: buildEgJson(dca),
        dcaSustainPoint: dca.sustainPoint - 1,
        dcwEndPoint: dcw.endPoint,
        dcwEG: buildEgJson(dcw),
        dcwSustainPoint: dcw.sustainPoint - 1,
        dcoEndPoint: dco.endPoint,
        dcoEG: buildEgJson(dco),
        dcoSustainPoint: dco.sustainPoint - 1
    };

    if (suffix === '1') {
        line.ringModulation = routingState.ring;
        line.noiseModulation = routingState.noise;
    }

    return line;
}

function buildCurrentPresetJson() {
    return {
        format: 'CrispyZebra',
        version: '1.0',
        bank: currentPresetMeta.bank || 'User',
        category: currentPresetMeta.category || 'User',
        presetName: currentPresetMeta.presetName || String(currentPresetIndex).padStart(2, '0'),
        global: {
            lineSelect: {
                mode: routingState.lineSelect,
                octave: masterState.octave
            },
            master: {
                volume: masterState.volume,
                octave: masterState.octave,
                pan: masterState.pan,
                drive: masterState.drive,
                noteSemitone: masterState.noteSemitone,
                fineTuning: masterState.fineTuning,
                portamentoEnabled: masterState.portamentoEnabled,
                portamentoTime: masterState.portamentoTime,
                pitchBendUp: masterState.pitchBendUp,
                pitchBendDown: masterState.pitchBendDown
            },
            detuneNegative: routingState.detuneSign < 0,
            detuneSign: routingState.detuneSign,
            detune: {
                fine: routingState.detuneFine,
                note: routingState.detuneNote,
                octave: routingState.detuneOctave
            },
            vibratoWaveform: vibratoIndexToName(vibratoState.waveform),
            vibratoDelay: vibratoState.delay,
            vibratoRate: vibratoState.rate,
            vibratoDepth: vibratoState.depth
        },
        line1: buildLineJson('1'),
        line2: buildLineJson('2')
    };
}

function safeFilenamePart(value) {
    return String(value || 'preset')
        .trim()
        .replace(/[^a-z0-9._-]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'preset';
}

function downloadCurrentPreset() {
    const preset = buildCurrentPresetJson();
    const json = JSON.stringify(preset, null, 2) + '\n';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const number = currentPresetKind === 'user'
        ? 'USER'
        : String(currentPresetIndex).padStart(2, '0');
    const link = document.createElement('a');
    link.href = url;
    link.download = `${number}_${safeFilenamePart(preset.presetName)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function closePresetMenu() {
    const menu = document.getElementById('presetMenu');
    const lcd = document.getElementById('preset-lcd');
    if (!menu) return;
    menu.classList.remove('is-visible');
    if (lcd) lcd.setAttribute('aria-expanded', 'false');
}

function setActivePresetBank(bank) {
    const key = String(bank);
    document.querySelectorAll('.preset-bank-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.bank === key);
    });
    document.querySelectorAll('.preset-bank-panel').forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.bank === key);
    });
    if (key !== 'user') loadPresetBankLabels(Number(bank));
}

function renderPresetMenu() {
    const menu = document.getElementById('presetMenu');
    if (!menu || menu.dataset.ready === 'true') return;

    const bankList = document.createElement('div');
    bankList.className = 'preset-bank-list';
    const panelList = document.createElement('div');
    panelList.className = 'preset-panel-list';

    for (let bank = 0; bank < 10; bank++) {
        const start = bank * 10;
        const bankBtn = document.createElement('button');
        bankBtn.type = 'button';
        bankBtn.className = 'preset-bank-btn';
        bankBtn.dataset.bank = bank;
        bankBtn.textContent = `BANK ${String(start).padStart(2, '0')}-${String(start + 9).padStart(2, '0')}`;
        bankBtn.addEventListener('mouseenter', () => setActivePresetBank(bank));
        bankBtn.addEventListener('click', () => setActivePresetBank(bank));
        bankList.appendChild(bankBtn);

        const panel = document.createElement('div');
        panel.className = 'preset-bank-panel';
        panel.dataset.bank = bank;
        for (let slot = 0; slot < 10; slot++) {
            const index = start + slot;
            const presetBtn = document.createElement('button');
            presetBtn.type = 'button';
            presetBtn.className = 'preset-menu-item';
            presetBtn.dataset.presetIndex = index;
            presetBtn.textContent = String(index).padStart(2, '0');
            presetBtn.addEventListener('click', () => {
                closePresetMenu();
                loadPreset(index);
            });
            panel.appendChild(presetBtn);
        }
        panelList.appendChild(panel);
    }

    const userBankBtn = document.createElement('button');
    userBankBtn.type = 'button';
    userBankBtn.className = 'preset-bank-btn';
    userBankBtn.dataset.bank = 'user';
    userBankBtn.textContent = 'USER BANK';
    userBankBtn.addEventListener('mouseenter', () => setActivePresetBank('user'));
    userBankBtn.addEventListener('click', () => setActivePresetBank('user'));
    bankList.appendChild(userBankBtn);

    const userPanel = document.createElement('div');
    userPanel.className = 'preset-bank-panel';
    userPanel.dataset.bank = 'user';
    panelList.appendChild(userPanel);

    menu.appendChild(bankList);
    menu.appendChild(panelList);
    menu.dataset.ready = 'true';
    updateUserPresetMenu();
}

function refreshPresetMenu() {
    const menu = document.getElementById('presetMenu');
    if (!menu) return;
    menu.innerHTML = '';
    menu.dataset.ready = 'false';
    renderPresetMenu();
}

function updateUserPresetMenu() {
    const panel = document.querySelector('.preset-bank-panel[data-bank="user"]');
    if (!panel) return;
    panel.innerHTML = '';

    if (!userPresets.length) {
        const empty = document.createElement('div');
        empty.className = 'preset-menu-empty';
        empty.textContent = 'LOAD JSON TO ADD';
        panel.appendChild(empty);
        return;
    }

    userPresets.forEach((item, index) => {
        const presetBtn = document.createElement('button');
        presetBtn.type = 'button';
        presetBtn.className = 'preset-menu-item';
        presetBtn.dataset.userPresetId = item.id;
        presetBtn.textContent = `U${String(index + 1).padStart(2, '0')} ${item.preset.presetName || 'User Preset'}`;
        presetBtn.addEventListener('click', () => {
            closePresetMenu();
            loadUserPreset(item.id);
        });
        panel.appendChild(presetBtn);
    });
}

function updatePresetMenuLabels() {
    presetNameCache.forEach((meta, index) => {
        const btn = document.querySelector(`.preset-menu-item[data-preset-index="${index}"]`);
        if (!btn) return;
        btn.textContent = `${String(index).padStart(2, '0')} ${meta.presetName || ''}`.trim();
    });
}

function loadPresetBankLabels(bank) {
    const requests = [];
    for (let slot = 0; slot < 10; slot++) {
        const index = bank * 10 + slot;
        if (presetNameCache.has(index)) continue;
        const padded = String(index).padStart(2, '0');
        requests.push(
            fetch(`${PRESET_PATH}${padded}.json?v=${PRESET_ASSET_VERSION}`, { cache: 'no-store' })
                .then((res) => res.ok ? res.json() : null)
                .then((preset) => {
                    if (!preset) return;
                    presetNameCache.set(index, {
                        bank: preset.bank || '',
                        category: preset.category || '',
                        presetName: preset.presetName || padded
                    });
                })
                .catch(() => {})
        );
    }
    if (requests.length) Promise.all(requests).then(updatePresetMenuLabels);
    else updatePresetMenuLabels();
}

function openPresetMenu() {
    const lcd = document.getElementById('preset-lcd');
    const menu = document.getElementById('presetMenu');
    if (!lcd || !menu) return;
    renderPresetMenu();
    menu.classList.add('is-visible');
    lcd.setAttribute('aria-expanded', 'true');
    const rect = lcd.getBoundingClientRect();
    const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${rect.bottom + 10}px`;
    setActivePresetBank(currentPresetKind === 'user' ? 'user' : Math.floor(currentPresetIndex / 10));
}

function togglePresetMenu() {
    const menu = document.getElementById('presetMenu');
    if (menu?.classList.contains('is-visible')) closePresetMenu();
    else openPresetMenu();
}

function initPresetMenu() {
    const lcd = document.getElementById('preset-lcd');
    if (!lcd) return;
    lcd.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePresetMenu();
    });
    lcd.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        togglePresetMenu();
    });
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('presetMenu');
        if (!menu?.classList.contains('is-visible')) return;
        if (menu.contains(e.target) || lcd.contains(e.target)) return;
        closePresetMenu();
    });
    window.addEventListener('resize', closePresetMenu);
}

function initPresetButtons() {
    const prevBtn = document.querySelector('.preset-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        const next = (currentPresetIndex - 1 + PRESET_COUNT) % PRESET_COUNT;
        loadPreset(next);
    });

    const nextBtn = document.querySelector('.preset-next');
    if (nextBtn) nextBtn.addEventListener('click', () => {
        const next = (currentPresetIndex + 1) % PRESET_COUNT;
        loadPreset(next);
    });

    const loadBtn = document.querySelector('.preset-load');
    if (loadBtn) {
        loadBtn.addEventListener('click', openPresetFilePicker);
    }

    const saveBtn = document.querySelector('.preset-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', downloadCurrentPreset);
    }
}

// ─── Keyboard Bindings ───
const KEY_MAP = {
    'a': 60, 'w': 61, 's': 62, 'e': 63, 'd': 64,
    'f': 65, 't': 66, 'g': 67, 'y': 68, 'h': 69,
    'u': 70, 'j': 71, 'k': 72
};

document.addEventListener('keydown', e => {
    if (e.repeat) return;
    const n = KEY_MAP[e.key];
    if (n && !kbNotes.has(n)) {
        e.preventDefault();
        console.log('[keydown]', e.key, '→ note', n);
        kbNotes.add(n);
        nOn(n);
    }
});

document.addEventListener('keyup', e => {
    const n = KEY_MAP[e.key];
    if (n && kbNotes.has(n)) {
        kbNotes.delete(n);
        nOff(n);
    }
});

// ─── Init UI ───
document.querySelectorAll('[data-horizontal-bank]').forEach((bank) => {
    const egPrefix = bank.dataset.egPrefix;
    bank.appendChild(createTopControlFader(egPrefix, horizontalControls[0], 'is-half'));
    bank.appendChild(createTopControlFader(egPrefix, horizontalControls[1], 'is-half'));
    bank.appendChild(createEgCanvas(egPrefix));
    bank.appendChild(egPrefix.startsWith('dco') ? createWaveformSelector(egPrefix) : createTopControlFader(egPrefix, horizontalControls[2], 'is-half'));
});


document.querySelectorAll('[data-fader-bank]').forEach(bank => {
  

  const rateHeader = document.createElement('div'); 
  rateHeader.className = 'panel-fader-bank-header-rate'; 
  rateHeader.textContent = 'RATE';
  

  const levelHeader = document.createElement('div');
  levelHeader.className = 'panel-fader-bank-header-level';
  levelHeader.textContent = 'LEVEL';
  


  bank.append(rateHeader);
  bank.append(levelHeader);

});

document.querySelectorAll('[data-fader-bank]').forEach((bank) => {
    const egPrefix = bank.dataset.egPrefix;
    for (let i = 0; i < faderCount; i += 1) {
        bank.appendChild(createEgStage(egPrefix, i + 1));
    }
});

initVibratoPanel();
initRoutingPanel();
initMasterPanel();
initDetunePanel();
initAppearanceButton();
initMidiButton();
initAboutModal();
loadUserPresetsFromStorage();
initPresetButtons();
initPresetMenu();

// Start button
document.getElementById('start-overlay')?.addEventListener('click', initAudio);

document.querySelectorAll('.fader-well').forEach((well) => {
    const knob = well.querySelector('.fader-knob');
    knob.addEventListener('pointerdown', (e) => {
        if (isControlDisabled(knob)) {
            e.preventDefault();
            return;
        }
        activeFader = { well, knob };
        knob.setPointerCapture(e.pointerId);
        document.body.style.cursor = 'grabbing';
        activePointer = { x: e.clientX, y: e.clientY };
        updateFaderPosition(activeFader, e.clientX, e.clientY);
        showPopover(knob, e.clientX, e.clientY);
        e.preventDefault();
    });
});

document.addEventListener('pointermove', (e) => {
    activePointer = { x: e.clientX, y: e.clientY };
    if (!activeFader) return;
    updateFaderPosition(activeFader, e.clientX, e.clientY);
    showPopover(activeFader.knob, e.clientX, e.clientY);
});

document.addEventListener('pointerup', () => {
    activeFader = null;
    document.body.style.cursor = 'default';
    valuePopover.classList.remove('is-visible');
});

document.addEventListener('pointerdown', (e) => {
    const catalog = document.getElementById('waveformCatalog');
    if (!catalog.classList.contains('is-visible')) return;
    if (catalog.contains(e.target) || e.target.closest('.waveform-window')) return;
    closeWaveformCatalog();
});

window.addEventListener('resize', () => {
    Object.keys(egStates).forEach(drawEg);
});

requestAnimationFrame(() => {
    document.querySelectorAll('.fader-knob').forEach((knob) => {
        setFaderToValue(knob, knob.dataset.controlValue);
    });
    Object.keys(egStates).forEach(updateEgStageMarkers);
    Object.keys(egStates).forEach(drawEg);
    loadPreset(0);
});
