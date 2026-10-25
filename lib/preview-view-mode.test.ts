/**
 * Testes de lib/preview-view-mode.ts — a contenção do modo
 * visualização temporário: só Preview da Vercel, nunca Production
 * nem ambiente local.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isPreviewViewMode } from "@/lib/preview-view-mode";

const original = process.env.VERCEL_ENV;

afterEach(() => {
  if (original === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original;
});

describe("isPreviewViewMode", () => {
  it("ativa apenas em Preview da Vercel", () => {
    process.env.VERCEL_ENV = "preview";
    expect(isPreviewViewMode()).toBe(true);
  });

  it("nunca ativa em Production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isPreviewViewMode()).toBe(false);
  });

  it("nunca ativa em local (development ou ausente)", () => {
    process.env.VERCEL_ENV = "development";
    expect(isPreviewViewMode()).toBe(false);
    delete process.env.VERCEL_ENV;
    expect(isPreviewViewMode()).toBe(false);
  });
});
