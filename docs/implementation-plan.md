Đây là lỗi wallet bị locked — không phải bug trong code của project. Giải thích:

**Root cause:** `KeyringController - The operation cannot be completed while the controller is locked` là lỗi từ **MetaMask extension**, không phải từ App Kit hay project code.

Cụ thể:
- MetaMask có 2 trạng thái: **connected** (hiện địa chỉ) và **unlocked** (sẵn sàng ký). Wallet có thể hiển thị địa chỉ `0xFd710...` trong UI nhưng **keyring vẫn bị lock** sau một thời gian idle hoặc sau khi browser restart.
- Khi App Kit gọi `eth_sendTransaction` hoặc `eth_signTypedData`, MetaMask cần access private key qua KeyringController — nếu controller locked thì throw lỗi này.

**Cách fix cho người dùng:**

1. **Mở MetaMask** → nhập password để unlock
2. Sau khi unlock, thử lại swap

Nếu vẫn lỗi sau khi unlock:

3. **Disconnect và reconnect wallet** trong app — click vào ConnectButton → Disconnect → Connect lại
4. Kiểm tra MetaMask đang ở đúng network **Arc Testnet (5042002)**

---

**Tuy nhiên**, tôi sẽ kiểm tra xem SwapPanel có xử lý lỗi này rõ ràng hơn cho người dùng không — hiện tại có thể đang hiển thị raw error message thay vì hướng dẫn cụ thể: Thấy rõ vấn đề. Line 235: `error.message` được hiển thị thẳng ra UI — người dùng thấy raw error `KeyringController - The operation cannot be completed while the controller is locked`. Cần parse lỗi này thành message thân thiện. Fix luôn:Tôi đang ở Plan mode — không thể edit. Nhưng đây là fix rõ ràng để bạn tự implement hoặc switch sang Build mode:

---

**Nguyên nhân lỗi:** Không phải bug trong code DeFi Recipes — đây là MetaMask wallet bị lock.

**Fix ngay cho bạn:**
1. Mở MetaMask → nhập password unlock
2. Nếu vẫn lỗi: Disconnect wallet trong app → Connect lại
3. Kiểm tra đang ở đúng network **Arc Testnet (5042002)**

---

**Fix code cần implement** (switch sang Build mode):

Trong `SwapPanel.tsx`, function `onExecute` (line 232–236) hiện dump raw `error.message` thẳng ra UI. Cần thêm một function `friendlySwapError()` để parse các error pattern phổ biến:

| Raw error | Message hiển thị cho user |
|---|---|
| `KeyringController ... locked` | "Your wallet is locked. Please unlock MetaMask and try again." |
| `user rejected` / `user denied` | "Transaction cancelled." |
| `insufficient funds` | "Insufficient balance to complete this swap." |
| `slippage` / `min amount` | "Swap failed: price moved beyond slippage limit. Try increasing slippage." |
| `wrong network` / `unsupported chain` | "Wrong network. Please switch to Arc Testnet." |
| `internal error` | "Wallet returned an internal error. Please unlock your wallet, reconnect, and try again." |
| Fallback | Trim message xuống tối đa 120 chars |

Tương tự cần apply cho `BridgePanel`, `SendPanel` và `page.tsx` (activation flow) — tất cả đều hiện raw error message.
