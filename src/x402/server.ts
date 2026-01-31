/**
 * x402 Payment Server
 * ===================
 * Provides x402 payment-gated API endpoints for DAO services.
 *
 * Services are paid for in sBTC, with revenue going to the DAO treasury.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { X402Config, X402PaymentVerification } from "../types";

// ============================================================
// x402 Payment Middleware
// ============================================================

interface X402Headers {
  "x-payment-signature"?: string;
  "x-payment-tx"?: string;
  "x-payment-amount"?: string;
}

/**
 * Verify x402 payment from request headers.
 */
async function verifyPayment(
  headers: X402Headers,
  config: X402Config
): Promise<X402PaymentVerification> {
  const txId = headers["x-payment-tx"];
  const signature = headers["x-payment-signature"];
  const amount = parseInt(headers["x-payment-amount"] || "0", 10);

  if (!txId || !signature) {
    return { valid: false, error: "Missing payment headers" };
  }

  if (amount < config.priceInSats) {
    return { valid: false, error: `Insufficient payment: ${amount} < ${config.priceInSats}` };
  }

  try {
    // Verify with facilitator
    const response = await fetch(`${config.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txId,
        signature,
        expectedAmount: config.priceInSats,
        expectedRecipient: config.recipientAddress,
      }),
    });

    if (!response.ok) {
      return { valid: false, error: "Facilitator verification failed" };
    }

    const result = await response.json();

    return {
      valid: result.valid,
      txId,
      amount,
      sender: result.sender,
      error: result.error,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Verification error",
    };
  }
}

/**
 * Generate x402 payment request headers.
 */
function generatePaymentRequired(config: X402Config): Record<string, string> {
  return {
    "X-Payment-Required": "true",
    "X-Payment-Amount": config.priceInSats.toString(),
    "X-Payment-Asset": "sbtc",
    "X-Payment-Network": "stacks-mainnet",
    "X-Payment-Recipient": config.recipientAddress,
    "X-Payment-Description": config.description,
    "X-Payment-Facilitator": config.facilitatorUrl,
  };
}

// ============================================================
// x402 Hono Middleware
// ============================================================

/**
 * Create x402 middleware for Hono.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export function x402Middleware(config: X402Config) {
  return async (c: any, next: () => Promise<void>) => {
    // Skip if x402 disabled
    if (!config.enabled) {
      return next();
    }

    // Check for payment headers
    const headers: X402Headers = {
      "x-payment-signature": c.req.header("x-payment-signature"),
      "x-payment-tx": c.req.header("x-payment-tx"),
      "x-payment-amount": c.req.header("x-payment-amount"),
    };

    // If no payment headers, return 402
    if (!headers["x-payment-tx"]) {
      return c.json(
        {
          error: "Payment required",
          price: config.priceInSats,
          asset: "sbtc",
          recipient: config.recipientAddress,
        },
        402,
        generatePaymentRequired(config)
      );
    }

    // Verify payment
    const verification = await verifyPayment(headers, config);

    if (!verification.valid) {
      return c.json(
        {
          error: "Invalid payment",
          details: verification.error,
        },
        402,
        generatePaymentRequired(config)
      );
    }

    // Payment verified - continue
    c.set("payment", verification);
    return next();
  };
}

// ============================================================
// DAO Service API
// ============================================================

/**
 * Create x402-gated DAO service API.
 */
export function createDAOServiceAPI(config: X402Config) {
  const app = new Hono();

  // CORS
  app.use("/*", cors());

  // Health check (free)
  app.get("/health", (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Price info (free)
  app.get("/price", (c) => {
    return c.json({
      priceInSats: config.priceInSats,
      asset: "sbtc",
      network: "stacks-mainnet",
      recipient: config.recipientAddress,
      description: config.description,
    });
  });

  // Protected endpoints with x402
  const protected_ = new Hono();
  protected_.use("/*", x402Middleware(config));

  // Example: DAO verification service
  protected_.post("/verify-agent", async (c) => {
    const body = await c.req.json();
    const { address, githubRepo } = body;

    // This would call the actual verification logic
    // For now, return mock response
    return c.json({
      verified: true,
      address,
      githubRepo,
      trustLevel: "basic",
      payment: (c as any).get("payment"),
    });
  });

  // Example: DAO creation service
  protected_.post("/create-dao", async (c) => {
    const body = await c.req.json();

    // This would call the actual DAO creation logic
    return c.json({
      success: true,
      message: "DAO creation queued",
      estimatedDeployTime: "~15 minutes",
      payment: (c as any).get("payment"),
    });
  });

  // Example: Query service
  protected_.get("/dao/:id", async (c) => {
    const daoId = c.req.param("id");

    return c.json({
      daoId,
      name: "Example DAO",
      status: "deployed",
      payment: (c as any).get("payment"),
    });
  });

  // Mount protected routes
  app.route("/api/v1", protected_);

  return app;
}

// ============================================================
// Revenue Recording
// ============================================================

/**
 * Record payment revenue to treasury.
 */
export async function recordRevenue(
  treasuryAddress: string,
  amount: number,
  txId: string,
  network: "mainnet" | "testnet"
): Promise<boolean> {
  // This would call the treasury contract to record revenue
  // For now, just log it
  console.log(`[revenue] Recording ${amount} sats from ${txId} to ${treasuryAddress}`);
  return true;
}

// ============================================================
// Default Export
// ============================================================

export default {
  x402Middleware,
  createDAOServiceAPI,
  verifyPayment,
  recordRevenue,
};
