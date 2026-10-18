/**
 * Testes da deteção de formato por magic bytes (lib/re/magic.ts).
 * A extensão nunca é usada aqui — só os bytes.
 */
import { describe, expect, it } from "vitest";
import { detectKind, extensionsFor, mimeFor } from "./magic";
import {
  elfBytes,
  gzipBytes,
  jpegBytes,
  jsonBytes,
  machoBytes,
  peBytes,
  pdfBytes,
  pngBytes,
  sqliteBytes,
  tarBytes,
  textBytes,
  u8,
  wasmBytes,
  zipBytes,
} from "./test-utils";

describe("detectKind (magic bytes)", () => {
  it("deteta formatos binários pelos magic bytes", () => {
    expect(detectKind(pngBytes())).toBe("png");
    expect(detectKind(jpegBytes())).toBe("jpeg");
    expect(detectKind(elfBytes())).toBe("elf");
    expect(detectKind(peBytes())).toBe("pe");
    expect(detectKind(machoBytes())).toBe("macho");
    expect(detectKind(pdfBytes())).toBe("pdf");
    expect(detectKind(gzipBytes())).toBe("gzip");
    expect(detectKind(tarBytes())).toBe("tar");
    expect(detectKind(wasmBytes())).toBe("wasm");
    expect(detectKind(sqliteBytes())).toBe("sqlite");
    expect(detectKind(zipBytes([{ name: "a.txt", data: "x" }]))).toBe("zip");
  });

  it("faz sniffing de texto (json/xml/html/text)", () => {
    expect(detectKind(jsonBytes())).toBe("json");
    expect(detectKind(textBytes("<html><body>oi</body></html>"))).toBe("html");
    expect(detectKind(textBytes("<?xml version='1.0'?><a/>"))).toBe("xml");
    expect(detectKind(textBytes("só texto simples"))).toBe("text");
  });

  it("retorna 'unknown' para bytes não reconhecidos", () => {
    expect(detectKind(u8([0xde, 0xad, 0xbe, 0xef, 0x00, 0x13]))).toBe("unknown");
    expect(detectKind(u8([0x00, 0x01, 0x02, 0x03]))).toBe("unknown");
  });

  it("não confunde binário com texto (NUL/controlo → unknown)", () => {
    // "MZ" sem resto de PE válido mas com bytes de controlo não é texto
    expect(detectKind(u8([0x4d, 0x5a, 0x00, 0x01, 0x02]))).toBe("pe"); // MZ vence
    expect(detectKind(u8([0x01, 0x02, 0x03, 0x04, 0x05]))).toBe("unknown");
  });
});

describe("extensionsFor / mimeFor", () => {
  it("mapeia kind → extensões e MIME", () => {
    expect(extensionsFor("zip")).toContain("apk");
    expect(extensionsFor("pe")).toContain("exe");
    expect(mimeFor("pdf")).toBe("application/pdf");
    expect(mimeFor("png")).toBe("image/png");
  });
});
