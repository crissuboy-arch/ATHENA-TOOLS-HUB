/**
 * Testes: catálogo honesto de capacidades (index).
 * `npx vitest run lib/automations/index.test.ts`
 */
import { describe, expect, it } from "vitest";
import { allAutomationKinds, automationCatalog } from "./index";

describe("automationCatalog", () => {
  it("cobre todos os tipos de automação", () => {
    const kinds = automationCatalog.map((c) => c.kind).sort();
    expect(kinds).toEqual([...allAutomationKinds].sort());
  });

  it("publicação está desativada e marcada como tal", () => {
    const pub = automationCatalog.find((c) => c.kind === "scheduled_publish");
    expect(pub?.executionReady).toBe(false);
    expect(pub?.description).toContain("DESATIVADO");
  });

  it("só content_prep e campaign_report declaram executionReady", () => {
    const ready = automationCatalog.filter((c) => c.executionReady);
    expect(ready.map((c) => c.kind).sort()).toEqual([
      "campaign_report",
      "content_prep",
    ]);
  });

  it("toda capacidade referencia um conceito INEMA", () => {
    for (const c of automationCatalog) {
      expect(["r7e", "promoavatar", "xviral", "degrau-2", "degrau-3"]).toContain(
        c.inemaReference,
      );
    }
  });
});
