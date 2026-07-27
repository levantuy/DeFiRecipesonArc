# Hướng dẫn Trải nghiệm UI/UX (UI/UX Guidelines) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Đối tượng:** Designer, Frontend Web3 Engineer, Product Manager.

---

## 1. Triết lý Trải nghiệm Người dùng DeFi (Web3 UX Principles)

Tự động hóa DeFi đòi hỏi tính minh bạch cao, loại bỏ sự mơ hồ và mang lại cảm giác an toàn tuyệt đối khi người dùng ủy quyền tài sản:
1. **Minh bạch Giao dịch (Transaction Clarity):** Luôn cho người dùng biết chuyện gì sẽ xảy ra *trước khi* họ nhấn nút ký giao dịch hoặc cấp Session Key.
2. **Loại bỏ Rào cản Gas (Zero-Gas Confusion):** Tận dụng tối đa ưu thế USDC Native Gas của mạng Arc để người dùng không bao giờ lo lắng về việc thiếu ETH làm gas.
3. **Phản hồi Thời gian thực (Real-time Feedback):** Mọi thao tác on-chain hay off-chain đều có chỉ báo trạng thái rõ ràng (Pending, Simulating, Success, Reverted).
4. **Quyền Kiểm soát Quyền hạn (User Sovereignty):** Nút **Hủy ủy quyền (Revoke Session Key)** và **Tạm dừng Recipe (Pause)** phải luôn hiển thị nổi bật và sẵn sàng ở mọi thời điểm.

---

## 2. Quy chuẩn UX Đặc thụ trên Arc Network

### 2.1. Hiển thị Phí Gas USDC (USDC Native Gas Display)
- **Hiển thị nhất quán:** Mọi nơi tính toán phí gas phải ghi rõ biểu tượng `USDC` (ví dụ: `Est. Gas: ~0.0042 USDC`). Tuyệt đối không hiển thị `Gwei` hay `ETH`.
- **Hiển thị Số dư USDC (ERC-20 View vs Gas View):**
  - Trên Wallet Bar / Header: Hiển thị số dư USDC khả dụng với **6 chữ số thập phân** (ví dụ: `1,250.50 USDC`).
  - Trong Transaction Confirmation: Cảnh báo nếu số dư USDC khả dụng nhỏ hơn phí gas ước tính.

### 2.2. Quy chuẩn Trạng thái Kết nối Ví (Wallet Connection Flow)
- Hỗ trợ 2 luồng kết nối song song:
  - **Ví Web3 truyền thống:** Rabby, MetaMask, Rainbow (thông qua RainbowKit).
  - **Ví Passkey (Circle Modular Account):** Cho phép đăng nhập bằng Biometrics (Fingerprint / FaceID).
- **Trạng thái trên Header:** Khi đã kết nối, hiển thị:
  - Địa chỉ ví dạng Rút gọn (`0x1a2b...9f8e` - font mono) kèm nút bấm 1-click Copy.
  - Badge chỉ báo mạng lưới: `Arc Testnet` (với dot màu lục đậm khi kết nối đúng Chain ID `5042002`).

---

## 3. Trình Giả lập Giao dịch (Simulation Preview Modal UX)

Trước khi người dùng xác nhận Kích hoạt Recipe (ví dụ: Auto-Compound hoặc Yield Rebalancer), hệ thống bắt buộc phải hiển thị **Simulation Modal** bao gồm các phần:

```
+-------------------------------------------------------------+
|  [Simulating Recipe Execution...]                [X] Close  |
+-------------------------------------------------------------+
|  ROUTING & ASSET FLOW                                       |
|  [1. Arc Lending] Withdraw 500 USDC                         |
|  [2. Arc DEX Router] Swap 500 USDC -> Vault Shares           |
|  [3. Deposit] Auto-stake to High Yield Vault                |
+-------------------------------------------------------------+
|  PARAMETERS & PROTECTION                                    |
|  - Max Slippage Tolerance: [ 0.5% ] (Editable Slider)       |
|  - Est. Yield Gain: +4.2% APY Net                           |
|  - Est. Keeper Gas Fee: ~0.008 USDC                         |
+-------------------------------------------------------------+
|  [ Confirm & Delegate Execution (Sign EIP-712) ]            |
+-------------------------------------------------------------+
```

### Các Quy tắc UX trong Simulation Modal:
- Nếu Giả lập (`eth_call`) thất bại: Khóa nút "Confirm", hiển thị hộp cảnh báo màu đỏ (`risk-red`) kèm nguyên nhân cụ thể (ví dụ: `Slippage exceeded` hoặc `Liquidity pool low`).
- Nút điều chỉnh Slippage: Cho phép chọn nhanh 0.1%, 0.5% (mặc định), 1.0% hoặc nhập tùy chỉnh.

---

## 4. Quản lý Quyền Session Key (Session Key Delegation UX)

Khi ủy quyền cho Keeper Engine chạy tự động, giao diện phải trình bày các **Hạn chế Bảo vệ (Guardrails)** một cách trực quan:

1. **Phạm vi Quyền hạn (Scope):** Liệt kê các Smart Contract mà Keeper được phép gọi (ví dụ: *Chỉ tương tác với Arc Lending & DEX Router*).
2. **Thời gian Hiệu lực (Expiry Timer):** Hiển thị thời gian hết hạn của Session Key (ví dụ: *Hết hạn sau 7 ngày*).
3. **Giới hạn Giá trị Giao dịch (Max Value per Execution):** Cấu hình hạn mức USDC tối đa cho mỗi lần Keeper tự động thao tác.
4. **Trạng thái Cảnh báo:** Khi Session Key sắp hết hạn (dưới 24h), hiển thị thông báo nhắc nhở 1-Click Renew trên Dashboard.

---

## 5. Phản hồi Trạng thái & Thông báo (Feedback & Toast Notifications)

### 5.1. Quy chuẩn Toast Notification
Sử dụng Toast Notification xuất hiện ở góc dưới bên phải với 4 trạng thái:

- **Pending (Đang xử lý):** Spinner quay nhẹ, hiển thị text *"Broadcasting transaction to Arc Network..."*.
- **Success (Thành công):** Biểu tượng Checkmark xanh lục, hiển thị text *"Recipe step executed successfully"*, kèm link clickable `[View on ArcScan]` mở tab mới.
- **Error / Revert (Lỗi):** Biểu tượng Danger đỏ, dịch các mã lỗi EVM thô thành ngôn ngữ dễ hiểu đối với người dùng cuối.
- **Warning (Cảnh báo):** Hiển thị khi trượt giá cao hoặc mạng Arc đang biến động gas.

### 5.2. Link Trích xuất Trình duyệt Blockchain (ArcScan Links)
Tất cả các Transaction Hash (`txHash`), Contract Address và Wallet Address hiển thị trên UI đều **bắt buộc** phải là hyperlink trỏ trực tiếp đến `https://testnet.arcscan.app/tx/{txHash}`.
