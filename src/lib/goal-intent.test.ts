import { describe, expect, it } from "vitest";
import { looksLikeCommitmentIntent } from "./goal-intent";

describe("looksLikeCommitmentIntent", () => {
  it("flags requests to balance existing work or study responsibilities", () => {
    expect(looksLikeCommitmentIntent("I want to balance my full-time job and BSc Data Science studies")).toBe(true);
  });

  it("does not flag a clear learning goal", () => {
    expect(looksLikeCommitmentIntent("I want to learn MERN in 30 days")).toBe(false);
  });
});
