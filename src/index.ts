/**
 * Agent DAO Factory
 * =================
 * Create DAOs for AI agents from Moltbook discussions.
 *
 * Features:
 * - Token structure: 50% founder, 30% participants, 15% treasury, 5% verifier
 * - Hybrid governance: founder control → decentralized
 * - x402 payment-gated services in sBTC
 * - Real contract deployment to Stacks
 */

export { DAOFactory, createFactoryFromEnv } from "./dao/factory";
export { ContractDeployer, createDeployerFromEnv } from "./contracts/deployer";
export { ContractValidator } from "./contracts/validator";
export { x402Middleware, createDAOServiceAPI } from "./x402/server";
export { generateTokenContract } from "./contracts/templates/token";
export { generateTreasuryContract } from "./contracts/templates/treasury";
export { generateGovernanceContract } from "./contracts/templates/governance";
export * from "./types";

// ============================================================
// Quick Start
// ============================================================

import { DAOFactory, createFactoryFromEnv } from "./dao/factory";

/**
 * Example usage:
 *
 * ```typescript
 * import { createFactoryFromEnv } from "agent-dao-factory";
 *
 * const factory = createFactoryFromEnv();
 *
 * // Create proposal from Moltbook post
 * const proposal = factory.createProposal(
 *   "post-123",
 *   "PoetAI",
 *   "POET",
 *   "AI poetry generation service",
 *   "SP123...",
 *   "poet-agent"
 * );
 *
 * // Add participants
 * factory.addParticipant(proposal.daoId, "SP456...", "coder-agent", true);
 * factory.addParticipant(proposal.daoId, "SP789...", "artist-agent", true);
 *
 * // Deploy when threshold met
 * const result = await factory.deploy(proposal.daoId);
 * ```
 */

// Main entry for CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log("\n  Agent DAO Factory\n");

  switch (command) {
    case "validate": {
      // Validate contracts for a test config
      const { ContractValidator } = await import("./contracts/validator");
      const { DEFAULT_DAO_CONFIG } = await import("./types");

      const name = args[1] || "TestDAO";
      const symbol = args[2] || "TEST";

      const config = {
        name,
        symbol,
        description: "Test DAO for validation",
        ...DEFAULT_DAO_CONFIG,
      };

      console.log(`  Validating ${name} (${symbol}) contracts...\n`);

      const validator = new ContractValidator("./clarinet");
      const result = await validator.validate(config);

      if (result.valid) {
        console.log("  ✓ All contracts valid\n");
        for (const contract of result.contracts) {
          console.log(`    ✓ ${contract.name}`);
        }
      } else {
        console.log("  ✗ Validation failed\n");
        for (const error of result.errors) {
          console.log(`    ✗ ${error}`);
        }
      }

      if (result.warnings.length > 0) {
        console.log("\n  Warnings:");
        for (const warning of result.warnings) {
          console.log(`    ⚠ ${warning}`);
        }
      }
      break;
    }

    case "test": {
      // Run tests for contracts
      const { ContractValidator } = await import("./contracts/validator");
      const { DEFAULT_DAO_CONFIG } = await import("./types");

      const name = args[1] || "TestDAO";
      const symbol = args[2] || "TEST";

      const config = {
        name,
        symbol,
        description: "Test DAO",
        ...DEFAULT_DAO_CONFIG,
      };

      console.log(`  Testing ${name} (${symbol}) contracts...\n`);

      const validator = new ContractValidator("./clarinet");
      const result = await validator.test(config);

      if (result.passed) {
        console.log(`  ✓ All tests passed (${result.total} total)\n`);
      } else {
        console.log(`  ✗ Tests failed (${result.failed}/${result.total})\n`);
      }

      console.log("  Output:");
      console.log(result.output);
      break;
    }

    case "generate": {
      // Generate contracts without deploying
      const { generateTokenContract } = await import("./contracts/templates/token");
      const { generateTreasuryContract } = await import("./contracts/templates/treasury");
      const { generateGovernanceContract } = await import("./contracts/templates/governance");
      const { DEFAULT_DAO_CONFIG } = await import("./types");
      const { writeFileSync, mkdirSync } = await import("fs");

      const name = args[1] || "TestDAO";
      const symbol = args[2] || "TEST";
      const outDir = args[3] || "./generated";

      const config = {
        name,
        symbol,
        description: "Generated DAO",
        ...DEFAULT_DAO_CONFIG,
      };

      console.log(`  Generating ${name} (${symbol}) contracts...\n`);

      mkdirSync(outDir, { recursive: true });

      const tokenContract = generateTokenContract(config);
      const treasuryContract = generateTreasuryContract(config, `SP...${symbol.toLowerCase()}-token`);
      const govContract = generateGovernanceContract(config, `SP...${symbol.toLowerCase()}-token`, `SP...${symbol.toLowerCase()}-treasury`);

      writeFileSync(`${outDir}/${symbol.toLowerCase()}-token.clar`, tokenContract);
      writeFileSync(`${outDir}/${symbol.toLowerCase()}-treasury.clar`, treasuryContract);
      writeFileSync(`${outDir}/${symbol.toLowerCase()}-governance.clar`, govContract);

      console.log(`  ✓ Generated contracts in ${outDir}/`);
      console.log(`    - ${symbol.toLowerCase()}-token.clar`);
      console.log(`    - ${symbol.toLowerCase()}-treasury.clar`);
      console.log(`    - ${symbol.toLowerCase()}-governance.clar`);
      break;
    }

    case "status":
      try {
        const factory = createFactoryFromEnv();
        const stats = factory.getStats();
        console.log("  Stats:");
        console.log(`    Total Proposals: ${stats.totalProposals}`);
        console.log(`    Total Participants: ${stats.totalParticipants}`);
        console.log(`    Ready to Deploy: ${stats.readyToDeploy}`);
        console.log(`    By Status: ${JSON.stringify(stats.byStatus)}`);
      } catch (e) {
        console.log("  No proposals yet. Create one to get started.");
      }
      break;

    case "help":
    default:
      console.log("  Commands:");
      console.log("    validate [name] [symbol]  Validate contracts with Clarinet");
      console.log("    test [name] [symbol]      Run contract tests");
      console.log("    generate [name] [symbol]  Generate contracts to ./generated");
      console.log("    status                    Show factory statistics");
      console.log("    help                      Show this help");
      console.log("");
      console.log("  Examples:");
      console.log("    bun run src/index.ts validate PoetAI POET");
      console.log("    bun run src/index.ts test PoetAI POET");
      console.log("    bun run src/index.ts generate PoetAI POET ./contracts");
      console.log("");
      console.log("  Environment Variables:");
      console.log("    STACKS_NETWORK       mainnet or testnet");
      console.log("    DEPLOYER_PRIVATE_KEY Stacks private key");
      console.log("    DEPLOYER_ADDRESS     Stacks address");
      console.log("    VERIFIER_ADDRESS     Address for verifier allocation");
      break;
  }
}
