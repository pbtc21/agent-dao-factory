/**
 * Contract Deployer
 * =================
 * Handles deployment of DAO contracts to Stacks blockchain.
 */

import {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  ClarityVersion,
  makeContractCall,
  uintCV,
  principalCV,
  stringAsciiCV,
  bufferCV,
  FungibleConditionCode,
  makeStandardSTXPostCondition,
} from "@stacks/transactions";
import { StacksMainnet, StacksTestnet } from "@stacks/network";
import type { DAOConfig, DeploymentResult, NetworkConfig } from "../types";
import { NETWORKS } from "../types";
import { generateTokenContract } from "./templates/token";
import { generateTreasuryContract } from "./templates/treasury";
import { generateGovernanceContract } from "./templates/governance";

// ============================================================
// Deployer Class
// ============================================================

export class ContractDeployer {
  private network: NetworkConfig;
  private stacksNetwork: StacksMainnet | StacksTestnet;
  private senderKey: string;
  private senderAddress: string;

  constructor(
    networkName: "mainnet" | "testnet",
    senderKey: string,
    senderAddress: string
  ) {
    this.network = NETWORKS[networkName];
    this.stacksNetwork =
      networkName === "mainnet" ? new StacksMainnet() : new StacksTestnet();
    this.senderKey = senderKey;
    this.senderAddress = senderAddress;
  }

  /**
   * Deploy all DAO contracts.
   */
  async deployDAO(config: DAOConfig): Promise<DeploymentResult> {
    const txIds: string[] = [];
    const addresses: DeploymentResult["addresses"] = {};

    try {
      // 1. Deploy token contract
      console.log(`[deploy] Deploying ${config.symbol} token...`);
      const tokenSource = generateTokenContract(config);
      const tokenTxId = await this.deployContract(
        `${config.symbol.toLowerCase()}-token`,
        tokenSource
      );
      txIds.push(tokenTxId);
      addresses.token = `${this.senderAddress}.${config.symbol.toLowerCase()}-token`;
      console.log(`[deploy] Token TX: ${tokenTxId}`);

      // Wait for confirmation
      await this.waitForConfirmation(tokenTxId);

      // 2. Deploy treasury contract
      console.log(`[deploy] Deploying treasury...`);
      const treasurySource = generateTreasuryContract(config, addresses.token);
      const treasuryTxId = await this.deployContract(
        `${config.symbol.toLowerCase()}-treasury`,
        treasurySource
      );
      txIds.push(treasuryTxId);
      addresses.treasury = `${this.senderAddress}.${config.symbol.toLowerCase()}-treasury`;
      console.log(`[deploy] Treasury TX: ${treasuryTxId}`);

      await this.waitForConfirmation(treasuryTxId);

      // 3. Deploy governance contract
      console.log(`[deploy] Deploying governance...`);
      const govSource = generateGovernanceContract(
        config,
        addresses.token,
        addresses.treasury
      );
      const govTxId = await this.deployContract(
        `${config.symbol.toLowerCase()}-governance`,
        govSource
      );
      txIds.push(govTxId);
      addresses.governance = `${this.senderAddress}.${config.symbol.toLowerCase()}-governance`;
      console.log(`[deploy] Governance TX: ${govTxId}`);

      await this.waitForConfirmation(govTxId);

      return {
        success: true,
        txIds,
        addresses,
      };
    } catch (error) {
      return {
        success: false,
        txIds,
        addresses,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Deploy a single contract.
   */
  async deployContract(
    contractName: string,
    sourceCode: string,
    fee?: number
  ): Promise<string> {
    // Get nonce
    const nonce = await this.getNextNonce();

    // Create deployment transaction
    const transaction = await makeContractDeploy({
      contractName,
      codeBody: sourceCode,
      senderKey: this.senderKey,
      nonce,
      fee: fee || 100_000, // 0.1 STX default
      network: this.stacksNetwork,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
      clarityVersion: ClarityVersion.Clarity3,
    });

    // Broadcast
    const result = await broadcastTransaction({
      transaction,
      network: this.stacksNetwork,
    });

    if ("error" in result) {
      throw new Error(`Deploy failed: ${result.error}`);
    }

    return result.txid;
  }

  /**
   * Call a contract function.
   */
  async callContract(
    contractAddress: string,
    contractName: string,
    functionName: string,
    args: unknown[],
    fee?: number
  ): Promise<string> {
    const nonce = await this.getNextNonce();

    // Convert args to Clarity values
    const clarityArgs = args.map((arg) => {
      if (typeof arg === "bigint" || typeof arg === "number") {
        return uintCV(arg);
      }
      if (typeof arg === "string" && arg.startsWith("SP")) {
        return principalCV(arg);
      }
      if (typeof arg === "string") {
        return stringAsciiCV(arg);
      }
      if (arg instanceof Uint8Array) {
        return bufferCV(arg);
      }
      throw new Error(`Unsupported arg type: ${typeof arg}`);
    });

    const transaction = await makeContractCall({
      contractAddress,
      contractName,
      functionName,
      functionArgs: clarityArgs,
      senderKey: this.senderKey,
      nonce,
      fee: fee || 50_000,
      network: this.stacksNetwork,
      anchorMode: AnchorMode.Any,
      postConditionMode: PostConditionMode.Allow,
    });

    const result = await broadcastTransaction({
      transaction,
      network: this.stacksNetwork,
    });

    if ("error" in result) {
      throw new Error(`Call failed: ${result.error}`);
    }

    return result.txid;
  }

  /**
   * Get next valid nonce for sender.
   */
  private async getNextNonce(): Promise<bigint> {
    const response = await fetch(
      `${this.network.apiUrl}/extended/v1/address/${this.senderAddress}/nonces`
    );

    if (!response.ok) {
      throw new Error(`Failed to get nonce: ${response.statusText}`);
    }

    const data = await response.json();
    return BigInt(data.possible_next_nonce);
  }

  /**
   * Wait for transaction confirmation.
   */
  private async waitForConfirmation(
    txId: string,
    maxAttempts = 60,
    intervalMs = 5000
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(
        `${this.network.apiUrl}/extended/v1/tx/${txId}`
      );

      if (response.ok) {
        const data = await response.json();
        if (data.tx_status === "success") {
          return;
        }
        if (data.tx_status === "abort_by_response") {
          throw new Error(`Transaction aborted: ${data.tx_result?.repr || "unknown"}`);
        }
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Transaction ${txId} not confirmed after ${maxAttempts} attempts`);
  }

  /**
   * Check if an address has sufficient STX for deployment.
   */
  async checkBalance(): Promise<{ stx: bigint; sufficient: boolean }> {
    const response = await fetch(
      `${this.network.apiUrl}/extended/v1/address/${this.senderAddress}/balances`
    );

    if (!response.ok) {
      throw new Error(`Failed to get balance: ${response.statusText}`);
    }

    const data = await response.json();
    const stx = BigInt(data.stx?.balance || "0");

    // Need at least 1 STX for deployments
    const sufficient = stx >= BigInt("1000000");

    return { stx, sufficient };
  }

  /**
   * Get transaction status.
   */
  async getTxStatus(txId: string): Promise<{
    status: string;
    confirmed: boolean;
    error?: string;
  }> {
    const response = await fetch(
      `${this.network.apiUrl}/extended/v1/tx/${txId}`
    );

    if (!response.ok) {
      return { status: "unknown", confirmed: false, error: "TX not found" };
    }

    const data = await response.json();

    return {
      status: data.tx_status,
      confirmed: data.tx_status === "success",
      error: data.tx_status === "abort_by_response"
        ? data.tx_result?.repr
        : undefined,
    };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a deployer from environment variables.
 */
export function createDeployerFromEnv(): ContractDeployer {
  const network = (process.env.STACKS_NETWORK || "testnet") as "mainnet" | "testnet";
  const senderKey = process.env.DEPLOYER_PRIVATE_KEY;
  const senderAddress = process.env.DEPLOYER_ADDRESS;

  if (!senderKey || !senderAddress) {
    throw new Error("Missing DEPLOYER_PRIVATE_KEY or DEPLOYER_ADDRESS");
  }

  return new ContractDeployer(network, senderKey, senderAddress);
}
