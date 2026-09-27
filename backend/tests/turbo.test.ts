import { describe, it, expect } from "vitest";
import { setTurbo } from "../src/automation/turbo.js";

describe("turbo mode contract", () => {
  it("rejects enabling without the exact acknowledgement (no DB touched)", async () => {
    await expect(setTurbo("00000000-0000-0000-0000-000000000000", true)).rejects.toThrow(
      /turbo_ack_required/,
    );
    await expect(setTurbo("00000000-0000-0000-0000-000000000000", true, "yes")).rejects.toThrow(
      /turbo_ack_required/,
    );
    await expect(setTurbo("00000000-0000-0000-0000-000000000000", true, "I_UNDERSTAND ")).rejects.toThrow(
      /turbo_ack_required/,
    );
  });

  it("disabling never requires an acknowledgement", async () => {
    // Disable path returns before any DB write is required for ack; with no DB
    // configured this would fail on the query — assert it gets past the ack
    // gate by checking the error is NOT the ack error.
    try {
      await setTurbo("00000000-0000-0000-0000-000000000000", false);
    } catch (err) {
      expect(String((err as Error).message)).not.toMatch(/turbo_ack_required/);
    }
  });
});
