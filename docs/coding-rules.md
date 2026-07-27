# Quy tắc Lập trình & Bảo mật (Strict Coding Rules) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Áp dụng bắt buộc đối với:** Toàn bộ Developers, Smart Contract Engineers & Backend Maintenance.

---

## 1. Quy tắc Bảo mật Hợp đồng Thông minh (Smart Contract Security Rules)

### 1.1. Chống tấn công Reentrancy (Reentrancy Guard)
- Tất cả các hàm `external`/`public` thực thi giao dịch hoặc chuyển tài sản **bắt buộc** phải sử dụng `nonReentrant` modifier từ `OpenZeppelin ReentrancyGuard`.
- Áp dụng triệt để mô hình **Checks-Effects-Interactions Pattern**:
  1. **Checks:** Xác thực quyền hạn, kiểm tra số dư, kiểm tra trạng thái Pause.
  2. **Effects:** Cập nhật trạng thái hợp đồng (State variables, Mapping) *trước*.
  3. **Interactions:** Thực hiện chuyển token hoặc gọi external contract *sau cùng*.

### 1.2. Kiểm soát Scope Thực thi (Strict Function Selector & Target Scoping)
- `SharedExecutorProxy` tuyệt đối không cho phép gọi hàm tùy ý (`arbitrary call`).
- Bắt buộc kiểm tra danh sách trắng qua `RecipeGuardrail`:
  - `targetProtocol` phải nằm trong danh sách Protocol đã kiểm toán.
  - `bytes4(callData)` phải nằm trong danh sách Selector được phê duyệt (ví dụ: `deposit(uint256)`, `withdraw(uint256)`).

### 1.3. Bắt buộc Kiểm soát Trượt giá (Slippage & Output Validation)
- Mọi hàm thực thi swap token hoặc nạp/rút vault phải đo số dư tài sản nhận được thực tế:
  ```solidity
  uint256 balanceBefore = IERC20(outputToken).balanceOf(address(this));
  
  // External protocol call
  (bool success, ) = targetProtocol.call(callData);
  if (!success) revert ExecutionFailed();

  uint256 balanceAfter = IERC20(outputToken).balanceOf(address(this));
  uint256 receivedAmount = balanceAfter - balanceBefore;
  
  if (receivedAmount < minOutputExpected) {
      revert InsufficientSlippage(receivedAmount, minOutputExpected);
  }
  ```

---

## 2. Quy tắc Tuyệt đối trên Arc Network (Arc Gas & Asset Rules)

> [!CAUTION]
> Vi phạm các quy tắc dưới đây sẽ dẫn đến tính toán sai phí gas hoặc đếm trùng tài sản trên giao diện người dùng.

1. **Tuyệt đối Không Thực hiện Swap giữa USDC Native & USDC ERC-20:**
   - Trên Arc Network, USDC Native Gas và USDC ERC-20 (`0x3600000000000000000000000000000000000000`) là **cùng một tài sản** được ánh xạ dưới hai chế độ (Native View vs ERC-20 View).
2. **Quy tắc Phân tách Decimals (6 vs 18 Decimals):**
   - Sử dụng **6 decimals** cho tất cả các phép tính số dư ví, nạp/rút vault, phê duyệt `approve()` và hiển thị UI.
   - Chỉ sử dụng **18 decimals** khi tính toán phí gas hoặc truyền giá trị `msg.value` cho giao dịch native execution.
3. **Không Cộng dồn hai chế độ View:** Tuyệt đối không bao giờ lấy số dư Native View + số dư ERC-20 View để tránh tình trạng đếm đúp (Double Counting).

---

## 3. Quy tắc Backend Keeper & Automation Engine

### 3.1. Giả lập Tĩnh Bắt buộc (Static Simulation via Viem)
Trình Keeper **bắt buộc** phải chạy thử nghiệm giao dịch tĩnh bằng `eth_call` (Viem simulation) trước khi phát hành (broadcast) giao dịch lên mạng Arc:

```typescript
// Bắt buộc Simulating trước khi Send Transaction
try {
  const { request } = await publicClient.simulateContract({
    address: SHARED_EXECUTOR_ADDRESS,
    abi: SharedExecutorAbi,
    functionName: 'executeRecipeStep',
    args: [protocolAddress, callData, minOutput],
    account: keeperAccount,
  });
  
  // Chỉ gửi giao dịch khi simulation thành công
  const hash = await walletClient.writeContract(request);
  return hash;
} catch (error) {
  logger.error({ error, recipeId }, 'Static simulation failed. Skipping execution to save USDC gas.');
  // Mark job as failed/retried without spending gas
}
```

### 3.2. Tính Độc lập & Khả năng Thử lại (Idempotency & Exponential Backoff)
- Mọi tác vụ tự động (Job) trên BullMQ phải đảm bảo tính **Idempotent** (chạy lại nhiều lần với cùng đầu vào không gây sai lệch dữ liệu hay thực thi lặp).
- Khi mạng Arc bị tắc nghẽn hoặc RPC bị ngắt kết nối, Keeper áp dụng chiến thuật **Exponential Backoff Retry** (thử lại sau 2s, 4s, 8s, 16s với jitter).

---

## 4. Quy tắc Frontend Web3 & Bảo mật Client

1. **Tuyệt đối Không Lưu trữ Private Keys / Seed Phrase:** Không bao giờ lưu trữ private key hoặc Session Key private key dưới dạng văn bản thuần trong `localStorage`, `sessionStorage` hoặc mã nguồn Frontend.
2. **Xác thực Chain ID Bắt buộc:** Trước khi gửi bất kỳ lệnh ký EIP-712 nào, kiểm tra `chainId === 5042002` (Arc Testnet). Nếu sai chain, lập tức gọi `switchChain()`.
3. **Xử lý Từ chối từ Ví (User Rejection Handling):** Khi người dùng từ chối ký giao dịch trên ví, bắt lỗi nhẹ nhàng (Catch error code `4001`) và hiển thị thông báo "Transaction cancelled" thay vì throw Uncaught Exception.
