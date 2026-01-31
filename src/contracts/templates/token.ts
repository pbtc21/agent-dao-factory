/**
 * Token Contract Template
 * =======================
 * Generates a SIP-010 compliant governance token for agent DAOs.
 */

import type { DAOConfig } from "../../types";

export function generateTokenContract(config: DAOConfig): string {
  return `
;; ============================================================
;; ${config.name} Token
;; ============================================================
;; SIP-010 compliant governance token.
;; Symbol: ${config.symbol}
;; Total Supply: ${config.totalSupply.toString()}
;;
;; Allocation:
;; - Founder: ${config.founderBp / 100}%
;; - Participants: ${config.participantBp / 100}%
;; - Treasury: ${config.treasuryBp / 100}%
;; - Verifier: ${config.verifierBp / 100}%
;; ============================================================

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; ============================================================
;; Constants
;; ============================================================

(define-constant TOKEN_NAME "${config.name}")
(define-constant TOKEN_SYMBOL "${config.symbol}")
(define-constant TOKEN_DECIMALS u8)
(define-constant TOKEN_URI (some u"https://aibtc.dev/tokens/${config.symbol.toLowerCase()}.json"))

(define-constant MAX_SUPPLY u${config.totalSupply.toString()})

;; Allocation basis points
(define-constant FOUNDER_BP u${config.founderBp})
(define-constant PARTICIPANT_BP u${config.participantBp})
(define-constant TREASURY_BP u${config.treasuryBp})
(define-constant VERIFIER_BP u${config.verifierBp})

;; Errors
(define-constant ERR_UNAUTHORIZED (err u2001))
(define-constant ERR_INSUFFICIENT_BALANCE (err u2002))
(define-constant ERR_INVALID_AMOUNT (err u2003))
(define-constant ERR_ALREADY_DISTRIBUTED (err u2004))
(define-constant ERR_NOT_TOKEN_OWNER (err u2005))

;; ============================================================
;; Data Variables
;; ============================================================

(define-data-var token-owner principal tx-sender)
(define-data-var total-minted uint u0)
(define-data-var distribution-complete bool false)

;; ============================================================
;; Fungible Token Definition
;; ============================================================

(define-fungible-token ${config.symbol.toLowerCase()} MAX_SUPPLY)

;; ============================================================
;; SIP-010 Implementation
;; ============================================================

(define-public (transfer
    (amount uint)
    (sender principal)
    (recipient principal)
    (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR_UNAUTHORIZED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (try! (ft-transfer? ${config.symbol.toLowerCase()} amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name)
  (ok TOKEN_NAME)
)

(define-read-only (get-symbol)
  (ok TOKEN_SYMBOL)
)

(define-read-only (get-decimals)
  (ok TOKEN_DECIMALS)
)

(define-read-only (get-balance (account principal))
  (ok (ft-get-balance ${config.symbol.toLowerCase()} account))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply ${config.symbol.toLowerCase()}))
)

(define-read-only (get-token-uri)
  (ok TOKEN_URI)
)

;; ============================================================
;; Distribution Functions
;; ============================================================

;; Distribute to founder (${config.founderBp / 100}%)
(define-public (distribute-founder (founder principal))
  (let (
    (amount (/ (* MAX_SUPPLY FOUNDER_BP) u10000))
  )
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get distribution-complete)) ERR_ALREADY_DISTRIBUTED)
    (try! (ft-mint? ${config.symbol.toLowerCase()} amount founder))
    (var-set total-minted (+ (var-get total-minted) amount))
    (ok amount)
  )
)

;; Distribute to participant (from ${config.participantBp / 100}% pool)
(define-public (distribute-participant
    (participant principal)
    (allocation-bp uint))
  (let (
    (participant-pool (/ (* MAX_SUPPLY PARTICIPANT_BP) u10000))
    (amount (/ (* participant-pool allocation-bp) u10000))
  )
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get distribution-complete)) ERR_ALREADY_DISTRIBUTED)
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (try! (ft-mint? ${config.symbol.toLowerCase()} amount participant))
    (var-set total-minted (+ (var-get total-minted) amount))
    (ok amount)
  )
)

;; Distribute to treasury (${config.treasuryBp / 100}%)
(define-public (distribute-treasury (treasury principal))
  (let (
    (amount (/ (* MAX_SUPPLY TREASURY_BP) u10000))
  )
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get distribution-complete)) ERR_ALREADY_DISTRIBUTED)
    (try! (ft-mint? ${config.symbol.toLowerCase()} amount treasury))
    (var-set total-minted (+ (var-get total-minted) amount))
    (ok amount)
  )
)

;; Distribute to verifier (${config.verifierBp / 100}%)
(define-public (distribute-verifier (verifier principal))
  (let (
    (amount (/ (* MAX_SUPPLY VERIFIER_BP) u10000))
  )
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (asserts! (not (var-get distribution-complete)) ERR_ALREADY_DISTRIBUTED)
    (try! (ft-mint? ${config.symbol.toLowerCase()} amount verifier))
    (var-set total-minted (+ (var-get total-minted) amount))
    (ok amount)
  )
)

;; Finalize distribution (prevents further minting)
(define-public (finalize-distribution)
  (begin
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (var-set distribution-complete true)
    (ok true)
  )
)

;; ============================================================
;; Owner Functions
;; ============================================================

;; Transfer ownership (e.g., to DAO governance)
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (var-set token-owner new-owner)
    (ok true)
  )
)

;; Mint (DAO only, post-distribution for rewards)
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get token-owner)) ERR_UNAUTHORIZED)
    (asserts! (var-get distribution-complete) ERR_UNAUTHORIZED)
    (asserts! (<= (+ (ft-get-supply ${config.symbol.toLowerCase()}) amount) MAX_SUPPLY) ERR_INVALID_AMOUNT)
    (ft-mint? ${config.symbol.toLowerCase()} amount recipient)
  )
)

;; Burn
(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-eq tx-sender owner) ERR_NOT_TOKEN_OWNER)
    (ft-burn? ${config.symbol.toLowerCase()} amount owner)
  )
)

;; ============================================================
;; Read-Only Helpers
;; ============================================================

(define-read-only (get-owner)
  (var-get token-owner)
)

(define-read-only (get-total-minted)
  (var-get total-minted)
)

(define-read-only (is-distribution-complete)
  (var-get distribution-complete)
)

(define-read-only (get-founder-amount)
  (/ (* MAX_SUPPLY FOUNDER_BP) u10000)
)

(define-read-only (get-participant-pool)
  (/ (* MAX_SUPPLY PARTICIPANT_BP) u10000)
)

(define-read-only (get-treasury-amount)
  (/ (* MAX_SUPPLY TREASURY_BP) u10000)
)

(define-read-only (get-verifier-amount)
  (/ (* MAX_SUPPLY VERIFIER_BP) u10000)
)
`.trim();
}
