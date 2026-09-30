import { afterEach, describe, expect, it, vi } from "vitest";

const { chatJsonMock, MockAiError } = vi.hoisted(() => {
  class MockAiError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { chatJsonMock: vi.fn(), MockAiError };
});

vi.mock("./client", () => ({
  chatJson: chatJsonMock,
  AiError: MockAiError,
}));

import { generatePlan } from "./services";

const validPlan = {
  goal: "Learn MERN",
  realistic: true,
  milestones: [{
    title: "Foundations",
    description: "",
    estimatedMinutes: 120,
    order: 1,
    tasks: [{
      title: "Review JavaScript basics",
      description: "",
      estimatedMinutes: 60,
      priority: "HIGH",
      dependencies: [],
    }],
  }],
  schedule: [],
};

const input = { goal: "Learn MERN", deadline: "30 days" };

afterEach(() => {
  chatJsonMock.mockReset();
});

describe("AI plan retries", () => {
  it("repairs one schema-invalid response without duplicating state", async () => {
    chatJsonMock
      .mockResolvedValueOnce({ milestones: [{ title: 42 }] })
      .mockResolvedValueOnce(validPlan);

    await expect(generatePlan(input)).resolves.toMatchObject({ goal: "Learn MERN" });
    expect(chatJsonMock).toHaveBeenCalledTimes(2);
    expect(chatJsonMock.mock.calls[1][0].system).toContain("Repair instruction");
  });

  it("retries transient provider failures at most twice", async () => {
    chatJsonMock
      .mockRejectedValueOnce(new MockAiError("SERVER"))
      .mockRejectedValueOnce(new MockAiError("RATE_LIMIT"))
      .mockResolvedValueOnce(validPlan);

    await expect(generatePlan(input)).resolves.toMatchObject({ goal: "Learn MERN" });
    expect(chatJsonMock).toHaveBeenCalledTimes(3);
  });

  it("stops after the two automatic retries", async () => {
    chatJsonMock.mockResolvedValue({ milestones: [{ title: 42 }] });

    await expect(generatePlan(input)).rejects.toThrow();
    expect(chatJsonMock).toHaveBeenCalledTimes(3);
  });
});
