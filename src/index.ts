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
      console.log("    status   Show factory statistics");
      console.log("    help     Show this help");
      console.log("");
      console.log("  Environment Variables:");
      console.log("    STACKS_NETWORK       mainnet or testnet");
      console.log("    DEPLOYER_PRIVATE_KEY Stacks private key");
      console.log("    DEPLOYER_ADDRESS     Stacks address");
      console.log("    VERIFIER_ADDRESS     Address for verifier allocation");
      break;
  }
}
