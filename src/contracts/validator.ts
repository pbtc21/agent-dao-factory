/**
 * Contract Validator
 * ==================
 * Validates generated contracts using Clarinet before deployment.
 */

import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "fs";
import { join, dirname } from "path";
import type { DAOConfig } from "../types";
import { generateTokenContract } from "./templates/token";
import { generateTreasuryContract } from "./templates/treasury";
import { generateGovernanceContract } from "./templates/governance";

// ============================================================
// Types
// ============================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  contracts: {
    name: string;
    valid: boolean;
    errors: string[];
  }[];
}

export interface TestResult {
  passed: boolean;
  total: number;
  failed: number;
  output: string;
}

// ============================================================
// Validator Class
// ============================================================

export class ContractValidator {
  private clarinetDir: string;
  private contractsDir: string;
  private testsDir: string;

  constructor(baseDir: string = "./clarinet") {
    this.clarinetDir = baseDir;
    this.contractsDir = join(baseDir, "contracts");
    this.testsDir = join(baseDir, "tests");

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    mkdirSync(this.contractsDir, { recursive: true });
    mkdirSync(this.testsDir, { recursive: true });
  }

  /**
   * Validate generated contracts using Clarinet.
   */
  async validate(config: DAOConfig): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      contracts: [],
    };

    try {
      // Generate and write contracts
      await this.writeContracts(config);

      // Run clarinet check
      const checkResult = await this.runClarinetCheck();

      // Parse results
      result.valid = checkResult.exitCode === 0;
      result.errors = checkResult.errors;
      result.warnings = checkResult.warnings;

      // Check each contract
      for (const contractName of ["agent-token", "agent-treasury", "agent-governance"]) {
        const contractErrors = checkResult.errors.filter((e) =>
          e.toLowerCase().includes(contractName)
        );
        result.contracts.push({
          name: contractName,
          valid: contractErrors.length === 0,
          errors: contractErrors,
        });
      }
    } catch (error) {
      result.valid = false;
      result.errors.push(
        error instanceof Error ? error.message : String(error)
      );
    }

    return result;
  }

  /**
   * Run tests for the generated contracts.
   */
  async test(config: DAOConfig): Promise<TestResult> {
    try {
      // Generate contracts and tests
      await this.writeContracts(config);
      await this.writeTests(config);

      // Run clarinet test
      const testResult = await this.runClarinetTest();

      return testResult;
    } catch (error) {
      return {
        passed: false,
        total: 0,
        failed: 1,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Write generated contracts to Clarinet directory.
   */
  private async writeContracts(config: DAOConfig): Promise<void> {
    // For validation, use placeholder principals that are syntactically valid
    // The actual deployed contracts will use real addresses
    const placeholderAddr = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
    const tokenPrincipal = `${placeholderAddr}.agent-token`;
    const treasuryPrincipal = `${placeholderAddr}.agent-treasury`;
    const traitRef = ".sip-010-trait.sip-010-trait";

    // Generate contracts with local trait reference
    const tokenSource = generateTokenContract(config).replace(
      "'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait",
      traitRef
    );

    const treasurySource = generateTreasuryContract(
      config,
      tokenPrincipal
    ).replace(
      "'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait",
      traitRef
    );

    const governanceSource = generateGovernanceContract(
      config,
      tokenPrincipal,
      treasuryPrincipal
    );

    // Write contracts
    writeFileSync(join(this.contractsDir, "agent-token.clar"), tokenSource);
    writeFileSync(join(this.contractsDir, "agent-treasury.clar"), treasurySource);
    writeFileSync(join(this.contractsDir, "agent-governance.clar"), governanceSource);
  }

  /**
   * Write test file for contracts.
   */
  private async writeTests(config: DAOConfig): Promise<void> {
    const testSource = generateTests(config);
    writeFileSync(join(this.testsDir, "agent-dao.test.ts"), testSource);
  }

  /**
   * Run clarinet check command.
   */
  private runClarinetCheck(): Promise<{
    exitCode: number;
    errors: string[];
    warnings: string[];
  }> {
    return new Promise((resolve) => {
      // Use -c to auto-use computed deployment plan (avoids interactive prompt)
      const proc = spawn("clarinet", ["check", "-c"], {
        cwd: this.clarinetDir,
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        const output = stdout + stderr;
        const errors: string[] = [];
        const warnings: string[] = [];

        // Parse output for errors and warnings
        const lines = output.split("\n");
        for (const line of lines) {
          if (line.includes("error") || line.includes("Error")) {
            errors.push(line.trim());
          } else if (line.includes("warning") || line.includes("Warning")) {
            warnings.push(line.trim());
          }
        }

        resolve({
          exitCode: code || 0,
          errors,
          warnings,
        });
      });

      proc.on("error", (err) => {
        resolve({
          exitCode: 1,
          errors: [`Failed to run clarinet: ${err.message}`],
          warnings: [],
        });
      });
    });
  }

  /**
   * Run bun test command (vitest with Clarinet SDK).
   */
  private runClarinetTest(): Promise<TestResult> {
    return new Promise((resolve) => {
      const proc = spawn("bun", ["test"], {
        cwd: this.clarinetDir,
        shell: true,
      });

      let output = "";

      proc.stdout?.on("data", (data) => {
        output += data.toString();
      });

      proc.stderr?.on("data", (data) => {
        output += data.toString();
      });

      proc.on("close", (code) => {
        // Parse vitest results
        const passedMatch = output.match(/(\d+) passed/);
        const failedMatch = output.match(/(\d+) failed/);

        const passed = parseInt(passedMatch?.[1] || "0", 10);
        const failed = parseInt(failedMatch?.[1] || "0", 10);

        resolve({
          passed: code === 0 && failed === 0,
          total: passed + failed,
          failed,
          output,
        });
      });

      proc.on("error", (err) => {
        resolve({
          passed: false,
          total: 0,
          failed: 1,
          output: `Failed to run tests: ${err.message}`,
        });
      });
    });
  }

  /**
   * Clean up generated files.
   */
  cleanup(): void {
    const files = [
      join(this.contractsDir, "agent-token.clar"),
      join(this.contractsDir, "agent-treasury.clar"),
      join(this.contractsDir, "agent-governance.clar"),
      join(this.testsDir, "agent-dao.test.ts"),
    ];

    for (const file of files) {
      if (existsSync(file)) {
        rmSync(file);
      }
    }
  }
}

// ============================================================
// Test Generation
// ============================================================

function generateTests(config: DAOConfig): string {
  return `
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
      expect(cvToValue(getOkValue(result.result))).toBe("${config.name}");
    });

    it("returns correct symbol", () => {
      const result = simnet.callReadOnlyFn(
        "agent-token",
        "get-symbol",
        [],
        deployer
      );
      expect(isOk(result.result)).toBe(true);
      expect(cvToValue(getOkValue(result.result))).toBe("${config.symbol}");
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
`.trim();
}

// ============================================================
// Exports
// ============================================================

export { generateTests };
