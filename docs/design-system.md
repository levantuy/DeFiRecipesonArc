# Hệ thống Thiết kế (Design System) - DeFi Recipes on Arc

**Phiên bản:** 1.0  
**Định hướng thẩm mỹ:** Modern Premium Web3, Dark Mode Native, High-Contrast Glassmorphism, Micro-Animations.

---

## 1. Tổng quan & Triết lý Thiết kế

Giao diện của **DeFi Recipes on Arc** được thiết kế nhằm tạo ra sự tin tưởng tuyệt đối, tính chuyên nghiệp và hiện đại của một nền tảng tự động hóa tài chính cao cấp.
- **Dark Mode Native:** Tối ưu tương phản thị giác trong môi trường thiếu sáng, giảm mỏi mắt cho nhà đầu tư DeFi.
- **Glassmorphism & Depth:** Sử dụng các lớp kính mờ (`backdrop-blur`), đường viền mảnh phát sáng (`glowing borders`) tạo độ sâu cho giao diện.
- **Data Clarity:** Hiển thị chỉ số APY, số dư USDC, trạng thái Session Key và mã Hash cực kỳ rõ ràng, chính xác.

---

## 2. Bảng màu (Color Palette & Tokens)

Dự án sử dụng bảng màu HSL được tinh chỉnh cho Tailwind CSS:

```css
:root {
  /* Dark Background Tokens */
  --background: 224 71% 4%;        /* #030712 - Rich Deep Obsidian */
  --card: 224 71% 6%;              /* #060d1e - Elevating Card Base */
  --popover: 224 71% 6%;
  
  /* Brand Primary Tokens (Arc Electric Blue/Cyan) */
  --primary: 199 89% 48%;          /* #0ea5e9 - Arc Cyan Primary */
  --primary-foreground: 0 0% 100%;
  
  /* Accent Tokens (DeFi Yield & Status) */
  --yield-green: 142 71% 45%;     /* #10b981 - High APY / Profit */
  --yield-gold: 45 93% 47%;       /* #eab308 - Vault Rewards */
  --risk-red: 346 87% 53%;        /* #f43f5e - Slippage Alert / Warning */
  
  /* Neutral Muted Tokens */
  --muted: 215 27.9% 16.9%;
  --muted-foreground: 215 20.2% 65.1%;
  --border: 217.2 32.6% 17.5%;
}
```

### Bảng Phối màu UI (Palette Summary)

| Tên màu | Giá trị HSL / Hex | Mục đích sử dụng |
| :--- | :--- | :--- |
| **Deep Obsidian Background** | `#030712` | Nền chính của toàn bộ ứng dụng |
| **Glass Card Background** | `rgba(6, 13, 30, 0.7)` | Nền thẻ Recipe, Bảng thống kê, Modal |
| **Arc Electric Cyan** | `#0ea5e9` | Nút Kích hoạt (CTA), Active Tab, Brand Highlight |
| **Yield Emerald** | `#10b981` | Chỉ số APY dương, Trạng thái Successful Execution |
| **Warning Rose** | `#f43f5e` | Cảnh báo trượt giá (Slippage), Nút Revert / Cancel |
| **Gas Gold** | `#eab308` | Phí gas USDC, Biểu tượng Session Key |

---

## 3. Quy chuẩn Typography

Dự án sử dụng 3 họ font chữ chuẩn Google Fonts:

1. **Body & Primary UI:** `Inter` (Font không chân, nét thanh thoát, dễ đọc ở kích thước nhỏ).
2. **Headings & Cards Title:** `Outfit` hoặc `Plus Jakarta Sans` (Tạo cảm giác hiện đại, công nghệ cao).
3. **Numbers, Hashes & Wallet Addresses:** `JetBrains Mono` (Font đơn cách giúp số dư USDC và Transaction Hash xếp thẳng hàng hoàn hảo).

```css
/* Typography Scale Table */
.text-heading-xl { font-family: 'Outfit', sans-serif; font-size: 2.25rem; font-weight: 700; line-height: 2.5rem; }
.text-heading-lg { font-family: 'Outfit', sans-serif; font-size: 1.5rem; font-weight: 600; line-height: 2rem; }
.text-body       { font-family: 'Inter', sans-serif; font-size: 0.875rem; font-weight: 400; line-height: 1.25rem; }
.text-web3-mono  { font-family: 'JetBrains Mono', monospace; font-size: 0.875rem; font-weight: 500; }
```

---

## 4. Thành phần Giao diện & Kính mờ (Glassmorphism Components)

### Thẻ Recipe Card (Recipe Glass Card)
Thẻ hiển thị thông tin Recipe tự động化 phải có hiệu ứng kính mờ và viền phát sáng nhẹ khi hover.

```tsx
export function RecipeCard({ title, apy, status, children }: RecipeCardProps) {
  return (
    <div className="relative group overflow-hidden rounded-2xl bg-card/60 backdrop-blur-md border border-white/10 p-6 transition-all duration-300 hover:border-primary/50 hover:shadow-[0_0_25px_rgba(14,165,233,0.15)]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-white">{title}</h3>
        <span className="font-mono text-emerald-400 text-sm bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          {apy}% APY
        </span>
      </div>
      {children}
    </div>
  );
}
```

---

## 5. Quy chuẩn Chuyển động (Micro-Animations & Framer Motion)

Để giao diện sống động và phản hồi mượt mà, áp dụng các quy chuẩn chuyển động sau:

1. **Hover Scale Card:** `whileHover={{ scale: 1.02, y: -2 }}` với duration `0.2s`.
2. **Modal Backdrop Fade:** `initial={{ opacity: 0 }} animate={{ opacity: 1 }}` với `transition={{ duration: 0.15 }}`.
3. **Execution Pulse Indicator:** Biểu tượng Keeper đang thực thi chạy hiệu ứng nhấp nháy phát sáng nhẹ (`animate-pulse`).

```tsx
import { motion } from 'framer-motion';

export function AnimatedButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-3 px-4 rounded-xl shadow-lg shadow-primary/25"
      onClick={onClick}
    >
      {children}
    </motion.button>
  );
}
```
