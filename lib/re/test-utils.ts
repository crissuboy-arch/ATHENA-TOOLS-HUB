/**
 * Helpers de fixtures para os testes de lib/re.
 * Constrói bytes mínimos válidos de cada formato (só cabeçalhos/magic).
 */

export function u8(arr: number[]): Uint8Array {
  return new Uint8Array(arr);
}

export function pngBytes(): Uint8Array {
  return u8([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // assinatura
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR len + "IHDR"
    0x00, 0x00, 0x00, 0x40, // width 64
    0x00, 0x00, 0x00, 0x20, // height 32
    0x08, 0x02, 0x00, 0x00, 0x00, // bit depth, color type, ...
  ]);
}

export function jpegBytes(): Uint8Array {
  return u8([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

export function elfBytes(): Uint8Array {
  const b = new Uint8Array(64);
  b[0] = 0x7f; b[1] = 0x45; b[2] = 0x4c; b[3] = 0x46;
  b[4] = 2; b[5] = 1; b[6] = 1; // 64-bit, little-endian
  b[16] = 2; b[17] = 0; // ET_EXEC
  b[18] = 62; b[19] = 0; // x86-64
  return b;
}

export function peBytes(): Uint8Array {
  const b = new Uint8Array(256);
  b[0] = 0x4d; b[1] = 0x5a; // MZ
  b[0x3c] = 0x40; // e_lfanew -> 0x40
  const o = 0x40;
  b[o] = 0x50; b[o + 1] = 0x45; b[o + 2] = 0x00; b[o + 3] = 0x00; // PE\0\0
  b[o + 4] = 0x64; b[o + 5] = 0x86; // machine x86-64
  b[o + 6] = 3; // 3 secções
  b[o + 22] = 0x22; // characteristics: executable
  return b;
}

export function machoBytes(): Uint8Array {
  const b = new Uint8Array(32);
  b[0] = 0xcf; b[1] = 0xfa; b[2] = 0xed; b[3] = 0xfe; // feedfacf (64-bit LE)
  b[4] = 0x07; b[5] = 0x00; b[6] = 0x00; b[7] = 0x01; // cputype x86-64
  b[12] = 0x02; // filetype execute
  return b;
}

export function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj\n<<>>\nendobj\n");
}

export function gzipBytes(): Uint8Array {
  return u8([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);
}

export function tarBytes(): Uint8Array {
  const b = new Uint8Array(512);
  const ustar = [0x75, 0x73, 0x74, 0x61, 0x72]; // "ustar" no offset 257
  ustar.forEach((v, i) => { b[257 + i] = v; });
  return b;
}

export function wasmBytes(): Uint8Array {
  return u8([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
}

export function sqliteBytes(): Uint8Array {
  const head = new TextEncoder().encode("SQLite format 3\0");
  const b = new Uint8Array(100);
  b.set(head, 0);
  return b;
}

export function textBytes(s = "hello world\nsecond line\n"): Uint8Array {
  return new TextEncoder().encode(s);
}

export function jsBytes(): Uint8Array {
  return new TextEncoder().encode(
    "import React from 'react';\nimport fs from 'node:fs';\nconst x = require('./local');\nconsole.log('hello');\n",
  );
}

export function jsonBytes(): Uint8Array {
  return new TextEncoder().encode('{"name":"hub","version":1,"tags":["a","b"]}');
}

/** ZIP mínimo com entradas stored (método 0), sem compressão. */
export function zipBytes(entries: { name: string; data: string }[]): Uint8Array {
  const chunks: number[] = [];
  const pushU16 = (v: number) => chunks.push(v & 0xff, (v >> 8) & 0xff);
  const pushU32 = (v: number) =>
    chunks.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  const pushStr = (s: string) => {
    for (let i = 0; i < s.length; i++) chunks.push(s.charCodeAt(i) & 0xff);
  };
  const metas: { name: string; offset: number; size: number }[] = [];
  for (const e of entries) {
    const data = new TextEncoder().encode(e.data);
    metas.push({ name: e.name, offset: chunks.length, size: data.length });
    pushU32(0x04034b50); pushU16(20); pushU16(0); pushU16(0);
    pushU16(0); pushU16(0); pushU32(0);
    pushU32(data.length); pushU32(data.length);
    pushU16(e.name.length); pushU16(0);
    pushStr(e.name);
    for (const byte of data) chunks.push(byte);
  }
  const cdStart = chunks.length;
  for (const m of metas) {
    pushU32(0x02014b50);
    pushU16(20); pushU16(20); pushU16(0); pushU16(0);
    pushU16(0); pushU16(0); pushU32(0);
    pushU32(m.size); pushU32(m.size);
    pushU16(m.name.length); pushU16(0); pushU16(0);
    pushU16(0); pushU16(0); pushU32(0);
    pushU32(m.offset);
    pushStr(m.name);
  }
  const cdSize = chunks.length - cdStart;
  pushU32(0x06054b50);
  pushU16(0); pushU16(0);
  pushU16(metas.length); pushU16(metas.length);
  pushU32(cdSize); pushU32(cdStart); pushU16(0);
  return new Uint8Array(chunks);
}

export function eicarBytes(): Uint8Array {
  return new TextEncoder().encode(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
}
