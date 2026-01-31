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
      const proc = spawn("clarinet", ["check"], {
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
   * Run clarinet test command.
   */
  private runClarinetTest(): Promise<TestResult> {
    return new Promise((resolve) => {
      const proc = spawn("clarinet", ["test"], {
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
        // Parse test results
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
import { Clarinet, Tx, Chain, Account, types } from "https://deno.land/x/clarinet@v1.7.0/index.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.170.0/testing/asserts.ts";

// ============================================================
// Token Tests
// ============================================================

Clarinet.test({
  name: "Token: can get name and symbol",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;

    const nameResult = chain.callReadOnlyFn(
      "agent-token",
      "get-name",
      [],
      deployer.address
    );
    assertEquals(nameResult.result, '(ok "${config.name}")');

    const symbolResult = chain.callReadOnlyFn(
      "agent-token",
      "get-symbol",
      [],
      deployer.address
    );
    assertEquals(symbolResult.result, '(ok "${config.symbol}")');
  },
});

Clarinet.test({
  name: "Token: deployer can distribute to founder",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    const founder = accounts.get("wallet_1")!;

    const block = chain.mineBlock([
      Tx.contractCall(
        "agent-token",
        "distribute-founder",
        [types.principal(founder.address)],
        deployer.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    assertEquals(block.receipts[0].result.expectOk(), true);
  },
});

Clarinet.test({
  name: "Token: non-deployer cannot distribute",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const wallet1 = accounts.get("wallet_1")!;
    const wallet2 = accounts.get("wallet_2")!;

    const block = chain.mineBlock([
      Tx.contractCall(
        "agent-token",
        "distribute-founder",
        [types.principal(wallet2.address)],
        wallet1.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    block.receipts[0].result.expectErr().expectUint(2001); // ERR_UNAUTHORIZED
  },
});

Clarinet.test({
  name: "Token: cannot distribute after finalization",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    const founder = accounts.get("wallet_1")!;

    // Distribute and finalize
    chain.mineBlock([
      Tx.contractCall(
        "agent-token",
        "distribute-founder",
        [types.principal(founder.address)],
        deployer.address
      ),
      Tx.contractCall(
        "agent-token",
        "finalize-distribution",
        [],
        deployer.address
      ),
    ]);

    // Try to distribute again
    const block = chain.mineBlock([
      Tx.contractCall(
        "agent-token",
        "distribute-treasury",
        [types.principal(deployer.address)],
        deployer.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    block.receipts[0].result.expectErr().expectUint(2004); // ERR_ALREADY_DISTRIBUTED
  },
});

// ============================================================
// Governance Tests
// ============================================================

Clarinet.test({
  name: "Governance: starts in founder control phase",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;

    const result = chain.callReadOnlyFn(
      "agent-governance",
      "get-governance-phase",
      [],
      deployer.address
    );

    assertEquals(result.result, "u1"); // PHASE_FOUNDER_CONTROL
  },
});

Clarinet.test({
  name: "Governance: founder can transition phases",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;

    const block = chain.mineBlock([
      Tx.contractCall(
        "agent-governance",
        "transition-phase",
        [],
        deployer.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    block.receipts[0].result.expectOk().expectUint(2); // PHASE_TRANSITIONING
  },
});

Clarinet.test({
  name: "Governance: non-founder cannot transition",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const wallet1 = accounts.get("wallet_1")!;

    const block = chain.mineBlock([
      Tx.contractCall(
        "agent-governance",
        "transition-phase",
        [],
        wallet1.address
      ),
    ]);

    assertEquals(block.receipts.length, 1);
    block.receipts[0].result.expectErr().expectUint(4001); // ERR_UNAUTHORIZED
  },
});

// ============================================================
// Integration Tests
// ============================================================

Clarinet.test({
  name: "Full distribution flow works correctly",
  fn(chain: Chain, accounts: Map<string, Account>) {
    const deployer = accounts.get("deployer")!;
    const founder = accounts.get("wallet_1")!;
    const participant1 = accounts.get("wallet_2")!;
    const participant2 = accounts.get("wallet_3")!;
    const treasury = accounts.get("wallet_4")!;
    const verifier = accounts.get("wallet_5")!;

    // Full distribution
    const block = chain.mineBlock([
      // Distribute to founder (50%)
      Tx.contractCall(
        "agent-token",
        "distribute-founder",
        [types.principal(founder.address)],
        deployer.address
      ),
      // Distribute to participants (30% split)
      Tx.contractCall(
        "agent-token",
        "distribute-participant",
        [types.principal(participant1.address), types.uint(5000)],
        deployer.address
      ),
      Tx.contractCall(
        "agent-token",
        "distribute-participant",
        [types.principal(participant2.address), types.uint(5000)],
        deployer.address
      ),
      // Distribute to treasury (15%)
      Tx.contractCall(
        "agent-token",
        "distribute-treasury",
        [types.principal(treasury.address)],
        deployer.address
      ),
      // Distribute to verifier (5%)
      Tx.contractCall(
        "agent-token",
        "distribute-verifier",
        [types.principal(verifier.address)],
        deployer.address
      ),
      // Finalize
      Tx.contractCall(
        "agent-token",
        "finalize-distribution",
        [],
        deployer.address
      ),
    ]);

    // All should succeed
    assertEquals(block.receipts.length, 6);
    for (const receipt of block.receipts) {
      receipt.result.expectOk();
    }

    // Check balances
    const founderBalance = chain.callReadOnlyFn(
      "agent-token",
      "get-balance",
      [types.principal(founder.address)],
      deployer.address
    );
    assertExists(founderBalance.result);
  },
});
`.trim();
}

// ============================================================
// Exports
// ============================================================

export { generateTests };
