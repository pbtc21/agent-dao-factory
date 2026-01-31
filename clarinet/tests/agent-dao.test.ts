import { describe, it, expect } from "vitest";
import { Cl, ClarityType, cvToValue } from "@stacks/transactions";
import { initSimnet, tx } from "@hirosystems/clarinet-sdk";

// Initialize simnet
const simnet = await initSimnet();
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

// Helper to check if result is Ok
function isOk(result: any): boolean {
  return result.type === ClarityType.ResponseOk;
}

// Helper to check if result is Err
function isErr(result: any): boolean {
  return result.type === ClarityType.ResponseErr;
}

// Helper to get Ok value
function getOkValue(result: any): any {
  if (result.type === ClarityType.ResponseOk) {
    return result.value;
  }
  throw new Error("Expected Ok response");
}

// Helper to get Err value
function getErrValue(result: any): any {
  if (result.type === ClarityType.ResponseErr) {
    return result.value;
  }
  throw new Error("Expected Err response");
}

describe("Agent Token Contract", () => {
  describe("Token Metadata", () => {
    it("returns correct name", () => {
      const result = simnet.callReadOnlyFn(
        "agent-token",
        "get-name",
        [],
        deployer
      );
      expect(isOk(result.result)).toBe(true);
      expect(cvToValue(getOkValue(result.result))).toBe("PoetAI");
    });

    it("returns correct symbol", () => {
      const result = simnet.callReadOnlyFn(
        "agent-token",
        "get-symbol",
        [],
        deployer
      );
      expect(isOk(result.result)).toBe(true);
      expect(cvToValue(getOkValue(result.result))).toBe("POET");
    });

    it("returns correct decimals", () => {
      const result = simnet.callReadOnlyFn(
        "agent-token",
        "get-decimals",
        [],
        deployer
      );
      expect(isOk(result.result)).toBe(true);
      expect(cvToValue(getOkValue(result.result))).toBe(8n);
    });
  });

  describe("Distribution", () => {
    it("allows deployer to distribute to founder", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-token",
          "distribute-founder",
          [Cl.principal(wallet1)],
          deployer
        ),
      ]);
      expect(isOk(block[0].result)).toBe(true);
    });

    it("prevents non-deployer from distributing", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-token",
          "distribute-founder",
          [Cl.principal(wallet2)],
          wallet1
        ),
      ]);
      expect(isErr(block[0].result)).toBe(true);
      expect(cvToValue(getErrValue(block[0].result))).toBe(2001n);
    });

    it("allows distribution to participants", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-token",
          "distribute-participant",
          [Cl.principal(wallet1), Cl.uint(5000)],
          deployer
        ),
      ]);
      expect(isOk(block[0].result)).toBe(true);
    });

    it("prevents distribution after finalization", () => {
      simnet.mineBlock([
        tx.callPublicFn(
          "agent-token",
          "finalize-distribution",
          [],
          deployer
        ),
      ]);

      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-token",
          "distribute-treasury",
          [Cl.principal(wallet1)],
          deployer
        ),
      ]);
      expect(isErr(block[0].result)).toBe(true);
      expect(cvToValue(getErrValue(block[0].result))).toBe(2004n);
    });
  });
});

describe("Agent Governance Contract", () => {
  describe("Governance Phase", () => {
    it("starts in founder control phase", () => {
      const result = simnet.callReadOnlyFn(
        "agent-governance",
        "get-governance-phase",
        [],
        deployer
      );
      expect(cvToValue(result.result)).toBe(1n);
    });

    it("allows founder to transition phase", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-governance",
          "transition-phase",
          [],
          deployer
        ),
      ]);
      expect(isOk(block[0].result)).toBe(true);
    });

    it("prevents non-founder from transitioning", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-governance",
          "transition-phase",
          [],
          wallet1
        ),
      ]);
      expect(isErr(block[0].result)).toBe(true);
      expect(cvToValue(getErrValue(block[0].result))).toBe(4001n);
    });
  });
});

describe("Agent Treasury Contract", () => {
  describe("Revenue Tracking", () => {
    it("starts with zero revenue", () => {
      const result = simnet.callReadOnlyFn(
        "agent-treasury",
        "get-total-revenue",
        [],
        deployer
      );
      expect(cvToValue(result.result)).toBe(0n);
    });

    it("allows owner to record revenue", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-treasury",
          "record-revenue",
          [Cl.uint(1000000)],
          deployer
        ),
      ]);
      expect(isOk(block[0].result)).toBe(true);
    });

    it("prevents non-owner from recording revenue", () => {
      const block = simnet.mineBlock([
        tx.callPublicFn(
          "agent-treasury",
          "record-revenue",
          [Cl.uint(1000000)],
          wallet1
        ),
      ]);
      expect(isErr(block[0].result)).toBe(true);
      expect(cvToValue(getErrValue(block[0].result))).toBe(3001n);
    });
  });
});