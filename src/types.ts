/**
 * Agent DAO Factory Types
 * =======================
 * Core type definitions for the DAO factory system.
 */

// ============================================================
// Enums
// ============================================================

export enum DAOStatus {
  GATHERING = "gathering",
  THRESHOLD_MET = "threshold_met",
  DEPLOYING = "deploying",
  DEPLOYED = "deployed",
  FAILED = "failed",
}

export enum GovernancePhase {
  FOUNDER_CONTROL = "founder_control",   // Founder makes all decisions
  TRANSITIONING = "transitioning",        // Preparing for decentralization
  DECENTRALIZED = "decentralized",        // Token holder voting
}

export enum TrustLevel {
  UNKNOWN = "unknown",
  PENDING = "pending",
  BASIC = "basic",
  TRUSTED = "trusted",
  ESTABLISHED = "established",
}

// ============================================================
// Core Interfaces
// ============================================================

export interface Participant {
  stacksAddress: string;
  agentName: string;
  mcpVerified: boolean;
  allocationBp: number;        // Basis points (10000 = 100%)
  joinedAt: string;            // ISO timestamp
  claimed: boolean;
  moltbookUsername?: string;
  moltbookReplyId?: string;
}

export interface TokenAllocation {
  recipient: string;
  amount: bigint;              // In micro-units (8 decimals)
  allocationType: "founder" | "participant" | "treasury" | "verifier";
  allocationBp: number;
}

export interface DAOConfig {
  // Token configuration
  name: string;
  symbol: string;
  description: string;
  totalSupply: bigint;         // Default: 1 billion with 8 decimals

  // Allocation (basis points, must sum to 10000)
  founderBp: number;           // Default: 5000 (50%)
  participantBp: number;       // Default: 3000 (30%)
  treasuryBp: number;          // Default: 1500 (15%)
  verifierBp: number;          // Default: 500 (5%)

  // Governance
  governancePhase: GovernancePhase;
  votingQuorum: number;        // Default: 15%
  votingThreshold: number;     // Default: 66%
  proposalBond: bigint;        // Default: 250 tokens
  coreChangeThreshold: number; // Default: 95%

  // Revenue distribution (PoetAI model)
  profitDistributionBp: number; // Default: 7500 (75% to holders)
  reinvestmentBp: number;       // Default: 2500 (25% reinvested)

  // Thresholds
  minParticipants: number;     // Default: 10
  maxParticipants: number;     // Default: 50
}

export interface DAOProposal {
  daoId: number;
  moltbookPostId: string;
  config: DAOConfig;
  proposer: string;
  proposerName: string;
  participants: Participant[];
  status: DAOStatus;

  // Contract addresses (set after deployment)
  tokenAddress?: string;
  daoAddress?: string;
  treasuryAddress?: string;
  governanceAddress?: string;
  x402Address?: string;

  // Timestamps
  createdAt: string;
  thresholdMetAt?: string;
  deployedAt?: string;

  // Deployment info
  deploymentTxIds?: string[];
  deploymentError?: string;
}

// ============================================================
// x402 Payment Types
// ============================================================

export interface X402Config {
  enabled: boolean;
  facilitatorUrl: string;
  priceInSats: number;         // Price per API call
  recipientAddress: string;    // Treasury address
  description: string;
}

export interface X402PaymentRequest {
  amount: number;
  asset: "sbtc";
  network: "stacks-mainnet" | "stacks-testnet";
  recipient: string;
  memo?: string;
}

export interface X402PaymentVerification {
  valid: boolean;
  txId?: string;
  amount?: number;
  sender?: string;
  error?: string;
}

// ============================================================
// Governance Types
// ============================================================

export interface Proposal {
  id: number;
  daoId: number;
  proposer: string;
  title: string;
  description: string;
  action: ProposalAction;
  status: ProposalStatus;
  votesFor: bigint;
  votesAgainst: bigint;
  vetoVotes: bigint;
  createdAt: string;
  votingEndsAt: string;
  executedAt?: string;
}

export enum ProposalStatus {
  PENDING = "pending",
  ACTIVE = "active",
  PASSED = "passed",
  FAILED = "failed",
  VETOED = "vetoed",
  EXECUTED = "executed",
  EXPIRED = "expired",
}

export type ProposalAction =
  | { type: "transfer"; recipient: string; amount: bigint; asset: string }
  | { type: "update_config"; key: string; value: string }
  | { type: "add_extension"; address: string }
  | { type: "remove_extension"; address: string }
  | { type: "upgrade_governance"; newPhase: GovernancePhase }
  | { type: "custom"; contractCall: ContractCall };

export interface ContractCall {
  contractAddress: string;
  functionName: string;
  args: unknown[];
}

// ============================================================
// Deployment Types
// ============================================================

export interface DeploymentResult {
  success: boolean;
  txIds: string[];
  addresses: {
    token?: string;
    dao?: string;
    treasury?: string;
    governance?: string;
    x402?: string;
  };
  error?: string;
  gasUsed?: number;
}

export interface NetworkConfig {
  name: "mainnet" | "testnet";
  apiUrl: string;
  explorerUrl: string;
  chainId: number;
}

// ============================================================
// Default Configuration
// ============================================================

export const DEFAULT_DAO_CONFIG: Omit<DAOConfig, "name" | "symbol" | "description"> = {
  totalSupply: BigInt("100000000000000000"), // 1 billion with 8 decimals

  // Allocation (PoetAI model)
  founderBp: 5000,      // 50%
  participantBp: 3000,  // 30%
  treasuryBp: 1500,     // 15%
  verifierBp: 500,      // 5%

  // Governance
  governancePhase: GovernancePhase.FOUNDER_CONTROL,
  votingQuorum: 15,
  votingThreshold: 66,
  proposalBond: BigInt("25000000000"), // 250 tokens
  coreChangeThreshold: 95,

  // Revenue (PoetAI: 75% distributed, 25% reinvested)
  profitDistributionBp: 7500,
  reinvestmentBp: 2500,

  // Thresholds
  minParticipants: 10,
  maxParticipants: 50,
};

export const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    apiUrl: "https://api.mainnet.hiro.so",
    explorerUrl: "https://explorer.stacks.co",
    chainId: 1,
  },
  testnet: {
    name: "testnet",
    apiUrl: "https://api.testnet.hiro.so",
    explorerUrl: "https://explorer.stacks.co",
    chainId: 2147483648,
  },
};
