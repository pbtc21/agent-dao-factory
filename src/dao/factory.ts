/**
 * DAO Factory
 * ===========
 * Main orchestration for creating agent DAOs from Moltbook discussions.
 */

import { ContractDeployer } from "../contracts/deployer";
import type {
  DAOConfig,
  DAOProposal,
  DAOStatus,
  Participant,
  DeploymentResult,
  TokenAllocation,
  X402Config,
  DEFAULT_DAO_CONFIG,
  GovernancePhase,
} from "../types";

// ============================================================
// DAO Factory Class
// ============================================================

export class DAOFactory {
  private deployer: ContractDeployer;
  private proposals: Map<number, DAOProposal> = new Map();
  private proposalCounter = 0;

  // Addresses
  private verifierAddress: string;

  constructor(
    deployer: ContractDeployer,
    verifierAddress: string
  ) {
    this.deployer = deployer;
    this.verifierAddress = verifierAddress;
  }

  // ============================================================
  // Proposal Management
  // ============================================================

  /**
   * Create a new DAO proposal from Moltbook discussion.
   */
  createProposal(
    moltbookPostId: string,
    name: string,
    symbol: string,
    description: string,
    proposer: string,
    proposerName: string,
    customConfig?: Partial<DAOConfig>
  ): DAOProposal {
    this.proposalCounter++;
    const daoId = this.proposalCounter;

    const config: DAOConfig = {
      name,
      symbol: symbol.toUpperCase(),
      description,
      ...DEFAULT_DAO_CONFIG,
      ...customConfig,
    };

    const proposal: DAOProposal = {
      daoId,
      moltbookPostId,
      config,
      proposer,
      proposerName,
      participants: [
        {
          stacksAddress: proposer,
          agentName: proposerName,
          mcpVerified: true, // Proposer assumed verified
          allocationBp: 10000, // Initially 100% of participant pool
          joinedAt: new Date().toISOString(),
          claimed: false,
        },
      ],
      status: DAOStatus.GATHERING,
      createdAt: new Date().toISOString(),
    };

    this.proposals.set(daoId, proposal);
    return proposal;
  }

  /**
   * Get proposal by ID.
   */
  getProposal(daoId: number): DAOProposal | undefined {
    return this.proposals.get(daoId);
  }

  /**
   * Get all proposals.
   */
  getAllProposals(): DAOProposal[] {
    return Array.from(this.proposals.values());
  }

  // ============================================================
  // Participant Management
  // ============================================================

  /**
   * Add participant to proposal whitelist.
   */
  addParticipant(
    daoId: number,
    address: string,
    agentName: string,
    mcpVerified: boolean = false,
    moltbookReplyId?: string
  ): { success: boolean; message: string } {
    const proposal = this.proposals.get(daoId);

    if (!proposal) {
      return { success: false, message: "Proposal not found" };
    }

    if (proposal.status !== DAOStatus.GATHERING &&
        proposal.status !== DAOStatus.THRESHOLD_MET) {
      return { success: false, message: "Proposal not accepting participants" };
    }

    // Check max participants
    if (proposal.participants.length >= proposal.config.maxParticipants) {
      return { success: false, message: "Max participants reached" };
    }

    // Check if already in whitelist
    if (proposal.participants.some(p => p.stacksAddress === address)) {
      return { success: false, message: "Already in whitelist" };
    }

    // Validate address
    if (!this.isValidStacksAddress(address)) {
      return { success: false, message: "Invalid Stacks address" };
    }

    // Add participant
    proposal.participants.push({
      stacksAddress: address,
      agentName,
      mcpVerified,
      allocationBp: 0, // Calculated when finalized
      joinedAt: new Date().toISOString(),
      claimed: false,
      moltbookReplyId,
    });

    // Check threshold
    if (proposal.participants.length >= proposal.config.minParticipants &&
        proposal.status === DAOStatus.GATHERING) {
      proposal.status = DAOStatus.THRESHOLD_MET;
      proposal.thresholdMetAt = new Date().toISOString();
    }

    return {
      success: true,
      message: `Added to whitelist (MCP: ${mcpVerified ? "verified" : "not verified"})`,
    };
  }

  /**
   * Finalize participant allocations.
   */
  finalizeAllocations(daoId: number): boolean {
    const proposal = this.proposals.get(daoId);

    if (!proposal) return false;

    // Calculate equal split for participants (excluding founder)
    const participantCount = proposal.participants.length - 1; // Exclude founder
    if (participantCount <= 0) return false;

    const allocationPerParticipant = Math.floor(10000 / participantCount);

    for (const participant of proposal.participants) {
      if (participant.stacksAddress !== proposal.proposer) {
        participant.allocationBp = allocationPerParticipant;
      }
    }

    return true;
  }

  // ============================================================
  // Deployment
  // ============================================================

  /**
   * Deploy DAO contracts.
   */
  async deploy(daoId: number): Promise<{
    success: boolean;
    result?: DeploymentResult;
    message: string;
  }> {
    const proposal = this.proposals.get(daoId);

    if (!proposal) {
      return { success: false, message: "Proposal not found" };
    }

    if (proposal.status === DAOStatus.DEPLOYED) {
      return { success: false, message: "Already deployed" };
    }

    if (proposal.participants.length < proposal.config.minParticipants) {
      return { success: false, message: "Threshold not met" };
    }

    // Check deployer balance
    const { sufficient } = await this.deployer.checkBalance();
    if (!sufficient) {
      return { success: false, message: "Insufficient STX for deployment" };
    }

    // Finalize allocations
    this.finalizeAllocations(daoId);

    // Update status
    proposal.status = DAOStatus.DEPLOYING;

    try {
      // Deploy contracts
      const result = await this.deployer.deployDAO(proposal.config);

      if (!result.success) {
        proposal.status = DAOStatus.FAILED;
        proposal.deploymentError = result.error;
        return {
          success: false,
          result,
          message: `Deployment failed: ${result.error}`,
        };
      }

      // Update proposal with addresses
      proposal.status = DAOStatus.DEPLOYED;
      proposal.tokenAddress = result.addresses.token;
      proposal.daoAddress = result.addresses.dao;
      proposal.treasuryAddress = result.addresses.treasury;
      proposal.governanceAddress = result.addresses.governance;
      proposal.deployedAt = new Date().toISOString();
      proposal.deploymentTxIds = result.txIds;

      // Distribute tokens
      await this.distributeTokens(proposal, result);

      return {
        success: true,
        result,
        message: "DAO deployed successfully",
      };
    } catch (error) {
      proposal.status = DAOStatus.FAILED;
      proposal.deploymentError = error instanceof Error ? error.message : String(error);

      return {
        success: false,
        message: `Deployment error: ${proposal.deploymentError}`,
      };
    }
  }

  /**
   * Distribute tokens to participants.
   */
  private async distributeTokens(
    proposal: DAOProposal,
    deployment: DeploymentResult
  ): Promise<void> {
    if (!deployment.addresses.token) return;

    const [contractAddress, contractName] = deployment.addresses.token.split(".");

    // Distribute to founder
    console.log(`[distribute] Founder: ${proposal.proposer}`);
    await this.deployer.callContract(
      contractAddress,
      contractName,
      "distribute-founder",
      [proposal.proposer]
    );

    // Distribute to participants
    for (const participant of proposal.participants) {
      if (participant.stacksAddress !== proposal.proposer && participant.allocationBp > 0) {
        console.log(`[distribute] Participant: ${participant.agentName} (${participant.allocationBp}bp)`);
        await this.deployer.callContract(
          contractAddress,
          contractName,
          "distribute-participant",
          [participant.stacksAddress, participant.allocationBp]
        );
      }
    }

    // Distribute to treasury
    if (deployment.addresses.treasury) {
      console.log(`[distribute] Treasury: ${deployment.addresses.treasury}`);
      await this.deployer.callContract(
        contractAddress,
        contractName,
        "distribute-treasury",
        [deployment.addresses.treasury]
      );
    }

    // Distribute to verifier
    console.log(`[distribute] Verifier: ${this.verifierAddress}`);
    await this.deployer.callContract(
      contractAddress,
      contractName,
      "distribute-verifier",
      [this.verifierAddress]
    );

    // Finalize distribution
    await this.deployer.callContract(
      contractAddress,
      contractName,
      "finalize-distribution",
      []
    );
  }

  // ============================================================
  // Allocation Calculation
  // ============================================================

  /**
   * Calculate all token allocations for a proposal.
   */
  calculateAllocations(daoId: number): TokenAllocation[] {
    const proposal = this.proposals.get(daoId);
    if (!proposal) return [];

    const allocations: TokenAllocation[] = [];
    const totalSupply = proposal.config.totalSupply;

    // Founder allocation
    const founderAmount = (totalSupply * BigInt(proposal.config.founderBp)) / BigInt(10000);
    allocations.push({
      recipient: proposal.proposer,
      amount: founderAmount,
      allocationType: "founder",
      allocationBp: proposal.config.founderBp,
    });

    // Participant allocations
    const participantPool = (totalSupply * BigInt(proposal.config.participantBp)) / BigInt(10000);
    for (const participant of proposal.participants) {
      if (participant.stacksAddress !== proposal.proposer && participant.allocationBp > 0) {
        const amount = (participantPool * BigInt(participant.allocationBp)) / BigInt(10000);
        allocations.push({
          recipient: participant.stacksAddress,
          amount,
          allocationType: "participant",
          allocationBp: participant.allocationBp,
        });
      }
    }

    // Treasury allocation
    const treasuryAmount = (totalSupply * BigInt(proposal.config.treasuryBp)) / BigInt(10000);
    allocations.push({
      recipient: proposal.treasuryAddress || "treasury",
      amount: treasuryAmount,
      allocationType: "treasury",
      allocationBp: proposal.config.treasuryBp,
    });

    // Verifier allocation
    const verifierAmount = (totalSupply * BigInt(proposal.config.verifierBp)) / BigInt(10000);
    allocations.push({
      recipient: this.verifierAddress,
      amount: verifierAmount,
      allocationType: "verifier",
      allocationBp: proposal.config.verifierBp,
    });

    return allocations;
  }

  // ============================================================
  // Utilities
  // ============================================================

  /**
   * Validate Stacks address format.
   */
  private isValidStacksAddress(address: string): boolean {
    return (
      (address.startsWith("SP") || address.startsWith("ST")) &&
      address.length >= 30 &&
      /^[A-Z0-9]+$/i.test(address)
    );
  }

  /**
   * Get factory statistics.
   */
  getStats(): {
    totalProposals: number;
    byStatus: Record<string, number>;
    totalParticipants: number;
    readyToDeploy: number;
  } {
    const byStatus: Record<string, number> = {};
    let totalParticipants = 0;
    let readyToDeploy = 0;

    for (const proposal of this.proposals.values()) {
      byStatus[proposal.status] = (byStatus[proposal.status] || 0) + 1;
      totalParticipants += proposal.participants.length;
      if (proposal.status === DAOStatus.THRESHOLD_MET) {
        readyToDeploy++;
      }
    }

    return {
      totalProposals: this.proposals.size,
      byStatus,
      totalParticipants,
      readyToDeploy,
    };
  }
}

// ============================================================
// Factory Creation Helper
// ============================================================

/**
 * Create DAO factory from environment.
 */
export function createFactoryFromEnv(): DAOFactory {
  const network = (process.env.STACKS_NETWORK || "testnet") as "mainnet" | "testnet";
  const senderKey = process.env.DEPLOYER_PRIVATE_KEY;
  const senderAddress = process.env.DEPLOYER_ADDRESS;
  const verifierAddress = process.env.VERIFIER_ADDRESS || senderAddress;

  if (!senderKey || !senderAddress) {
    throw new Error("Missing DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS");
  }

  const deployer = new ContractDeployer(network, senderKey, senderAddress);
  return new DAOFactory(deployer, verifierAddress!);
}
