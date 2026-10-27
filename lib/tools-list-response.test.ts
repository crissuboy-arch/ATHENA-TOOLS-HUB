/**
 * Finalização G3 (27/10/2026): a lista de tools tem de chegar ao
 * dashboard com a forma que o useApiList entende (items/total).
 * Antes, a rota devolvia só { tools } e o dashboard lia sempre 0.
 * Estes testes travam a forma da resposta — sem rede, sem BD.
 */
import { describe, expect, it } from "vitest";
import {
  buildToolsListResponse,
  toToolDTO,
  type ToolDTO,
} from "@/app/api/v1/tools/route";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "photocraft",
  description: "Foto",
  state: "in-development",
  updated_at: "2026-10-27T00:00:00.000Z",
  tool_capabilities: [{ name: "edit" }, { name: "upscale" }],
};

describe("buildToolsListResponse", () => {
  it("expõe tools, items (mesma lista) e total", () => {
    const dto: ToolDTO = toToolDTO(ROW);
    const res = buildToolsListResponse([dto]);
    expect(res.tools).toEqual([dto]);
    expect(res.items).toEqual([dto]);
    expect(res.total).toBe(1);
  });

  it("lista vazia dá total 0, nunca null", () => {
    const res = buildToolsListResponse([]);
    expect(res.tools).toEqual([]);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("toToolDTO lê state (não status) e capabilities embutidas", () => {
    const dto = toToolDTO(ROW);
    expect(dto.status).toBe("in-development");
    expect(dto.capabilities).toEqual(["edit", "upscale"]);
    expect(dto.version).toBe("0.0.0");
  });
});
