# Quy tắc Đặt tên (Naming Conventions) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Áp dụng cho:** Mã nguồn Hợp đồng (Solidity), Frontend (React/TypeScript), Backend Keeper (Node.js/Prisma), Cơ sở dữ liệu và Git Branches.

---

## 1. Quy tắc Đặt tên Solidity (Solidity Naming Standards)

| Thành phần (Element) | Cú pháp (Case Style) | Ví dụ minh họa | Ghi chú |
| :--- | :--- | :--- | :--- |
| **Contracts & Base Contracts** | `PascalCase` | `SharedExecutorProxy`, `RecipeGuardrail` | Danh từ mô tả rõ vai trò |
| **Interfaces** | `IPascalCase` | `ISharedExecutor`, `IRecipeGuardrail` | Luôn bắt đầu bằng tiền tố `I` |
| **Libraries** | `PascalCase` | `RecipeExecutionLib`, `SlippageMath` | Tập hợp helper statics |
| **Events** | `PascalCase` | `RecipeExecuted`, `SessionKeyRegistered` | Dạng động từ thể quá khứ |
| **Custom Errors** | `PascalCase` | `UnauthorizedCaller`, `InvalidSlippage` | Tiết kiệm Gas hơn `require` strings |
| **Functions (Public/External)**| `camelCase` | `executeRecipeStep()`, `verifyGuardrail()` | Động từ + danh từ mô tả hành động |
| **Functions (Internal/Private)**| `_camelCase` | `_validateSlippage()`, `_transferUsdc()` | Bắt buộc bắt đầu bằng gạch dưới `_` |
| **State Variables (Public/Ext)**| `camelCase` | `isPaused`, `totalRecipesExecuted` | Rõ ràng, không viết tắt vô nghĩa |
| **State Variables (Internal/Priv)**| `_camelCase` | `_sessionKeyRegistry`, `_guardrail` | Tiền tố `_` để phân biệt phạm vi |
| **Constants** | `UPPER_SNAKE_CASE` | `MAX_SLIPPAGE_BPS`, `ARC_CHAIN_ID` | Viết hoa hoàn toàn |
| **Immutable Variables** | `camelCase` hoặc `i_camel` | `arcUsdcToken`, `i_sharedProxy` | Khai báo 1 lần trong Constructor |

```solidity
// Ví dụ thực tế về Quy tắc đặt tên trong Solidity
contract SharedExecutorProxy is ISharedExecutor {
    // Constants & Immutable
    uint256 public constant MAX_SLIPPAGE_BPS = 10000;
    address public immutable arcUsdcToken;

    // Internal State
    address private _owner;

    // Custom Error
    error InvalidTargetProtocol(address target);

    // Event
    event StepExecuted(address indexed target, bytes4 indexed selector);

    // External Function
    function executeStep(address targetProtocol, bytes calldata data) external {
        if (targetProtocol == address(0)) revert InvalidTargetProtocol(targetProtocol);
        _internalExecute(targetProtocol, data);
    }

    // Internal Function
    function _internalExecute(address targetProtocol, bytes calldata data) internal {
        // ...
    }
}
```

---

## 2. Quy tắc Đặt tên TypeScript & React (Frontend & Keeper)

### 2.1. React Components & Files
- **Tên Component & File JSX/TSX:** `PascalCase` (Ví dụ: `RecipeCard.tsx`, `SimulationModal.tsx`, `WalletHeader.tsx`).
- **File Utilities & Hooks:** `kebab-case` cho tên file (Ví dụ: `format-balance.ts`, `use-arc-balance.ts`).
- **Custom Hooks:** Bắt buộc bắt đầu bằng tiền tố `use` theo chuẩn React (Ví dụ: `useRecipeExecution()`, `useSessionKey()`).

### 2.2. Biến, Types & Interfaces
- **Variables & Functions:** `camelCase` (Ví dụ: `userUsdcBalance`, `calculateNetApy()`).
- **Interfaces & Type Aliases:** `PascalCase`. Không cần dùng tiền tố `I` cho Type/Interface TS ngoại trừ các DTO/Interface đặc biệt.
  - Ví dụ: `type RecipeStatus = 'active' | 'paused' | 'failed';`
  - Ví dụ: `interface RecipeStepParams { targetContract: string; callData: string; }`
- **Enums:** `PascalCase` cho tên Enum và `UPPER_SNAKE_CASE` hoặc `PascalCase` cho các giá trị member.

```typescript
export enum RecipeType {
  AUTO_COMPOUND = 'AUTO_COMPOUND',
  YIELD_REBALANCER = 'YIELD_REBALANCER',
  DCA_VAULT = 'DCA_VAULT',
}
```

---

## 3. Quy tắc Đặt tên Cơ sở Dữ liệu (Prisma & PostgreSQL)

- **Prisma Schema Models:** `PascalCase` số ít (Ví dụ: `User`, `Recipe`, `ExecutionLog`).
- **PostgreSQL Physical Tables:** `snake_case` số nhiều (Ví dụ: `users`, `recipes`, `execution_logs`).
- **PostgreSQL Columns:** `snake_case` (Ví dụ: `user_address`, `gas_spent_usdc`, `created_at`).

```prisma
model ExecutionLog {
  id              String   @id @default(uuid())
  recipeId        String   @map("recipe_id")
  transactionHash String   @map("transaction_hash")
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("execution_logs")
}
```

---

## 4. Quy tắc Đặt tên Nhánh Git (Git Branching Conventions)

Cấu trúc tên nhánh: `<type>/<short-description-kebab-case>`

- **Feature (Chức năng mới):** `feat/session-key-delegation`, `feat/simulation-modal`
- **Bug Fix (Sửa lỗi):** `fix/slippage-calculation-bug`, `fix/viem-gas-estimation`
- **Documentation (Tài liệu):** `docs/update-tech-stack`, `docs/add-naming-conventions`
- **Refactoring (Cấu trúc lại):** `refactor/executor-guardrails`, `refactor/wagmi-hooks`
- **Testing (Kiểm thử):** `test/forge-fuzz-shared-proxy`
