/**
 * Athena Tools Hub — FASE 5: worker de análise estática (execução isolada).
 *
 * Corre SEMPRE dentro do sandbox (lib/re/sandbox.ts): diretório descartável,
 * ulimits, ambiente mínimo, sem rede. Usa apenas builtins do Node
 * (fs/crypto/zlib/path/url) — nenhuma API de rede existe neste ficheiro
 * (verificado por teste estático em lib/re/sandbox.test.ts).
 *
 * Uso: node analyze.mjs <inputPath> <outputPath> <limitsPath>
 *   limitsPath: JSON { maxStrings, minStringLength, maxStringsBytes, maxExtractedBytes }
 *   outputPath: report JSON (contrato WorkerReport em lib/re/types.ts)
 *
 * NUNCA executa o artefacto: só lê bytes (análise estática).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [inputPath, outputPath, limitsPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !limitsPath) {
  console.error("uso: node analyze.mjs <inputPath> <outputPath> <limitsPath>");
  process.exit(2);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SIGNATURES = JSON.parse(readFileSync(join(HERE, "signatures.json"), "utf8"));
const LIMITS = JSON.parse(readFileSync(limitsPath, "utf8"));
const bytes = readFileSync(inputPath);
const warnings = [];

/* ---------------- utilidades ---------------- */

function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
function u32be(b, o) { return (((b[o] << 8 | b[o + 1]) << 8 | b[o + 2]) << 8 | b[o + 3]) >>> 0; }
function ascii(b, o, len) { return Buffer.from(b.subarray(o, o + len)).toString("latin1"); }

function matchesMagic(b, hex, offset) {
  if (b.length < offset + hex.length / 2) return false;
  for (let i = 0; i < hex.length; i += 2) {
    if (b[offset + i / 2] !== parseInt(hex.slice(i, i + 2), 16)) return false;
  }
  return true;
}

function detectKind(b) {
  const binary = SIGNATURES.filter((s) => s.magicHex)
    .sort((x, y) => y.magicHex.length - x.magicHex.length);
  for (const s of binary) {
    if (matchesMagic(b, s.magicHex, s.offset || 0)) return { kind: s.kind, mime: s.mime };
  }
  // sniffing de texto
  const sample = b.subarray(0, Math.min(b.length, 8192));
  let bad = 0;
  for (const c of sample) {
    if (c === 0 || (c < 9) || (c > 13 && c < 32)) bad++;
  }
  if (sample.length > 0 && bad / sample.length < 0.05) {
    const head = ascii(b, 0, Math.min(b.length, 512)).trimStart().toLowerCase();
    if (head.startsWith("{") || head.startsWith("[")) return { kind: "json", mime: "application/json" };
    if (head.startsWith("<")) {
      return head.includes("<html")
        ? { kind: "html", mime: "text/html" }
        : { kind: "xml", mime: "application/xml" };
    }
    return { kind: "text", mime: "text/plain" };
  }
  return { kind: "unknown", mime: "application/octet-stream" };
}

function sha256Hex(b) { return createHash("sha256").update(b).digest("hex"); }

function entropy(b) {
  if (b.length === 0) return 0;
  const freq = new Array(256).fill(0);
  for (const c of b) freq[c]++;
  let h = 0;
  for (const f of freq) {
    if (f === 0) continue;
    const p = f / b.length;
    h -= p * Math.log2(p);
  }
  return Math.round(h * 1000) / 1000;
}

function extractStrings(b, minLen, maxCount, maxBytes) {
  const out = [];
  let cur = [];
  let totalBytes = 0;
  let total = 0;
  let truncated = false;
  const flush = () => {
    if (cur.length >= minLen) {
      // Aceita UTF-8 (texto pt-BR): bytes >= 0x80 fazem parte da run e a
      // decodificação rejeita sequências inválidas (U+FFFD).
      const s = Buffer.from(cur).toString("utf8");
      if (!s.includes("�")) {
        total++;
        if (out.length < maxCount && totalBytes < maxBytes) {
          out.push(s);
          totalBytes += Buffer.byteLength(s, "utf8");
        } else {
          truncated = true;
        }
      }
    }
    cur = [];
  };
  for (const c of b) {
    if ((c >= 0x20 && c <= 0x7e) || c >= 0x80) cur.push(c);
    else flush();
  }
  flush();
  return { total, truncated, sample: out };
}

/* ---------------- parsers de formato (estáticos) ---------------- */

function parseZip(b) {
  const structure = {};
  const dependencies = [];
  const entries = [];
  // localizar EOCD (últimos 64KB + 22)
  let eocd = -1;
  const scanFrom = Math.max(0, b.length - 65536 - 22);
  for (let i = b.length - 22; i >= scanFrom; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) { warnings.push("zip: EOCD não encontrado (arquivo possivelmente truncado)"); return { structure, dependencies }; }
  const cdCount = u16le(b, eocd + 10);
  const cdOffset = u32le(b, eocd + 16);
  structure.zip_entries = cdCount;
  let off = cdOffset;
  const names = [];
  for (let n = 0; n < cdCount; n++) {
    if (off + 46 > b.length) { warnings.push("zip: diretório central truncado"); break; }
    if (!(b[off] === 0x50 && b[off + 1] === 0x4b && b[off + 2] === 0x01 && b[off + 3] === 0x02)) {
      warnings.push("zip: assinatura de entrada do diretório central inválida"); break;
    }
    const method = u16le(b, off + 10);
    const compSize = u32le(b, off + 20);
    const uncompSize = u32le(b, off + 24);
    const nameLen = u16le(b, off + 28);
    const extraLen = u16le(b, off + 30);
    const commentLen = u16le(b, off + 32);
    const localOff = u32le(b, off + 42);
    const name = ascii(b, off + 46, nameLen);
    names.push(name);
    entries.push({ name, method, compSize, uncompSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  structure.zip_entry_names = names.slice(0, 200);
  if (names.length > 200) warnings.push("zip: lista de entradas truncada em 200");

  // extrair manifestos de dependências (pequenos, sem path traversal)
  for (const e of entries) {
    const lower = e.name.toLowerCase();
    const isManifest = lower.endsWith("package.json") || lower.endsWith("requirements.txt") || lower.endsWith("pom.xml");
    if (!isManifest || e.uncompSize > 65536 || e.name.includes("..")) continue;
    try {
      const data = readZipEntry(b, e);
      if (!data) continue;
      const text = Buffer.from(data).toString("utf8");
      if (lower.endsWith("package.json")) {
        const pkg = JSON.parse(text);
        for (const k of Object.keys(pkg.dependencies || {})) dependencies.push(`npm:${k}`);
        for (const k of Object.keys(pkg.devDependencies || {})) dependencies.push(`npm(dev):${k}`);
      } else if (lower.endsWith("requirements.txt")) {
        for (const line of text.split("\n")) {
          const clean = line.trim().split(/[=<>!;\s#]/)[0].trim();
          if (clean) dependencies.push(`pip:${clean}`);
        }
      } else if (lower.endsWith("pom.xml")) {
        const re = /<artifactId>([^<]+)<\/artifactId>/g;
        let m; let count = 0;
        while ((m = re.exec(text)) && count++ < 100) dependencies.push(`maven:${m[1]}`);
      }
    } catch {
      warnings.push(`zip: não foi possível ler manifesto ${e.name}`);
    }
  }
  return { structure, dependencies: [...new Set(dependencies)].slice(0, 500) };
}

function readZipEntry(b, e) {
  const o = e.localOff;
  if (o + 30 > b.length) return null;
  if (!(b[o] === 0x50 && b[o + 1] === 0x4b && b[o + 2] === 0x03 && b[o + 3] === 0x04)) return null;
  const flags = u16le(b, o + 8);
  if (flags & 0x08) return null; // data descriptor: localização incerta
  const method = u16le(b, o + 10);
  const compSize = u32le(b, o + 18);
  const nameLen = u16le(b, o + 26);
  const extraLen = u16le(b, o + 28);
  const start = o + 30 + nameLen + extraLen;
  if (start + compSize > b.length) return null;
  const data = b.subarray(start, start + compSize);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  return null;
}

const PE_MACHINES = { 0x14c: "i386", 0x8664: "x86-64", 0xaa64: "arm64", 0x1c0: "arm", 0x284: "arm64 (old)" };
function parsePe(b) {
  const structure = {};
  if (b.length < 64) return structure;
  const peOff = u32le(b, 0x3c);
  if (peOff + 24 > b.length || ascii(b, peOff, 4) !== "PE\0\0") {
    warnings.push("pe: cabeçalho PE não encontrado após e_lfanew"); return structure;
  }
  const machine = u16le(b, peOff + 4);
  const sections = u16le(b, peOff + 6);
  const chars = u16le(b, peOff + 22);
  structure.pe_machine = PE_MACHINES[machine] || `desconhecida (0x${machine.toString(16)})`;
  structure.pe_sections = sections;
  structure.pe_is_dll = Boolean(chars & 0x2000);
  structure.pe_is_executable = Boolean(chars & 0x0002);
  return structure;
}

const ELF_MACHINES = { 3: "i386", 62: "x86-64", 40: "arm", 183: "arm64", 8: "mips" };
const ELF_TYPES = { 0: "none", 1: "relocatable", 2: "executable", 3: "shared-object", 4: "core" };
function parseElf(b) {
  const structure = {};
  if (b.length < 64) return structure;
  const cls = b[4]; const data = b[5];
  structure.elf_class = cls === 1 ? "32-bit" : cls === 2 ? "64-bit" : `desconhecida (${cls})`;
  structure.elf_endianness = data === 1 ? "little" : data === 2 ? "big" : `desconhecida (${data})`;
  const be = data === 2;
  const type = be ? u16be(b, 16) : u16le(b, 16);
  const machine = be ? u16be(b, 18) : u16le(b, 18);
  structure.elf_type = ELF_TYPES[type] || `desconhecido (${type})`;
  structure.elf_machine = ELF_MACHINES[machine] || `desconhecida (${machine})`;
  return structure;
}

const MACHO_CPUS = { 7: "i386", 0x01000007: "x86-64", 0x0100000c: "arm64", 12: "arm" };
const MACHO_TYPES = { 1: "relocatable", 2: "execute", 3: "fvmlib", 4: "core", 5: "preloaded", 6: "dylib", 7: "dylinker", 8: "bundle" };
function parseMacho(b) {
  const structure = {};
  if (b.length < 32) return structure;
  // O magic é lido nas duas ordens: ficheiros reais 64-bit LE começam com
  // os bytes CF FA ED FE (leitura LE = 0xFEEDFACF).
  const le = u32le(b, 0);
  const be = u32be(b, 0);
  let bits = 0;
  let little = true;
  let fat = false;
  if (le === 0xfeedfacf) { bits = 64; little = true; }
  else if (le === 0xfeedface) { bits = 32; little = true; }
  else if (be === 0xfeedfacf) { bits = 64; little = false; }
  else if (be === 0xfeedface) { bits = 32; little = false; }
  else if (be === 0xcafebabe) { fat = true; }
  else { warnings.push("macho: magic não reconhecido"); return structure; }
  if (fat) {
    structure.macho_fat = true;
    return structure;
  }
  const cpu = little ? u32le(b, 4) : u32be(b, 4);
  const ftype = little ? u32le(b, 12) : u32be(b, 12);
  structure.macho_cpu = MACHO_CPUS[cpu] || `desconhecida (0x${cpu.toString(16)})`;
  structure.macho_filetype = MACHO_TYPES[ftype] || `desconhecido (${ftype})`;
  structure.macho_64bit = bits === 64;
  structure.macho_little_endian = little;
  return structure;
}

function parsePng(b) {
  const structure = {};
  if (b.length >= 29 && ascii(b, 12, 4) === "IHDR") {
    structure.png_width = u32be(b, 16);
    structure.png_height = u32be(b, 20);
    structure.png_bit_depth = b[24];
    structure.png_color_type = b[25];
  }
  return structure;
}

function parsePdf(b) {
  const structure = {};
  const head = ascii(b, 0, Math.min(b.length, 32));
  const m = head.match(/%PDF-(\d\.\d)/);
  if (m) structure.pdf_version = m[1];
  return structure;
}

function parseJs(b) {
  const structure = {};
  const text = Buffer.from(b.subarray(0, Math.min(b.length, 2 * 1024 * 1024))).toString("utf8");
  const patterns = [
    /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const found = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) && found.size < 200) found.add(m[1]);
  }
  structure.js_import_count = found.size;
  return { structure, dependencies: [...found] };
}

function parseJson(b) {
  const structure = {};
  try {
    const v = JSON.parse(Buffer.from(b).toString("utf8"));
    structure.json_valid = true;
    if (Array.isArray(v)) { structure.json_type = "array"; structure.json_length = v.length; }
    else if (v !== null && typeof v === "object") {
      structure.json_type = "object";
      structure.json_keys = Object.keys(v).length;
      structure.json_top_keys = Object.keys(v).slice(0, 20);
    } else { structure.json_type = typeof v; }
  } catch {
    structure.json_valid = false;
    warnings.push("json: conteúdo inválido (parse falhou)");
  }
  return structure;
}

/* ---------------- relatório ---------------- */

function main() {
  const detected = detectKind(bytes);
  const report = {
    kind: detected.kind,
    mime: detected.mime,
    sizeBytes: bytes.length,
    sha256: sha256Hex(bytes),
    entropy: entropy(bytes),
    strings: extractStrings(bytes, LIMITS.minStringLength || 4, LIMITS.maxStrings || 5000, LIMITS.maxStringsBytes || 1048576),
    structure: {},
    dependencies: [],
    metadata: { kind: detected.kind, mime: detected.mime },
    warnings,
  };
  report.metadata.high_entropy = report.entropy > 7.2;

  try {
    // kindHint (opcional, vindo do pipeline após validação anti-spoofing):
    // "text" com extensão .js/.mjs/.cjs usa o parser de JavaScript.
    const kindForParser = LIMITS.kindHint || detected.kind;
    switch (kindForParser) {
      case "zip": {
        const r = parseZip(bytes);
        Object.assign(report.structure, r.structure);
        report.dependencies.push(...r.dependencies);
        break;
      }
      case "pe": Object.assign(report.structure, parsePe(bytes)); break;
      case "elf": Object.assign(report.structure, parseElf(bytes)); break;
      case "macho": Object.assign(report.structure, parseMacho(bytes)); break;
      case "png": Object.assign(report.structure, parsePng(bytes)); break;
      case "pdf": Object.assign(report.structure, parsePdf(bytes)); break;
      case "javascript": {
        const r = parseJs(bytes);
        Object.assign(report.structure, r.structure);
        report.dependencies.push(...r.dependencies);
        break;
      }
      case "json": Object.assign(report.structure, parseJson(bytes)); break;
      default: break;
    }
  } catch (e) {
    warnings.push(`parser: falha parcial (${String(e && e.message || e).slice(0, 120)})`);
  }

  if (report.strings.truncated) warnings.push("strings: amostra truncada pelos limites");

  // teto do relatório
  const maxOut = LIMITS.maxExtractedBytes || 10 * 1024 * 1024;
  let json = JSON.stringify(report);
  let rounds = 0;
  while (json.length > maxOut && rounds < 3) {
    rounds++;
    report.strings.sample = report.strings.sample.slice(0, Math.max(0, Math.floor(report.strings.sample.length / 4)));
    report.dependencies = report.dependencies.slice(0, 100);
    warnings.push("relatório: conteúdo reduzido para caber em maxExtractedBytes");
    json = JSON.stringify(report);
  }

  writeFileSync(outputPath, json);
  console.log(`ok kind=${report.kind} sha256=${report.sha256.slice(0, 12)}…`);
}

main();
