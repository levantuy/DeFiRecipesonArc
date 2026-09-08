---
description: "Xây dựng tính năng chuyển đổi ngôn ngữ English/Tiếng Việt cho web (Next.js App Router) bằng React Context phía client kết hợp cookie lưu lựa chọn"
name: "i18n-en-vi"
argument-hint: "Mô tả phạm vi trang/component cần đa ngôn ngữ (để trống = áp dụng toàn bộ web/src)"
agent: "agent"
---

# Xây dựng tính năng đa ngôn ngữ (English / Tiếng Việt) cho website

## Mục tiêu

Thêm khả năng chuyển đổi giao diện giữa **English** (mặc định) và **Tiếng Việt** cho ứng dụng Next.js 14 (App Router) trong [web](../../web). Không dùng thư viện i18n định tuyến theo URL (next-intl, next-i18next); dùng **React Context phía client + cookie** để lưu lựa chọn của người dùng, không đổi cấu trúc routing hiện tại (không thêm segment `[locale]`).

## Phạm vi

- [web/src/app/layout.tsx](../../web/src/app/layout.tsx), [web/src/app/providers.tsx](../../web/src/app/providers.tsx), [web/src/app/page.tsx](../../web/src/app/page.tsx)
- [web/src/components/Navbar.tsx](../../web/src/components/Navbar.tsx), [web/src/components/RecipeCatalog.tsx](../../web/src/components/RecipeCatalog.tsx), [web/src/components/PortfolioTracker.tsx](../../web/src/components/PortfolioTracker.tsx), [web/src/components/SimulationModal.tsx](../../web/src/components/SimulationModal.tsx)
- Mọi component khác trong `web/src` có chuỗi text hiển thị cho người dùng.

## Kiến trúc đề xuất

1. **Từ điển dịch**: tạo `web/src/lib/i18n/dictionaries/en.ts` và `vi.ts`, export object phẳng hoặc lồng nhau theo namespace (`nav.*`, `recipeCatalog.*`, `portfolio.*`, `simulation.*`...). Định nghĩa type `Dictionary` dùng chung cho cả hai file để bắt lỗi thiếu key lúc biên dịch (`vi.ts satisfies Dictionary`).
2. **Context**: tạo `web/src/lib/i18n/LanguageProvider.tsx` chứa:
   - `type Lang = 'en' | 'vi'`
   - `LanguageContext` cung cấp `{ lang, setLang, t }`, trong đó `t(key: DictKey) => string` tra cứu theo `lang` hiện tại (fallback về `en` nếu thiếu key).
   - Đọc giá trị khởi tạo từ cookie `NEXT_LOCALE` được truyền xuống từ server (đọc bằng `cookies()` trong `layout.tsx`) để tránh flash sai ngôn ngữ và hydration mismatch.
   - Khi `setLang` được gọi: cập nhật state, ghi cookie `NEXT_LOCALE` (path=/, max-age=1 năm), và cập nhật `document.documentElement.lang`.
3. **Hook**: export `useLanguage()` từ cùng file để các component gọi `const { t, lang, setLang } = useLanguage()`.
4. **LanguageSwitcher**: thêm component nhỏ (toggle hoặc dropdown "EN / VI") vào [Navbar.tsx](../../web/src/components/Navbar.tsx), gọi `setLang`.
5. **Tích hợp Provider**: bọc `LanguageProvider` trong [providers.tsx](../../web/src/app/providers.tsx) (hoặc trực tiếp trong `layout.tsx`), truyền `initialLang` đọc từ cookie server-side.

## Yêu cầu chi tiết

- Thay toàn bộ chuỗi text hiển thị (label, tiêu đề, mô tả, thông báo trạng thái, placeholder, tooltip) trong các component ở mục Phạm vi bằng lời gọi `t('namespace.key')`, không hardcode chuỗi tiếng Anh/Việt trực tiếp trong JSX.
- Ngôn ngữ mặc định khi chưa có cookie: **English**.
- Định dạng số/ngày (`toLocaleString`, `Intl.NumberFormat`) trong [PortfolioTracker.tsx](../../web/src/components/PortfolioTracker.tsx) và [page.tsx](../../web/src/app/page.tsx) phải đổi theo `lang` hiện tại (`en-US` / `vi-VN`).
- Cập nhật `<html lang="...">` động theo ngôn ngữ đang chọn.
- Không được phá vỡ SSR: giá trị `lang` ban đầu ở server và client phải khớp nhau (đọc cookie ở server component, không đọc `localStorage` trong lần render đầu).
- Việc chuyển ngôn ngữ không được reload trang hay mất state hiện tại (ví dụ modal đang mở, form đang nhập).

## Ràng buộc

- Không thêm thư viện i18n mới (next-intl, react-i18next...); chỉ dùng React Context + `js-cookie` hoặc thao tác `document.cookie` thuần.
- Không đổi cấu trúc thư mục `app/` (không thêm `[locale]` segment, không đổi route hiện có).
- Giữ nguyên các quy ước code hiện tại của repo (TypeScript strict, Tailwind, cấu trúc component).

## Kiểm thử / tiêu chí hoàn thành

- `pnpm build` trong `web/` chạy thành công, không có lỗi TypeScript.
- Chuyển đổi EN ⇄ VI qua `LanguageSwitcher` cập nhật toàn bộ text trên trang hiện tại ngay lập tức, không reload.
- Tải lại trang (F5) sau khi chọn VI vẫn hiển thị tiếng Việt (nhờ cookie).
- Rà soát lại các component trong Phạm vi để đảm bảo không còn chuỗi hardcode nào bị bỏ sót.

## Output mong muốn

Liệt kê đầy đủ danh sách file đã tạo mới và đã chỉnh sửa, kèm tóm tắt ngắn gọn thay đổi trong mỗi file.
