# DeFi Recipes on Arc
## Project Vision v2.1

> **Trusted, Secure, and Automated DeFi Workflows on Arc**  
> *Focus: Core Execution, Smart Contract Security & 2 Official Recipes*

**Version:** 2.1 (Lean Core Execution & Security Focus)  
**Status:** Vision & MVP Specification  
**Network:** Arc Testnet (Chain ID `5042002`)  
**Category:** DeFi Automation / Yield Workflows  
**Token Scope (Testnet):** USDC, EURC, cirBTC  

---

# Disclaimer

DeFi Recipes on Arc is an independent community-built application designed for the Arc ecosystem.

It is **not** an official product of Arc Network and is not affiliated with or endorsed by the Arc team.

---

# Executive Summary

DeFi on Arc offers ultra-low fees, sub-second finality, and USDC as a native gas token. However, maximizing yields still requires continuous manual monitoring, claiming rewards, and recurring swaps for accumulation strategies.

**DeFi Recipes on Arc** solves this by providing a **secure workflow automation layer**. Instead of requiring users to construct complex interactions or trust unverified third-party bots, the platform delivers audited, non-custodial **Official Recipes**—pre-packaged automated financial workflows that execute transparently and predictably on Arc.

For the current MVP scope, the project focuses 100% on **Core Execution, Smart Contract Security, and 2 Battle-Tested Official Recipes**, postponing complex community marketplaces and visual builders to later phases.

---

# Vision

Make recurring DeFi automation on Arc as simple, safe, and transparent as a single transaction.

---

# Mission

Eliminate repetitive manual operations in DeFi by providing audited, non-custodial automated workflows optimized for USDC on Arc.

---

# Core Principles

## 1. Security & Execution First
Every line of code in the execution engine prioritizes user asset protection over flashy features.

## 2. Non-Custodial & Scoped Authorization
Users maintain 100% ownership of their assets. Automation agents only receive restricted, scoped permissions (Session Keys / Delegation) to execute specific pre-approved actions.

## 3. Transparency & Simulation
Every recipe explicitly defines what it does, when it triggers, and which protocols it interacts with. Simulations run on-chain before user activation.

## 4. Whitelisted Protocols Only
In the MVP phase, execution is strictly constrained to audited, whitelisted Arc protocols and approved swap route destinations resolved through Arc App Kit Swap (https://docs.arc.io/app-kit/swap).

---

# The Core 2 Official MVP Recipes

To deliver immediate value with maximum security, MVP development centers on **2 curated, high-utility USDC recipes**:

### Recipe 1: USDC Yield Auto-Compounder
* **Goal:** Maximize compounding yield on Arc Lending.
* **Workflow:** Deposit USDC into Arc Lending → Monitor accrued rewards → Weekly claim rewards → Swap rewards to USDC via Arc App Kit Swap routes → Re-deposit into Arc Lending.
* **Risk Level:** Low.

### Recipe 2: USDC -> EURC Recurring DCA (Dollar-Cost Averaging)
* **Goal:** Automated periodic asset accumulation.
* **Workflow:** Hold USDC in user wallet → Trigger weekly/monthly → Swap pre-set USDC amount to EURC via Arc App Kit Swap routes with slippage limits → Transfer acquired EURC back to user wallet.
* **Risk Level:** Low-Medium.


# Architecture & Security Model

```
[ User Wallet ]
      │
      │ 1. Scoped Permission (Session Key / Delegation)
      ▼
[ Automation Keeper Engine ] (Off-chain Trigger)
      │
      │ 2. Submit Execution Request
      ▼
[ Shared Executor Contract ] (Audited On-chain Proxy)
      │
      ├─► Validate Scoped Scope & Slippage Limits
      ├─► Check Protocol Whitelist
      │
      ▼ 3. Execute
[ Whitelisted Arc Protocols ] (Arc Lending / App Kit-resolved swap destinations)
```

## Security Guardrails

1. **Shared Executor Pattern:** Instead of deploying custom smart contracts per recipe, a single, heavily-audited **Shared Executor Contract** processes all recipe steps. This minimizes the smart contract attack surface.
2. **Scoped Authorization:** The automation keeper *never* has transfer authority to arbitrary addresses. It can only execute whitelisted function signatures on whitelisted contract addresses with strict input boundaries.
3. **Slippage & Price Impact Protection:** All swap and liquidity steps enforce strict maximum slippage tolerances to protect against front-running and MEV.
4. **Emergency Pause:** Users can revoke delegation or pause recipe execution instantly at any time.

---

# MVP Scope vs. Future Expansion

| Feature / Component | MVP Scope (v2.1) | Future Phases |
| :--- | :--- | :--- |
| **Official Recipes** | **Included (2 Core Recipes)** | Expanded Suite |
| **Shared Executor Contract** | **Included (Audited & Scoped)** | Modular Plugins |
| **Off-chain Keeper Engine** | **Included (Cron & Event Triggers)** | Decentralized Keeper Network |
| **UI Dashboard** | **Included (1-Click Activate & Portfolio Tracker)** | Advanced Analytics |
| **On-Chain Simulation** | **Included (Pre-approval Check)** | Real-time Strategy Backtesting |
| **Visual Recipe Builder** | Out of Scope | Phase 2/3 |
| **Permissionless Marketplace** | Out of Scope | Phase 3 |
| **Recipe Forking & Community DSL** | Out of Scope | Phase 3 |
| **Trust Score & Reputation System** | Out of Scope | Phase 3 |

---

# Strategic Roadmap

```
Phase 1: Core Execution & Security (Current Focus)
  ├── 2 Official USDC Recipes
  ├── Audited Shared Executor Contract
  ├── Scoped Session Key Delegation
  └── 1-Click UI & Execution Tracker

Phase 2: Automation Keeper Scaling & Reliability
  ├── Multi-region Off-chain Keeper Nodes
  ├── Automated Fallback & Retry Logic
  └── Real-time Alerting & Execution History

Phase 3: Developer DSL & Verified Marketplace
  ├── Recipe Specification (YAML/JSON Schema)
  ├── Community Recipe Verification Process
  └── Recipe Marketplace & Trust Score System

Phase 4: Ecosystem Expansion & Advanced Tooling
  ├── Visual Drag-and-Drop Recipe Builder
  ├── DAO Treasury Automation Recipes
  └── Cross-protocol Strategy Integrations
```

---

# Summary

By narrowing the immediate focus to **Core Execution, Smart Contract Security, and 2 Official Recipes**, DeFi Recipes on Arc establishes a rock-solid foundation. This pragmatic approach delivers high value to Arc users quickly while keeping development lean and maintainable.