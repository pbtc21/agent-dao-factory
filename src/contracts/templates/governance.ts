/**
 * Governance Contract Template
 * ============================
 * Hybrid governance with founder control → decentralized transition.
 */

import type { DAOConfig, GovernancePhase } from "../../types";

export function generateGovernanceContract(
  config: DAOConfig,
  tokenAddress: string,
  treasuryAddress: string
): string {
  return `
;; ============================================================
;; ${config.name} Governance
;; ============================================================
;; Hybrid governance system:
;; - Phase 1: Founder control (fast decisions during build)
;; - Phase 2: Transitioning (preparing for decentralization)
;; - Phase 3: Decentralized (token holder voting)
;;
;; Voting:
;; - Quorum: ${config.votingQuorum}%
;; - Threshold: ${config.votingThreshold}%
;; - Core changes: ${config.coreChangeThreshold}% required
;; ============================================================

;; ============================================================
;; Constants
;; ============================================================

(define-constant CONTRACT_OWNER tx-sender)
(define-constant TOKEN_CONTRACT '${tokenAddress})
(define-constant TREASURY_CONTRACT '${treasuryAddress})

;; Governance phases
(define-constant PHASE_FOUNDER_CONTROL u1)
(define-constant PHASE_TRANSITIONING u2)
(define-constant PHASE_DECENTRALIZED u3)

;; Voting parameters
(define-constant VOTING_QUORUM u${config.votingQuorum})        ;; ${config.votingQuorum}%
(define-constant VOTING_THRESHOLD u${config.votingThreshold})  ;; ${config.votingThreshold}%
(define-constant CORE_CHANGE_THRESHOLD u${config.coreChangeThreshold})  ;; ${config.coreChangeThreshold}%
(define-constant PROPOSAL_BOND u${config.proposalBond.toString()})

;; Timing (in Bitcoin blocks)
(define-constant VOTING_DELAY u12)     ;; ~2 hours
(define-constant VOTING_PERIOD u144)   ;; ~24 hours
(define-constant EXECUTION_DELAY u12)  ;; ~2 hours after voting
(define-constant EXECUTION_WINDOW u72) ;; ~12 hours to execute

;; Errors
(define-constant ERR_UNAUTHORIZED (err u4001))
(define-constant ERR_INVALID_PHASE (err u4002))
(define-constant ERR_PROPOSAL_NOT_FOUND (err u4003))
(define-constant ERR_VOTING_NOT_ACTIVE (err u4004))
(define-constant ERR_ALREADY_VOTED (err u4005))
(define-constant ERR_QUORUM_NOT_MET (err u4006))
(define-constant ERR_THRESHOLD_NOT_MET (err u4007))
(define-constant ERR_NOT_EXECUTABLE (err u4008))
(define-constant ERR_EXPIRED (err u4009))
(define-constant ERR_INSUFFICIENT_BOND (err u4010))

;; ============================================================
;; Data Variables
;; ============================================================

(define-data-var governance-phase uint PHASE_FOUNDER_CONTROL)
(define-data-var founder principal tx-sender)
(define-data-var proposal-count uint u0)

;; ============================================================
;; Data Maps
;; ============================================================

(define-map proposals
  uint
  {
    proposer: principal,
    title: (string-ascii 64),
    description: (string-utf8 256),
    action-type: (string-ascii 32),
    action-data: (buff 256),
    created-at: uint,
    voting-starts: uint,
    voting-ends: uint,
    votes-for: uint,
    votes-against: uint,
    executed: bool,
    is-core-change: bool
  }
)

(define-map votes
  { proposal-id: uint, voter: principal }
  { vote: bool, amount: uint }
)

;; ============================================================
;; Public Functions
;; ============================================================

;; Create proposal (decentralized phase only, or founder in other phases)
(define-public (create-proposal
    (title (string-ascii 64))
    (description (string-utf8 256))
    (action-type (string-ascii 32))
    (action-data (buff 256))
    (is-core-change bool))
  (let (
    (phase (var-get governance-phase))
    (proposal-id (+ (var-get proposal-count) u1))
    (current-block burn-block-height)
  )
    ;; In founder phase, only founder can propose
    (asserts! (or
      (is-eq phase PHASE_DECENTRALIZED)
      (is-eq tx-sender (var-get founder)))
      ERR_UNAUTHORIZED)

    ;; Create proposal
    (map-set proposals proposal-id {
      proposer: tx-sender,
      title: title,
      description: description,
      action-type: action-type,
      action-data: action-data,
      created-at: current-block,
      voting-starts: (+ current-block VOTING_DELAY),
      voting-ends: (+ current-block VOTING_DELAY VOTING_PERIOD),
      votes-for: u0,
      votes-against: u0,
      executed: false,
      is-core-change: is-core-change
    })

    (var-set proposal-count proposal-id)
    (ok proposal-id)
  )
)

;; Vote on proposal
(define-public (vote (proposal-id uint) (vote-for bool))
  (let (
    (proposal (unwrap! (map-get? proposals proposal-id) ERR_PROPOSAL_NOT_FOUND))
    (current-block burn-block-height)
    ;; Would need to get actual balance from token contract
    (voter-balance u1000000000000)  ;; Placeholder
  )
    ;; Check voting is active
    (asserts! (>= current-block (get voting-starts proposal)) ERR_VOTING_NOT_ACTIVE)
    (asserts! (< current-block (get voting-ends proposal)) ERR_VOTING_NOT_ACTIVE)

    ;; Check not already voted
    (asserts! (is-none (map-get? votes { proposal-id: proposal-id, voter: tx-sender }))
      ERR_ALREADY_VOTED)

    ;; Record vote
    (map-set votes
      { proposal-id: proposal-id, voter: tx-sender }
      { vote: vote-for, amount: voter-balance })

    ;; Update proposal votes
    (map-set proposals proposal-id
      (merge proposal {
        votes-for: (if vote-for
          (+ (get votes-for proposal) voter-balance)
          (get votes-for proposal)),
        votes-against: (if vote-for
          (get votes-against proposal)
          (+ (get votes-against proposal) voter-balance))
      }))

    (ok true)
  )
)

;; Execute proposal
(define-public (execute-proposal (proposal-id uint))
  (let (
    (proposal (unwrap! (map-get? proposals proposal-id) ERR_PROPOSAL_NOT_FOUND))
    (current-block burn-block-height)
    (phase (var-get governance-phase))
    (total-votes (+ (get votes-for proposal) (get votes-against proposal)))
    ;; Would need actual supply from token contract
    (total-supply u100000000000000000)  ;; Placeholder
    (quorum-met (>= (* total-votes u100) (* total-supply VOTING_QUORUM)))
    (threshold (if (get is-core-change proposal) CORE_CHANGE_THRESHOLD VOTING_THRESHOLD))
    (threshold-met (>= (* (get votes-for proposal) u100) (* total-votes threshold)))
  )
    ;; Check not already executed
    (asserts! (not (get executed proposal)) ERR_NOT_EXECUTABLE)

    ;; In decentralized phase, check voting results
    (if (is-eq phase PHASE_DECENTRALIZED)
      (begin
        ;; Check voting ended
        (asserts! (>= current-block (get voting-ends proposal)) ERR_VOTING_NOT_ACTIVE)

        ;; Check within execution window
        (asserts! (< current-block (+ (get voting-ends proposal) EXECUTION_DELAY EXECUTION_WINDOW))
          ERR_EXPIRED)

        ;; Check quorum and threshold
        (asserts! quorum-met ERR_QUORUM_NOT_MET)
        (asserts! threshold-met ERR_THRESHOLD_NOT_MET)
      )
      ;; In founder phase, only founder can execute
      (asserts! (is-eq tx-sender (var-get founder)) ERR_UNAUTHORIZED)
    )

    ;; Mark as executed
    (map-set proposals proposal-id (merge proposal { executed: true }))

    ;; Execute action would happen here based on action-type
    (ok true)
  )
)

;; ============================================================
;; Founder Functions
;; ============================================================

;; Execute action directly (founder control phase only)
(define-public (founder-execute
    (action-type (string-ascii 32))
    (action-data (buff 256)))
  (begin
    (asserts! (is-eq tx-sender (var-get founder)) ERR_UNAUTHORIZED)
    (asserts! (is-eq (var-get governance-phase) PHASE_FOUNDER_CONTROL) ERR_INVALID_PHASE)
    ;; Execute action based on type
    (ok true)
  )
)

;; Transition to next governance phase
(define-public (transition-phase)
  (let (
    (current-phase (var-get governance-phase))
  )
    (asserts! (is-eq tx-sender (var-get founder)) ERR_UNAUTHORIZED)
    (asserts! (< current-phase PHASE_DECENTRALIZED) ERR_INVALID_PHASE)

    (var-set governance-phase (+ current-phase u1))
    (ok (var-get governance-phase))
  )
)

;; Transfer founder role
(define-public (transfer-founder (new-founder principal))
  (begin
    (asserts! (is-eq tx-sender (var-get founder)) ERR_UNAUTHORIZED)
    (var-set founder new-founder)
    (ok true)
  )
)

;; ============================================================
;; Read-Only Functions
;; ============================================================

(define-read-only (get-governance-phase)
  (var-get governance-phase)
)

(define-read-only (get-founder)
  (var-get founder)
)

(define-read-only (get-proposal (proposal-id uint))
  (map-get? proposals proposal-id)
)

(define-read-only (get-proposal-count)
  (var-get proposal-count)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? votes { proposal-id: proposal-id, voter: voter })
)

(define-read-only (is-decentralized)
  (is-eq (var-get governance-phase) PHASE_DECENTRALIZED)
)

(define-read-only (get-voting-parameters)
  {
    quorum: VOTING_QUORUM,
    threshold: VOTING_THRESHOLD,
    core-change-threshold: CORE_CHANGE_THRESHOLD,
    voting-delay: VOTING_DELAY,
    voting-period: VOTING_PERIOD,
    execution-delay: EXECUTION_DELAY,
    execution-window: EXECUTION_WINDOW
  }
)
`.trim();
}
