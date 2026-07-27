# Các Tiêu chuẩn Chất lượng (Quality Standards) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Mục tiêu:** Đảm bảo tính an toàn tuyệt đối cho hợp đồng thông minh, trải nghiệm người dùng mượt mà và khả năng vận hành tự động ổn định 24/7.

---

## 1. Tiêu chuẩn Chất lượng Smart Contracts (On-Chain Standards)

Smart Contracts là cốt lõi lưu trữ và điều phối tài sản trên Arc Network, đòi hỏi tiêu chuẩn chất lượng nghiêm ngặt nhất.

### 1.1. Mục tiêu Độ bao phủ Kiểm thử (Test Coverage Targets)
- **Hợp đồng Cốt lõi (`SharedExecutorProxy`, `RecipeGuardrail`, `SessionKeyRegistry`):** Mục tiêu bao phủ dòng code (Line Coverage) **> 95%** và bao phủ nhánh (Branch Coverage) **> 90%**.
- **Foundry Fuzz Testing:** Mọi hàm thực thi giao dịch có tham số tính toán số lượng/trượt giá phải chạy Fuzzing tối thiểu **10,000 runs**:
  ```bash
  forge test --fuzz-runs 10000
  ```
- **Invariant Testing:** Xây dựng Invariant Tests kiểm tra các thuộc tính an toàn vĩnh cửu (ví dụ: *Tổng số dư USDC rút ra không bao giờ vượt quá số dư nạp vào + lợi suất thực tế*).

### 1.2. Phân tích Tĩnh & Kiểm toán An ninh (Static Analysis & Security Audit)
- **Slither:** Tuyệt đối không còn lỗi ở mức `High` hoặc `Medium` khi chạy Slither static analyzer:
  ```bash
  slither . --detect reentrancy-eth,arbitrary-send-eth,uninitialized-state
  ```
- **Aderyn:** Chạy Aderyn Rust-based static analyzer cho Foundry project trước mỗi bản release.
- **Gas Benchmark Limits:** Theo dõi và duy trì chi phí gas cho hàm `executeStep` dưới **120,000 gas units** trên Arc Network.

---

## 2. Tiêu chuẩn Chất lượng Frontend Web3 (Client-Side Standards)

### 2.1. Mã nguồn & Type-Safety
- **Zero TypeScript Errors:** Chạy `tsc --noEmit` đạt 0 lỗi.
- **Zero ESLint Warnings:** Chạy `npm run lint` đạt 0 warnings/errors.
- **Strict Hydration Safety:** Tránh các lỗi Hydration mismatch giữa Server Components và Client Components khi hiển thị số dư ví Web3.

### 2.2. Hiệu năng & Khả năng Truy cập (Performance & Accessibility)
- **Lighthouse Performance Score:** Đạt điểm số **> 90** trên Desktop cho trang Dashboard.
- **Chuẩn Truy cập WCAG 2.1 AA:** Đảm bảo tỷ lệ tương phản màu sắc chữ (Contrast Ratio >= 4.5:1), hỗ trợ điều hướng bằng bàn phím (Keyboard navigation) cho các Modal và Form.
- **Thời gian phản hồi UI:** Thời gian hiển thị kết quả Giả lập (Simulation Modal) phải **< 1.5 giây** từ khi mở modal.

---

## 3. Tiêu chuẩn Chất lượng Keeper Engine & Automation (Backend Standards)

### 3.1. Độ Tin cậy & Khả năng Chịu lỗi (Resilience & Reliability)
- **Tỷ lệ Hoạt động Liên tục (Uptime SLA):** Worker Node đạt **99.9% Uptime** (theo dõi qua Healthcheck Endpoint `/healthz`).
- **Không Swallowing Error:** Tuyệt đối không dùng `catch (e) {}` rỗng. Tất cả ngoại lệ bất thường phải được đẩy lên hệ thống logging (Pino/Winston) kèm stack trace.
- **Giám sát Queue (BullMQ Monitoring):** Tỷ lệ Job bị thất bại vĩnh viễn (`Failed Jobs`) phải dưới **0.1%**. Các job thất bại do nghẽn mạng RPC phải tự động recovery thành công qua Exponential Backoff.

### 3.2. Tiêu chuẩn Cơ sở Dữ liệu (Prisma / PostgreSQL)
- **Index Coverage:** Đảm bảo tất cả các truy vấn tìm kiếm theo `user_address`, `recipe_id` và `transaction_hash` đều có Index hỗ trợ.
- **Connection Pooling:** Cấu hình PgBouncer hoặc Prisma Pool Manager tối đa 20 active connections để tránh làm cạn kiệt tài nguyên Postgres.

---

## 4. Tự động hóa Pipeline Chất lượng CI/CD (Quality Automation)

Toàn bộ các tiêu chuẩn trên được tự động hóa thực thi trên GitHub Actions thông qua Workflow `.github/workflows/ci.yml`:

```yaml
name: Continuous Integration & Quality Checks

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  smart-contracts-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
      - name: Run Forge Build & Tests
        run: |
          forge build
          forge test --summary
      - name: Run Slither Static Analysis
        uses: crytic/slither-action@v0.3.0

  frontend-keeper-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - name: Install Dependencies
        run: npm ci
      - name: TypeScript Check
        run: npx tsc --noEmit
      - name: ESLint Check
        run: npm run lint
      - name: Prettier Code Formatting Check
        run: npx prettier --check .
```
