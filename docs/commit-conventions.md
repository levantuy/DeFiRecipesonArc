# Quy tắc Commit & Quản lý Git (Commit Conventions) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Chuẩn áp dụng:** Conventional Commits v1.0.0

---

## 1. Cấu trúc Commit Message (Commit Message Format)

Mỗi commit message phải bao gồm một **Header** theo định dạng chuẩn bên dưới, theo sau là **Body** và **Footer** (nếu có):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

### 1.1. Định dạng ví dụ mẫu (Examples)
- `feat(contracts): add slippage enforcement guardrail to SharedExecutorProxy`
- `fix(frontend): correct USDC 6-decimal formatting in yield simulation modal`
- `docs(keeper): update redis job queue config documentation`
- `refactor(frontend): extract useArcBalance custom hook from WalletHeader`
- `test(contracts): add fuzz testing for SessionKeyRegistry delegation`

---

## 2. Danh mục Loại Commit (Commit Types)

| Type | Mục đích | Ví dụ |
| :--- | :--- | :--- |
| **`feat`** | Thêm một tính năng mới | `feat(keeper): implement exponential backoff retry worker` |
| **`fix`** | Sửa một lỗi kỹ thuật (bug fix) | `fix(contracts): fix reentrancy check on vault deposit` |
| **`docs`** | Thêm hoặc sửa đổi tài liệu | `docs: add quality standards and commit guidelines` |
| **`style`** | Thay đổi định dạng code (khoảng trắng, dấu chấm phẩy, không đổi logic) | `style(frontend): format code using prettier` |
| **`refactor`**| Tối ưu cấu trúc code (không thêm feature cũng không sửa bug) | `refactor(contracts): simplify guardrail protocol whitelist lookup` |
| **`perf`** | Cải thiện hiệu năng (Gas Optimization, UI Rendering speed) | `perf(contracts): pack struct variables to reduce storage slots` |
| **`test`** | Thêm test case mới hoặc sửa test case hiện có | `test(frontend): add unit test for simulation modal component` |
| **`chore`** | Cập nhật các tác vụ phụ trợ (build tasks, package update) | `chore(deps): upgrade viem and wagmi to latest v2` |
| **`ci`** | Thay đổi cấu hình CI/CD (GitHub Actions workflow) | `ci: add automated forge test runner on pull request` |

---

## 3. Danh mục Phạm vi (Commit Scopes)

Sử dụng các scope sau để xác định chính xác phân hệ code bị thay đổi:

- **`contracts`**: Các file trong thư mục `contracts/` hoặc test Foundry.
- **`frontend`**: Giao diện Web App Next.js (`src/app/`, `src/components/`, `src/hooks/`).
- **`keeper`**: Off-chain Worker Engine & BullMQ Scheduler.
- **`db`**: Prisma schema, migrations và PostgreSQL seeds.
- **`config`**: Các file cấu hình hệ thống (`foundry.toml`, `tailwind.config.ts`, `tsconfig.json`).
- **`deps`**: Quản lý gói phụ thuộc (`package.json`, `Cargo.toml`).

---

## 4. Quy tắc Viết Commit Nguyên tử (Atomic Commit Rules)

1. **Commit Nguyên tử (Atomic Commits):** Mỗi commit chỉ nên chứa **một thay đổi logic duy nhất**. Không gộp chung việc sửa bug FE với việc refactor hợp đồng Solidity trong cùng 1 commit.
2. **Câu Tóm tắt (Summary Line):**
   - Không quá **72 ký tự**.
   - Viết ở thì hiện tại mệnh lệnh (Imperative mood): *"add feature"* thay vì *"added feature"* hay *"adding feature"*.
   - Không có dấu chấm `.` ở cuối dòng summary.
3. **Tuyệt đối Không Commit Secret / Private Keys:**
   - Không bao giờ commit các file `.env`, `.env.local`, file chứa Private Key ví, Alchemy API Keys hay DB credentials.
   - Luôn kiểm tra `git status` và `.gitignore` trước khi commit.

---

## 5. Tự động hóa Kiểm tra Commit (Git Hooks & Commitlint)

Dự án tích hợp **Husky** và **Commitlint** để tự động chặn các commit không đúng quy định ngay tại máy local:

```json
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['contracts', 'frontend', 'keeper', 'db', 'config', 'deps', 'docs', 'ci']
    ],
  },
};
```
