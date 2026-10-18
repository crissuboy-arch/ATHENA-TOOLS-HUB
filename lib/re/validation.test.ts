/**
 * Testes da validação e quarentena (lib/re/validation.ts).
 * Foco: tipos válidos/inválidos, limites e rejeição de bypass
 * (spoofing de extensão, dupla extensão, EICAR).
 */
import { describe, expect, it } from "vitest";
import { resolveLimits } from "./config";
import { EICAR_TEST_STRING, validateArtifact } from "./validation";
import {
  eicarBytes,
  elfBytes,
  peBytes,
  pngBytes,
  textBytes,
  u8,
  zipBytes,
} from "./test-utils";

const { limits } = resolveLimits();
const ok = (filename: string, bytes: Uint8Array, authorized = true) =>
  validateArtifact(filename, bytes, limits, authorized);

describe("ficheiros válidos", () => {
  it("aceita PNG com extensão coerente", () => {
    const r = ok("foto.png", pngBytes());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.kind).toBe("png");
      expect(r.file.mime).toBe("image/png");
      expect(r.file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.file.sizeBytes).toBe(pngBytes().length);
    }
  });

  it("aceita extensão em maiúsculas", () => {
    expect(ok("FOTO.PNG", pngBytes()).ok).toBe(true);
  });

  it("classifica texto com extensão .js como javascript", () => {
    const r = ok("app.js", textBytes("console.log('oi')\n"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.kind).toBe("javascript");
  });

  it("aceita APK (zip) e ELF", () => {
    expect(ok("app.apk", zipBytes([{ name: "a.txt", data: "x" }])).ok).toBe(true);
    expect(ok("lib.so", elfBytes()).ok).toBe(true);
  });
});

describe("rejeições básicas", () => {
  it("exige autorização expressa", () => {
    const r = ok("foto.png", pngBytes(), false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("AUTHORIZATION_REQUIRED");
      expect(r.rejection.quarantine).toBe(false);
    }
  });

  it("rejeita ficheiro vazio", () => {
    const r = ok("vazio.txt", u8([]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.code).toBe("EMPTY_FILE");
  });

  it("rejeita acima do limite de tamanho", () => {
    const small = resolveLimits({ maxUploadBytes: 10 }).limits;
    const r = validateArtifact("a.txt", textBytes("0123456789ABCDEF"), small, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.code).toBe("TOO_LARGE");
  });

  it("rejeita nome com path traversal", () => {
    for (const name of ["../foto.png", "a/b.png", "..\\x.png", ""]) {
      const r = ok(name, pngBytes());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.code).toBe("INVALID_FILENAME");
    }
  });

  it("põe em quarentena formato desconhecido", () => {
    const r = ok("misterio.bin", u8([0xde, 0xad, 0xbe, 0xef, 0x13, 0x37]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("UNKNOWN_FORMAT");
      expect(r.rejection.quarantine).toBe(true);
    }
  });

  it("põe em quarentena formato fora da lista de permitidos", () => {
    const restricted = resolveLimits({ allowedKinds: ["png"] }).limits;
    const r = validateArtifact("a.zip", zipBytes([{ name: "a.txt", data: "x" }]), restricted, true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("FORMAT_NOT_ALLOWED");
      expect(r.rejection.quarantine).toBe(true);
    }
  });
});

describe("rejeição de bypass", () => {
  it("deteta spoofing: binário PE com extensão .png", () => {
    const r = ok("foto.png", peBytes());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("EXTENSION_SPOOF");
      expect(r.rejection.quarantine).toBe(true);
    }
  });

  it("deteta spoofing: ELF com extensão .jpg", () => {
    const r = ok("imagem.jpg", elfBytes());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.code).toBe("EXTENSION_SPOOF");
  });

  it("rejeita ficheiro sem extensão (não verificável)", () => {
    const r = ok("semextensao", pngBytes());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.code).toBe("EXTENSION_SPOOF");
  });

  it("deteta dupla extensão documento→executável", () => {
    const r = ok("relatorio.pdf.exe", peBytes());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("DOUBLE_EXTENSION");
      expect(r.rejection.quarantine).toBe(true);
    }
  });

  it("não acusa dupla extensão em nomes legítimos", () => {
    expect(ok("backup.2024-10-18.zip", zipBytes([{ name: "a.txt", data: "x" }])).ok).toBe(true);
  });

  it("põe em quarentena a string de teste EICAR", () => {
    expect(EICAR_TEST_STRING).toContain("EICAR-STANDARD-ANTIVIRUS-TEST-FILE");
    const r = ok("teste.txt", eicarBytes());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.code).toBe("MALWARE_SIGNATURE");
      expect(r.rejection.quarantine).toBe(true);
    }
  });

  it("mensagens de rejeição nunca incluem conteúdo do ficheiro", () => {
    const secret = "segredo-super-secreto-123";
    const r = ok("foto.png", textBytes(secret));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).not.toContain(secret);
  });
});
