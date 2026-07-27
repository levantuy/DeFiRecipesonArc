# Quy chuẩn Phong cách Mã nguồn (Coding Style Guide) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Áp dụng cho:** Hợp đồng thông minh (Solidity), Frontend Web3 (Next.js/TypeScript), Off-chain Keeper Engine (Node.js/Prisma)

---

## 1. Nguyên tắc cốt lõi (Core Principles)

1. **Khả đọc & Tự giải thích (Readability & Self-Documenting):** Code phải minh bạch, đặt tên hàm/biến rõ ràng theo ngữ cảnh DeFi. Ưu tiên tự giải thích thay vì viết comment thừa thãi.
2. **An toàn Kiểu dữ liệu (Strict Type-Safety):** Tuyệt đối không sử dụng `any` trong TypeScript hay ép kiểu thiếu kiểm soát trong Solidity.
3. **DRY (Don't Repeat Yourself):** Tái sử dụng các module helper, custom hooks, và contract base libraries (OpenZeppelin).
4. **Nhất quán Định dạng (Automated Formatting):** Định dạng tự động bằng Solhint (Solidity) và ESLint + Prettier (TypeScript).

---

## 2. Quy chuẩn Solidity (Solidity ^0.8.24 & Foundry)

### 2.1. Định dạng & Thụt lề (Formatting)
- Sử dụng **4 khoảng trắng (spaces)** cho mỗi mức thụt lề (không dùng Tabs).
- Giới hạn độ dài dòng: **100 ký tự**.
- Luôn khai báo phiên bản compiler cụ thể: `pragma solidity ^0.8.24;`.

### 2.2. Thứ tự Cấu trúc File Hợp đồng (Contract Layout Order)
Mỗi file hợp đồng phải tuân theo đúng thứ tự tiêu chuẩn sau:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// 1. Imports
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// 2. Interfaces & Libraries
// 3. Errors (Tối ưu Gas)
error UnauthorizedCaller(address caller);
error InsufficientSlippage(uint256 received, uint256 expected);

// 4. Contract Definition
/// @title SharedExecutorProxy
/// @notice Proxy trung tâm thực thi các bước Recipe tự động trên Arc Network
contract SharedExecutorProxy {
    using SafeERC20 for IERC20;

    // 5. Type Declarations (Structs, Enums)
    struct ExecutionStep {
        address targetProtocol;
        bytes callData;
    }

    // 6. State Variables (Hằng số -> Immutable -> Mutable)
    uint256 public constant MAX_SLIPPAGE_BPS = 10000;
    address public immutable arcUsdcAddress;
    bool public isPaused;

    // 7. Events
    event RecipeExecuted(bytes32 indexed recipeId, address indexed user, uint256 timestamp);

    // 8. Modifiers
    modifier whenNotPaused() {
        require(!isPaused, "Paused");
        _;
    }

    // 9. Constructor & Initializer
    constructor(address _arcUsdcAddress) {
        arcUsdcAddress = _arcUsdcAddress;
    }

    // 10. Fallback / Receive Functions
    receive() external payable {}

    // 11. External Functions
    // 12. Public Functions
    // 13. Internal Functions
    // 14. Private Functions
}
```

### 2.3. Quy tắc Viết Code Solidity
- **Sử dụng Custom Errors thay cho `require` string:** Giúp tiết kiệm phí gas nạp deployment và execution trên Arc.
  ```solidity
  // Good
  if (msg.sender != owner) revert UnauthorizedCaller(msg.sender);
  
  // Bad
  require(msg.sender == owner, "Unauthorized caller");
  ```
- **Sử dụng `SafeERC20` cho tất cả các giao dịch Token:** Tránh rủi ro với các token không trả về `bool` chuẩn ERC-20.
- **NatSpec Comments:** Mọi hàm `external`/`public` bắt buộc phải có tài liệu NatSpec (`@notice`, `@param`, `@return`).

---

## 3. Quy chuẩn TypeScript & React (Next.js 14/15 App Router)

### 3.1. Định dạng & Thụt lề
- Sử dụng **2 khoảng trắng (spaces)** cho mỗi mức thụt lề.
- Dấu chấm phẩy (Semicolons): **Bắt buộc (`semi: true`)**.
- Nháy đơn (Single quotes): Ưu tiên nháy đơn `'...'` trừ JSX attributes dùng nháy kép `"..."`.

### 3.2. Type Safety & TypeScript Strict Rules
- Bật `strict: true` trong `tsconfig.json`.
- Tuyệt đối không dùng `any`. Sử dụng `unknown` nếu chưa xác định kiểu dữ liệu và thực hiện type narrowing.
- Khai báo kiểu trả về (Return Type) cho tất cả các helper functions và API routes.

```typescript
// Good
export async function fetchUserRecipeStatus(
  userAddress: `0x${string}`
): Promise<RecipeStatusResponse> {
  const response = await fetch(`/api/recipes/${userAddress}`);
  if (!response.ok) {
    throw new Error('Failed to fetch recipe status');
  }
  return response.json();
}

// Bad
export const getStatus = async (address: any) => {
  const res = await fetch('/api/recipes/' + address);
  return res.json();
};
```

### 3.3. React Components & Hooks
- Ưu tiên **Functional Components** viết dưới dạng `export function ComponentName()`.
- Phân biệt rõ ràng giữa **Server Components** (mặc định) và **Client Components** (thêm directive `'use client'` ở đầu file).
- Không viết logic phức tạp trực tiếp inside JSX; bóc tách thành Custom Hooks (ví dụ: `useRecipeExecution`, `useArcBalance`).

---

## 4. Quy chuẩn CSS & Tailwind CSS

- Tuân thủ thứ tự sắp xếp class Tailwind: `Layout -> Sizing -> Typography -> Background/Border -> Effects/Interactions`.
- Tận dụng `cn()` utility (`clsx` + `tailwind-merge`) để gộp class động:
```tsx
import { cn } from '@/lib/utils';

export function YieldBadge({ className, isPositive }: YieldBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
        isPositive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
        className
      )}
    >
      {isPositive ? '+APY' : '-APY'}
    </span>
  );
}
```

---

## 5. Quy chuẩn Database & Prisma ORM

- Model đặt tên dạng `PascalCase`, cột/trường đặt tên dạng `camelCase`.
- Luôn map tên bảng và tên cột vật lý trong PostgreSQL sang `snake_case` thông qua `@map` và `@@map`.

```prisma
model RecipeExecution {
  id              String   @id @default(uuid())
  userAddress     String   @map("user_address")
  recipeType      String   @map("recipe_type")
  gasSpentUsdc    Decimal  @map("gas_spent_usdc") @db.Decimal(18, 6)
  transactionHash String   @map("transaction_hash")
  createdAt       DateTime @default(now()) @map("created_at")

  @@map("recipe_executions")
}
```
