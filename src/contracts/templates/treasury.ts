/**
 * Treasury Contract Template
 * ==========================
 * Multi-asset treasury with revenue distribution.
 */

import type { DAOConfig } from "../../types";

export function generateTreasuryContract(
  config: DAOConfig,
  tokenAddress: string
): string {
  return `
;; ============================================================
;; ${config.name} Treasury
;; ============================================================
;; Multi-asset treasury with revenue distribution.
;;
;; Revenue Model (PoetAI):
;; - ${config.profitDistributionBp / 100}% distributed to token holders
;; - ${config.reinvestmentBp / 100}% reinvested into treasury
;; ============================================================

;; ============================================================
;; Constants
;; ============================================================

(define-constant CONTRACT_OWNER tx-sender)
(define-constant TOKEN_CONTRACT '${tokenAddress})

;; Revenue distribution
(define-constant DISTRIBUTION_BP u${config.profitDistributionBp})
(define-constant REINVESTMENT_BP u${config.reinvestmentBp})

;; Errors
(define-constant ERR_UNAUTHORIZED (err u3001))
(define-constant ERR_ASSET_NOT_ALLOWED (err u3002))
(define-constant ERR_INSUFFICIENT_BALANCE (err u3003))
(define-constant ERR_INVALID_AMOUNT (err u3004))
(define-constant ERR_ALREADY_CLAIMED (err u3005))

;; ============================================================
;; Data Variables
;; ============================================================

(define-data-var treasury-owner principal tx-sender)
(define-data-var total-revenue uint u0)
(define-data-var distribution-epoch uint u0)

;; ============================================================
;; Data Maps
;; ============================================================

;; Allowed assets for treasury
(define-map allowed-assets principal bool)

;; Revenue per epoch (for distribution)
(define-map epoch-revenue uint uint)

;; Claimed status per epoch per holder
(define-map claimed { epoch: uint, holder: principal } bool)

;; ============================================================
;; Initialization
;; ============================================================

;; Allow DAO token and sBTC by default
(map-set allowed-assets TOKEN_CONTRACT true)
(map-set allowed-assets 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token true)

;; ============================================================
;; Public Functions
;; ============================================================

;; Deposit allowed tokens
(define-public (deposit-ft
    (ft <ft-trait>)
    (amount uint))
  (let (
    (asset-contract (contract-of ft))
  )
    (asserts! (is-asset-allowed asset-contract) ERR_ASSET_NOT_ALLOWED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (try! (contract-call? ft transfer amount tx-sender (as-contract tx-sender) none))
    (ok true)
  )
)

;; Withdraw tokens (owner/governance only)
(define-public (withdraw-ft
    (ft <ft-trait>)
    (amount uint)
    (recipient principal))
  (let (
    (asset-contract (contract-of ft))
  )
    (asserts! (is-authorized) ERR_UNAUTHORIZED)
    (asserts! (is-asset-allowed asset-contract) ERR_ASSET_NOT_ALLOWED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (as-contract
      (contract-call? ft transfer amount tx-sender recipient none))
  )
)

;; Record revenue for distribution
(define-public (record-revenue (amount uint))
  (begin
    (asserts! (is-authorized) ERR_UNAUTHORIZED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (var-set total-revenue (+ (var-get total-revenue) amount))
    (map-set epoch-revenue
      (var-get distribution-epoch)
      (+ (default-to u0 (map-get? epoch-revenue (var-get distribution-epoch))) amount))
    (ok true)
  )
)

;; Start new distribution epoch
(define-public (start-new-epoch)
  (begin
    (asserts! (is-authorized) ERR_UNAUTHORIZED)
    (var-set distribution-epoch (+ (var-get distribution-epoch) u1))
    (ok (var-get distribution-epoch))
  )
)

;; Claim distribution for epoch
(define-public (claim-distribution
    (epoch uint)
    (token-balance uint)
    (total-supply uint))
  (let (
    (revenue (default-to u0 (map-get? epoch-revenue epoch)))
    (distributable (/ (* revenue DISTRIBUTION_BP) u10000))
    (share (/ (* distributable token-balance) total-supply))
  )
    ;; Check not already claimed
    (asserts! (not (default-to false
      (map-get? claimed { epoch: epoch, holder: tx-sender })))
      ERR_ALREADY_CLAIMED)

    ;; Check valid amount
    (asserts! (> share u0) ERR_INVALID_AMOUNT)

    ;; Mark as claimed
    (map-set claimed { epoch: epoch, holder: tx-sender } true)

    ;; Transfer share (implementation depends on asset type)
    ;; This is simplified - real impl would transfer sBTC
    (ok share)
  )
)

;; ============================================================
;; Admin Functions
;; ============================================================

;; Allow/disallow asset
(define-public (set-asset-allowed (asset principal) (allowed bool))
  (begin
    (asserts! (is-authorized) ERR_UNAUTHORIZED)
    (map-set allowed-assets asset allowed)
    (ok true)
  )
)

;; Transfer ownership (to governance)
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get treasury-owner)) ERR_UNAUTHORIZED)
    (var-set treasury-owner new-owner)
    (ok true)
  )
)

;; ============================================================
;; Read-Only Functions
;; ============================================================

(define-read-only (get-owner)
  (var-get treasury-owner)
)

(define-read-only (get-total-revenue)
  (var-get total-revenue)
)

(define-read-only (get-current-epoch)
  (var-get distribution-epoch)
)

(define-read-only (get-epoch-revenue (epoch uint))
  (default-to u0 (map-get? epoch-revenue epoch))
)

(define-read-only (is-asset-allowed (asset principal))
  (default-to false (map-get? allowed-assets asset))
)

(define-read-only (has-claimed (epoch uint) (holder principal))
  (default-to false (map-get? claimed { epoch: epoch, holder: holder }))
)

(define-read-only (calculate-share
    (epoch uint)
    (token-balance uint)
    (total-supply uint))
  (let (
    (revenue (default-to u0 (map-get? epoch-revenue epoch)))
    (distributable (/ (* revenue DISTRIBUTION_BP) u10000))
  )
    (/ (* distributable token-balance) total-supply)
  )
)

;; ============================================================
;; Private Functions
;; ============================================================

(define-private (is-authorized)
  (or
    (is-eq tx-sender (var-get treasury-owner))
    (is-eq tx-sender CONTRACT_OWNER)
  )
)

;; ============================================================
;; Trait Definition
;; ============================================================

(use-trait ft-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
`.trim();
}
