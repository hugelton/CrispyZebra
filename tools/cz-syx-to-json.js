#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Casio CZ-101/CZ-230S SysEx to JSON Converter
 * Converts SysEx data to JSON according to the specification.
 *
 * Usage:
 *   node tools/cz-syx-to-json.js <input.syx> [output.json]
 *   node tools/cz-syx-to-json.js <input.syx> [output.json] --name "preset name" --category "category" --bank "bank"
 *   node tools/cz-syx-to-json.js --batch [--index index.txt]
 *   node tools/cz-syx-to-json.js --range 0-16 [--index index.txt]
 *
 * Batch injection uses a comma-separated index file format like:
 *   00,Brass Ens. 1,Brass,Factory
 * or the quoted index.txt format:
 *   00,"Brass Ens. 1","Brass","Factory"
 */

// SysEx header definition
const CASIO_ID = [0x44, 0x00, 0x00];
const MODEL_ID = 0x70;

// Vibrato waveform table
const VIBRATO_WAVE_TABLE = {
  0x08: 'TRIANGLE',
  0x04: 'SQUARE',
  0x20: 'SAW_UP',
  0x02: 'SAW_DOWN'
};

// Detune fine conversion table
const FINE_TABLE = [
  0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8,  // 0x00-0x0F
  8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15, 16, // 0x10-0x1F
  16, 17, 18, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, // 0x20-0x2F
  30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, // 0x30-0x3F
  45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60  // 0x40-0x4F
];

/**
 * Helper function to load and parse a preset index file.
 * Accepts either quoted index.txt format or comma-separated lines.
 */
function loadIndexFile(filePath = 'index.txt') {
  const indexMap = new Map();
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${filePath} not found, filling in names from filenames.`);
    return indexMap;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;

    // Parse format: 00,"Brass Ens. 1","Brass","Factory"
    let matches = line.match(/^(\d+),"([^"]+)","([^"]+)","([^"]+)"/);
    if (matches) {
      const [_, id, presetName, category, bank] = matches;
      indexMap.set(parseInt(id, 10), { presetName, category, bank });
      continue;
    }

    // Parse comma-separated format: 00,Brass Ens. 1,Brass,Factory
    const fields = line.split(',').map(part => part.trim().replace(/^"|"$/g, ''));
    if (fields.length >= 4 && /^\d+$/.test(fields[0])) {
      const [id, presetName, category, bank] = fields;
      indexMap.set(parseInt(id, 10), { presetName, category, bank });
    }
  }
  return indexMap;
}

/**
 * Read a SysEx file
 */
function readSyxFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  // SysEx check
  if (buffer[0] !== 0xF0 || buffer[buffer.length - 1] !== 0xF7) {
    throw new Error('Invalid SysEx file');
  }

  // Header validation
  for (let i = 0; i < 3; i++) {
    if (buffer[i + 1] !== CASIO_ID[i]) {
      throw new Error('Not a Casio SysEx file');
    }
  }

  if ((buffer[4] & 0xF0) !== MODEL_ID) {
    throw new Error('Not a CZ-101/CZ-230S SysEx file');
  }

  return buffer;
}

/**
 * Reconstruct 128-byte patch data from 256 SysEx nibbles
 */
function decodeCZPatchBytes(buffer) {
  const start = 6;
  const end = buffer.length - 1;
  const nibbles = Array.from(buffer.slice(start, end));
  if (nibbles.length !== 256) {
    throw new Error(`Expected 256 nibbles, got ${nibbles.length}`);
  }
  const patch = [];
  for (let i = 0; i < nibbles.length; i += 2) {
    patch.push((nibbles[i] & 0x0F) | ((nibbles[i + 1] & 0x0F) << 4));
  }
  return Buffer.from(patch);
}

/**
 * Section 1: PFLAG (Line Select & Octave)
 */
function parsePFLAG(data) {
  const pflag = data;
  const mode = pflag & 0x03;
  const octaveBits = (pflag >> 2) & 0x03;

  let octave = 0;
  if (octaveBits === 0x01) octave = 1;
  else if (octaveBits === 0x02) octave = -1;

  return { mode, octave };
}

/**
 * Section 2: PDS (Detune Sign)
 */
function parsePDS(data) {
  return { negative: data === 0x01 };
}

/**
 * Section 3: PDETL/PDETH (Detune Fine & Note/Octave)
 */
function parseDetune(pdetl, pdeth) {
  const fine = FINE_TABLE[pdetl] || 0;
  const octave = Math.floor(pdeth / 12);
  const note = pdeth % 12;

  return { fine, note, octave };
}

/**
 * Section 4: PVK (Vibrato Waveform)
 */
function parseVibratoWaveform(pvk) {
  const waveform = VIBRATO_WAVE_TABLE[pvk] || 'TRIANGLE';
  return { vibratoWaveform: waveform };
}

/**
 * Section 5-7: Vibrato delay/rate/depth (use first byte from 3 bytes)
 */
function parseVibratoParam(byte1) {
  return byte1; // raw 0-99 value
}

/**
 * Section 8/17: Waveform setting (2 bytes)
 */
function parseWaveSetting(byte1, byte2) {
  const word = (byte1 << 8) | byte2;

  const firstCode = (word >> 13) & 0x07;
  const secondCode = (word >> 10) & 0x07;
  const secondEnabled = ((word >> 9) & 0x01) !== 0;
  const windowCode = (word >> 6) & 0x07;
  const modulation = (word >> 3) & 0x07;

  function decodeRezWindow(code) {
    if (code === 1) return 'RESO1';
    if (code === 2) return 'RESO2';
    if (code === 3) return 'RESO3';
    if (code === 4) return 'REZ_PULSE';
    if (code >= 5) return 'REZ_DBL_SAW';
    return 'RESO1';
  }

  function decodeWave(code, windowCode) {
    if (code === 0) return 'SAW';
    if (code === 1) return 'SQUARE';
    if (code === 2) return 'PULSE';
    if (code === 3) return 'NULL_WAVE';
    if (code === 4) return 'DBL_SINE';
    if (code === 5) return 'SAW_PULSE';
    if (code === 6) return decodeRezWindow(windowCode);
    if (code === 7) return 'PULSE2';
    return 'UNKNOWN';
  }

  return {
    wave1: decodeWave(firstCode, windowCode),
    wave2: secondEnabled ? decodeWave(secondCode, windowCode) : 'NONE',
    ringModulation: modulation === 4,
    noiseModulation: modulation === 3,
    raw: { byte1, byte2, word, firstCode, secondCode, secondEnabled, windowCode, modulation }
  };
}

/**
 * Section 9/10/18/19: Key follow (use first byte from 2 bytes)
 */
function parseKeyFollow(byte1) {
  return byte1; // 0-9 value
}

/**
 * Section 11/13/15/20/22/24: End point (00..07)
 */
function parseEndPoint(byte) {
  return byte & 0x07; // clear garbage bits
}

/**
 * Linear mapping: 0..maxByte → 0..99
 * byte >= maxByte clamps to 99
 */
function decodeLinear99(byte, maxByte) {
  byte &= 0x7F;
  if (byte === 0) return 0;
  if (byte >= maxByte) return 99;
  return Math.floor((99 * byte) / maxByte) + 1;
}

/**
 * Section 12/21: Parse DCA EG
 */
function parseDCAEG(data) {
  const stages = [];
  let sustainPoint = -1;

  for (let i = 0; i < 8; i++) {
    const hasSustain = (data[i * 2 + 1] & 0x80) !== 0;
    if (hasSustain) sustainPoint = i;

    const rateByte = data[i * 2] & 0x7F;
    const levelByte = data[i * 2 + 1] & 0x7F;

    const rate = decodeLinear99(rateByte, 0x77);
    const level = decodeLinear99(levelByte, 0x7F);

    stages.push({ rate, level, sustain: hasSustain });
  }
  return { stages, sustainPoint };
}

/**
 * Section 14/23: Parse DCW EG (with sustain flag)
 */
function parseDCWEG(data) {
  const stages = [];
  let sustainPoint = -1;

  for (let i = 0; i < 8; i++) {
    const rawRate = data[i * 2];
    const rawLevel = data[i * 2 + 1];

    const hasSustain = (rawLevel & 0x80) !== 0;
    if (hasSustain) sustainPoint = i;

    const rateByte = rawRate & 0x7F;
    const levelByte = rawLevel & 0x7F;

    // DCW rate/level:
    // byte 0x08 = 0, byte 0x77 = 99
    // 0x00..0x07 are invalid/unused normal values, preserve raw
  const decodeDCW99 = (byte) => {
  if (byte === 0x00) return 0; // commonly appears in real data
  if (byte === 0x08) return 0; // documented zero
  if (byte >= 0x77) return 99;
  if (byte > 0x08) return Math.floor((99 * (byte - 0x08)) / (0x77 - 0x08)) + 1;
  return 0;
};

    stages.push({
      rate: decodeDCW99(rateByte),
      level: decodeDCW99(levelByte),
      sustain: hasSustain,
      raw: {
        rate: rawRate,
        level: rawLevel,
        rateValue: rateByte,
        levelValue: levelByte
      }
    });
  }

  return { stages, sustainPoint };
}

/**
 * Section 16/25: Parse DCO EG
 */
function parseDCOEG(data) {
  const stages = [];
  let sustainPoint = -1;

  for (let i = 0; i < 8; i++) {
    const hasSustain = (data[i * 2 + 1] & 0x80) !== 0;
    if (hasSustain) sustainPoint = i;

    const rateByte = data[i * 2] & 0x7F;
    const levelByte = data[i * 2 + 1] & 0x7F;

    const rate = rateByte === 0 ? 0 : (rateByte === 0x7F ? 99 : Math.floor((99 * rateByte) / 127) + 1);

    let level;
    if (levelByte <= 0x3F) {
      level = levelByte;
    } else if (levelByte >= 0x44 && levelByte <= 0x67) {
      level = levelByte - 0x44 + 64;
    } else {
      level = 99;
    }
    stages.push({ rate, level, sustain: hasSustain });
  }
  return { stages, sustainPoint };
}

/**
 * Parse entire SysEx data and convert it to JSON
 */
function parseSyxToJSON(buffer, presetName = 'Unknown', category = 'Factory', bank = 'Factory') {
  buffer = decodeCZPatchBytes(buffer);
  let offset = 0;

  const result = {
    format: 'CrispyZebra',
    version: '1.0',
    bank: bank,
    category: category,
    presetName: presetName,
    global: {},
    line1: {},
    line2: {}
  };

  // Section 1: PFLAG
  result.global.lineSelect = parsePFLAG(buffer[offset++]);

  // Section 2: PDS
  const pds = parsePDS(buffer[offset++]);
  result.global.detuneNegative = pds.negative;

  // Section 3: PDETL/PDETH
  const detune = parseDetune(buffer[offset], buffer[offset + 1]);
  result.global.detune = {
    fine: detune.fine,
    note: detune.note,
    octave: detune.octave
  };
  offset += 2;

  // Section 4: PVK
  const vibWave = parseVibratoWaveform(buffer[offset++]);
  result.global.vibratoWaveform = vibWave.vibratoWaveform;

  // Section 5: PVDLD/PVDLV (3 bytes)
  result.global.vibratoDelay = parseVibratoParam(buffer[offset]);
  offset += 3;

  // Section 6: PVSD/PVSV (3 bytes)
  result.global.vibratoRate = parseVibratoParam(buffer[offset]);
  offset += 3;

  // Section 7: PVDD/PVDV (3 bytes)
  result.global.vibratoDepth = parseVibratoParam(buffer[offset]);
  offset += 3;

  // === LINE 1 (Master) ===

  // Section 8: MFW (2 bytes)
  const l1Wave = parseWaveSetting(buffer[offset], buffer[offset + 1]);
  result.line1.wave1 = l1Wave.wave1;
  result.line1.wave2 = l1Wave.wave2;
  result.line1.ringModulation = l1Wave.ringModulation;
  result.line1.noiseModulation = l1Wave.noiseModulation;
  offset += 2;

  // Section 9: MAMD/MAMV (2 bytes)
  result.line1.dcaKeyFollow = parseKeyFollow(buffer[offset]);
  offset += 2;

  // Section 10: MWMD/MWMV (2 bytes)
  result.line1.dcwKeyFollow = parseKeyFollow(buffer[offset]);
  offset += 2;

  // Section 11: PMAL
  result.line1.dcaEndPoint = parseEndPoint(buffer[offset++]);

  // Section 12: PMA (16 bytes)
  const l1DCAEG = parseDCAEG(buffer.slice(offset, offset + 16));
  result.line1.dcaEG = l1DCAEG.stages;
  result.line1.dcaSustainPoint = l1DCAEG.sustainPoint;
  offset += 16;

  // Section 13: PMWL
  result.line1.dcwEndPoint = parseEndPoint(buffer[offset++]);

  // Section 14: PMW (16 bytes)
  const l1DCWEG = parseDCWEG(buffer.slice(offset, offset + 16));
  result.line1.dcwEG = l1DCWEG.stages;
  result.line1.dcwSustainPoint = l1DCWEG.sustainPoint;
  offset += 16;

  // Section 15: PMPL
  result.line1.dcoEndPoint = parseEndPoint(buffer[offset++]);

  // Section 16: PMP (16 bytes)
  const l1DCOEG = parseDCOEG(buffer.slice(offset, offset + 16));
  result.line1.dcoEG = l1DCOEG.stages;
  result.line1.dcoSustainPoint = l1DCOEG.sustainPoint;
  offset += 16;

  // === LINE 2 (Slave) ===

  // Section 17: SFW (2 bytes)
  const l2Wave = parseWaveSetting(buffer[offset], buffer[offset + 1]);
  result.line2.wave1 = l2Wave.wave1;
  result.line2.wave2 = l2Wave.wave2;
  offset += 2;

  // Section 18: SAMD (2 bytes)
  result.line2.dcaKeyFollow = parseKeyFollow(buffer[offset]);
  offset += 2;

  // Section 19: SWMD (2 bytes)
  result.line2.dcwKeyFollow = parseKeyFollow(buffer[offset]);
  offset += 2;

  // Section 20: PSAL
  result.line2.dcaEndPoint = parseEndPoint(buffer[offset++]);

  // Section 21: PSA (16 bytes)
  const l2DCAEG = parseDCAEG(buffer.slice(offset, offset + 16));
  result.line2.dcaEG = l2DCAEG.stages;
  result.line2.dcaSustainPoint = l2DCAEG.sustainPoint;
  offset += 16;

  // Section 22: PSWL
  result.line2.dcwEndPoint = parseEndPoint(buffer[offset++]);

  // Section 23: PSW (16 bytes)
  const l2DCWEG = parseDCWEG(buffer.slice(offset, offset + 16));
  result.line2.dcwEG = l2DCWEG.stages;
  result.line2.dcwSustainPoint = l2DCWEG.sustainPoint;
  offset += 16;

  // Section 24: PSPL
  result.line2.dcoEndPoint = parseEndPoint(buffer[offset++]);

  // Section 25: PSP (16 bytes)
  const l2DCOEG = parseDCOEG(buffer.slice(offset, offset + 16));
  result.line2.dcoEG = l2DCOEG.stages;
  result.line2.dcoSustainPoint = l2DCOEG.sustainPoint;
  offset += 16;

  return result;
}

/**
 * Main logic
 */
function parseArgs(argv) {
  const parsed = { positional: [], flags: {} };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === '--batch' || arg === '-b') {
      parsed.flags.batch = true;
      i++;
      continue;
    }

    if (arg === '--range' || arg === '-r') {
      parsed.flags.range = argv[i + 1];
      i += 2;
      continue;
    }

    if (arg === '--index' || arg === '-i') {
      parsed.flags.index = argv[i + 1];
      i += 2;
      continue;
    }

    if (arg === '--name') {
      parsed.flags.name = argv[i + 1];
      i += 2;
      continue;
    }

    if (arg === '--category') {
      parsed.flags.category = argv[i + 1];
      i += 2;
      continue;
    }

    if (arg === '--bank') {
      parsed.flags.bank = argv[i + 1];
      i += 2;
      continue;
    }

    parsed.positional.push(arg);
    i++;
  }

  return parsed;
}

function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (parsedArgs.flags.range) {
    const range = parsedArgs.flags.range;
    const [start, end] = range.split('-').map(n => parseInt(n, 10));
    if (!isNaN(start) && !isNaN(end)) {
      console.log(`Converting presets ${start}-${end}...\n`);
      const indexFile = parsedArgs.flags.index || 'index.txt';
      batchConvert(start, end, indexFile);
      return;
    }

    console.error('❌ Error: Invalid range specification');
    console.log('Usage: node tools/cz-syx-to-json.js --range 0-16 [--index index.txt]');
    process.exit(1);
  }

  if (parsedArgs.flags.batch) {
    const indexFile = parsedArgs.flags.index || 'index.txt';
    batchConvert(null, null, indexFile);
    return;
  }

  if (parsedArgs.positional.length < 1) {
    console.log('Usage: node tools/cz-syx-to-json.js <input.syx> [output.json] [--name "preset name"] [--category "category"] [--bank "bank"]');
    console.log('Example: node tools/cz-syx-to-json.js 00.syx 00.json --name "Brass Ens. 1" --category "Brass" --bank "Factory"');
    console.log('');
    console.log('Batch mode:');
    console.log('  node tools/cz-syx-to-json.js --batch [--index index.txt]');
    console.log('  node tools/cz-syx-to-json.js --range 0-16 [--index index.txt]');
    process.exit(1);
  }

  const inputFile = parsedArgs.positional[0];
  const outputFile = parsedArgs.positional[1] || inputFile.replace('.syx', '.json');
  const indexFile = parsedArgs.flags.index || 'index.txt';
  const indexMap = loadIndexFile(indexFile);

  try {
    console.log(`Reading SysEx file: ${inputFile}`);
    const buffer = readSyxFile(inputFile);

    const presetMatch = inputFile.match(/(\d+)\.syx$/);
    const presetNum = presetMatch ? parseInt(presetMatch[1], 10) : null;

    const presetIndex = presetMatch ? presetMatch[1].padStart(2, '0') : 'Unknown';
    let presetName = parsedArgs.flags.name || presetIndex;
    let category = parsedArgs.flags.category || 'Factory';
    let bank = parsedArgs.flags.bank || 'Factory';

    if (presetNum !== null && indexMap.has(presetNum)) {
      const info = indexMap.get(presetNum);
      if (!parsedArgs.flags.name) presetName = info.presetName;
      if (!parsedArgs.flags.category) category = info.category;
      if (!parsedArgs.flags.bank) bank = info.bank;
    }

    console.log('Converting to JSON...');
    const json = parseSyxToJSON(buffer, presetName, category, bank);

    fs.writeFileSync(outputFile, JSON.stringify(json, null, 2));

    console.log(`✅ Conversion complete: ${outputFile}`);
    console.log(`   - Preset: ${presetName}`);
    console.log(`   - Bank: ${bank} / Category: ${category}`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Batch processing mode
 */
function batchConvert(rangeStart = null, rangeEnd = null, indexFile = 'index.txt') {
  const indexMap = loadIndexFile(indexFile);
  let files = fs.readdirSync('.').filter(f => f.endsWith('.syx'));

  // filter if a range is specified
  if (rangeStart !== null && rangeEnd !== null) {
    files = files.filter(f => {
      const match = f.match(/(\d+)\.syx$/);
      if (match) {
        const num = parseInt(match[1], 10);
        return num >= rangeStart && num <= rangeEnd;
      }
      return false;
    });
    // sort numerically
    files.sort((a, b) => {
      const numA = parseInt(a.match(/(\d+)\.syx$/)[1], 10);
      const numB = parseInt(b.match(/(\d+)\.syx$/)[1], 10);
      return numA - numB;
    });
  }

  console.log(`Batch converting ${files.length} SysEx files...\n`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const buffer = readSyxFile(file);

      // extract preset number from filename
      const presetMatch = file.match(/(\d+)\.syx$/);
      const presetNum = presetMatch ? parseInt(presetMatch[1], 10) : null;

      let presetName = presetMatch ? presetMatch[1] : 'Unknown';
      let category = 'Factory';
      let bank = 'Factory';

      // inject matching data from index.txt
      if (presetNum !== null && indexMap.has(presetNum)) {
        const info = indexMap.get(presetNum);
        presetName = info.presetName;
        category = info.category;
        bank = info.bank;
      }

      const json = parseSyxToJSON(buffer, presetName, category, bank);
      const outputFile = file.replace('.syx', '.json');
      fs.writeFileSync(outputFile, JSON.stringify(json, null, 2));
      console.log(`✅ ${file} → ${outputFile} (Preset: ${presetName}, Category: ${category}, Bank: ${bank})`);
      success++;
    } catch (error) {
      console.error(`❌ ${file}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nCompleted: ${success} success, ${failed} failed`);
}

if (require.main === module) {
  main();
}

module.exports = { parseSyxToJSON, readSyxFile };
