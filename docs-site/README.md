# DeFi Recipes on Arc — Documentation Site

Ứng dụng [Fumadocs](https://fumadocs.dev) + Next.js độc lập, tách biệt hoàn toàn khỏi `web/` và
`keeper/` trong monorepo này — có `package.json` riêng và build output riêng, có thể triển khai
độc lập lên `docs.defirecipes.com`.

Trang tài liệu hỗ trợ đầy đủ **hai ngôn ngữ**: tiếng Anh (`en`) và tiếng Việt (`vi`).

## Kiến trúc i18n

- Locale mặc định là `en`. URL luôn có tiền tố locale rõ ràng: `/en/docs/...` hoặc `/vi/docs/...`.
- `proxy.ts` (dùng `createI18nMiddleware` của `fumadocs-core/i18n/middleware`) tự động thêm tiền
  tố locale còn thiếu. Một URL cũ không có locale (ví dụ `/docs/contracts-overview`, hoặc `/`) sẽ
  được chuyển hướng sang locale phù hợp nhất theo header `Accept-Language`, và về `en` nếu trình
  duyệt không khai báo ưu tiên ngôn ngữ nào khớp.
- `app/[lang]/page.tsx` chuyển hướng `/{lang}` sang trang tổng quan mặc định
  `/{lang}/docs/contracts-overview`.
- Cấu hình locale dùng chung (danh sách ngôn ngữ, locale mặc định, tên hiển thị) nằm ở một nơi
  duy nhất: [lib/i18n.ts](lib/i18n.ts), được `proxy.ts`, `lib/source.ts` và `RootProvider` cùng
  sử dụng — không có nhánh rẽ theo ngôn ngữ nào bị lặp lại rải rác trong code.

## Cấu trúc nội dung theo locale

```
content/docs/
  en/
    meta.json
    contracts-overview.mdx
    project-vision.mdx
    architecture-proposal.mdx
  vi/
    meta.json
    contracts-overview.mdx
    project-vision.mdx
    architecture-proposal.mdx
```

Mỗi locale có cây điều hướng (`meta.json`) và nội dung MDX hoàn toàn riêng biệt — điều hướng của
tiếng Anh không bao giờ lẫn với tiếng Việt hoặc ngược lại. `lib/source.ts` nạp cả hai bằng
`loader()` của `fumadocs-core/source` với `i18n` (`parser: 'dir'`), nên `source.pageTree[lang]`
và `source.getPage(slug, lang)` luôn trả về đúng dữ liệu của locale được yêu cầu.

## Thêm một trang mới bằng cả hai ngôn ngữ

1. Tạo `content/docs/en/<slug>.mdx` với frontmatter `title`/`description` bằng tiếng Anh.
2. Tạo `content/docs/vi/<slug>.mdx` với **cùng `<slug>`** và frontmatter bằng tiếng Việt.
3. Thêm `<slug>` vào `pages` của cả `content/docs/en/meta.json` và `content/docs/vi/meta.json`
   (thứ tự có thể khác nhau giữa hai locale nếu cần, nhưng slug phải giống hệt nhau).
4. Khi liên kết chéo giữa các trang tài liệu, dùng đường dẫn file tương đối, ví dụ
   `[...](./project-vision.mdx)`, thay vì đường dẫn tuyệt đối `/docs/...` — Fumadocs sẽ tự resolve
   sang đúng URL có tiền tố locale hiện tại.

**Quy ước slug:** slug của một trang phải giống hệt nhau ở `en` và `vi` (ví dụ
`contracts-overview` ở cả hai thư mục). Đây là điều kiện để bộ chuyển ngôn ngữ giữ nguyên trang
đang xem khi đổi locale; nếu một locale chưa có trang tương ứng, bộ chuyển ngôn ngữ sẽ tự động
đưa người dùng về trang tổng quan (`contracts-overview`) của locale đó thay vì báo lỗi 404.

Không dịch sai các thuật ngữ kỹ thuật (Arc, USDC, smart contract, session key, keeper, whitelist,
slippage, Chain ID...); giữ nguyên code block, địa chỉ contract và các giá trị kỹ thuật giữa hai
bản dịch.

## Local development và kiểm tra language switcher

```bash
pnpm install
pnpm dev
```

Trang chạy tại `http://localhost:3000` và chuyển hướng sang `/en/docs/contracts-overview`.

Để kiểm tra bộ chuyển ngôn ngữ:

1. Mở `/en/docs/project-vision`, bấm nút chọn ngôn ngữ ở thanh điều hướng (hiển thị trên cả
   desktop và mobile) và chọn "Vietnamese" — trang phải chuyển sang `/vi/docs/project-vision`
   (giữ nguyên slug).
2. Ở `/vi/docs/project-vision`, chuyển lại sang "English" phải quay về
   `/en/docs/project-vision`.
3. Vào một slug chỉ tồn tại ở một locale (nếu có) và đổi sang locale còn lại — phải rơi về trang
   tổng quan (`contracts-overview`) của locale đó thay vì lỗi 404.
4. Kiểm tra `<html lang="...">` trong DevTools khớp với locale đang xem.
5. Truy cập `/docs/contracts-overview` (không có tiền tố locale) — phải được chuyển hướng sang
   locale phù hợp.

## Những gì trang này dùng

- **Fumadocs UI** (`fumadocs-ui`) cho layout tài liệu, sidebar responsive, mục lục (TOC) với
  active-section highlighting, ô tìm kiếm tích hợp, và bộ chuyển ngôn ngữ tích hợp sẵn
  (`RootProvider` với `i18n`).
- **Fumadocs MDX** (`fumadocs-mdx`) để nạp Markdown/MDX từ [content/docs](content/docs) và cấu
  hình Shiki syntax highlighting cho `solidity`, `dotenv` và một số ngôn ngữ khác (xem
  [source.config.ts](source.config.ts)).
- **Fumadocs Core** (`fumadocs-core`) cho bộ nạp page-tree đa locale (`fumadocs-core/source`),
  middleware định tuyến locale (`fumadocs-core/i18n/middleware`), và API tìm kiếm.
- Tailwind CSS v4 (CSS-first config) để style, chồng lên stylesheet của Fumadocs.

Không có sidebar, search hay locale-switcher tự viết tay — tất cả đều dùng khả năng có sẵn của
Fumadocs, không thêm dependency mới.

## Build & deploy

```bash
pnpm build
pnpm start
```

> With `output: 'standalone'`, `next start` prints a warning and Node should instead run
> `node .next/standalone/server.js` for production deployments — `pnpm build && pnpm start`
> remains fine for local verification.

`next.config.mjs` sets `output: 'standalone'` for self-hosted Node/Docker deployments, which
produces a self-contained `.next/standalone` bundle. This is skipped automatically when the
`VERCEL` environment variable is present, since Vercel performs its own output tracing and
fails the build (`ENOENT ... next-server.js.nft.json`) if `output: 'standalone'` is left on.
Either way, this app builds and deploys independently of the other apps in this repository —
point Vercel (or any other host) at `docs-site/` as the project root for `docs.defirecipes.com`.
