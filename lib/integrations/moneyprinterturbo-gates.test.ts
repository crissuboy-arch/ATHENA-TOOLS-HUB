import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prepareAuthorizedMptJob } from "./moneyprinterturbo-job";
import { buildPublishHold, requireHumanApproval } from "./moneyprinterturbo-publish";

const approval = {
  approvedBy: "cristiane",
  approvedAt: "2026-10-27T16:00:00.000Z",
  channel: "instagram",
};

describe("MoneyPrinterTurbo human-review gate", () => {
  it("accepts a complete human approval", () => {
    expect(requireHumanApproval(approval)).toEqual(approval);
  });

  it("rejects missing approver, bad date and unknown channel", () => {
    expect(() => requireHumanApproval({ ...approval, approvedBy: " " })).toThrow(
      "quem aprovou",
    );
    expect(() => requireHumanApproval({ ...approval, approvedAt: "ontem" })).toThrow(
      "data válida",
    );
    expect(() => requireHumanApproval({ ...approval, channel: "tv" })).toThrow(
      "Canal de publicação inválido",
    );
    expect(() => requireHumanApproval(null)).toThrow("aprovação humana");
  });

  it("builds a manual-post hold, never an automatic post", () => {
    const hold = buildPublishHold("tasks/task-123/final-1.mp4", approval);
    expect(hold.status).toBe("awaiting-human-post");
    expect(hold.postedBy).toBeNull();
    expect(hold.note).toMatch("manual");
  });
});

describe("MoneyPrinterTurbo Athena job preparation", () => {
  const base = {
    organizationId: "org-1",
    toolSlug: "moneyprinterturbo",
    authorizedBy: "cristiane",
    authorizedAt: "2026-10-27T16:00:00.000Z",
    videoRequest: { video_subject: "Aveiro", video_language: "pt-BR" },
  };

  it("normalizes an authorized job without submitting anything", () => {
    const job = prepareAuthorizedMptJob(base);
    expect(job.status).toBe("authorized-not-submitted");
    expect(job.toolSlug).toBe("moneyprinterturbo");
    expect(job.idempotencyKey).toBe(job.jobId);
  });

  it("rejects missing organization, wrong tool and bad authorization", () => {
    expect(() => prepareAuthorizedMptJob({ ...base, organizationId: " " })).toThrow(
      "organização",
    );
    expect(() => prepareAuthorizedMptJob({ ...base, toolSlug: "photocraft" })).toThrow(
      "não autorizada",
    );
    expect(() => prepareAuthorizedMptJob({ ...base, authorizedAt: "nunca" })).toThrow(
      "data de autorização válida",
    );
    expect(() =>
      prepareAuthorizedMptJob({
        ...base,
        videoRequest: { video_subject: " " },
      }),
    ).toThrow("Assunto obrigatório");
  });
});
