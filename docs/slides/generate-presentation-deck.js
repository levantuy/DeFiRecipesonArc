const fs = require('node:fs');
const path = require('node:path');
const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'Lê Văn Tùy';
pptx.subject = 'Bài thuyết trình 18 phút và demo DCA trên Arc Testnet';
pptx.title = 'DeFi Recipes on Arc — Tự động hóa DeFi, giữ quyền kiểm soát';
pptx.company = 'DeFi Recipes on Arc';
pptx.lang = 'vi-VN';
pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'vi-VN' };

const output = path.join(__dirname, 'DeFi-Recipes-on-Arc-Le-Van-Tuy-vi.pptx');
const script = fs.readFileSync(path.join(__dirname, 'kich-ban-thuyet-trinh-15-20-phut.md'), 'utf8');
const sections = [...script.matchAll(/^### Slide (\d+)\. (.+)\r?\n([\s\S]*?)(?=^### Slide \d+\.|^## 4\.)/gm)];
if (sections.length !== 12) throw new Error(`Cần đúng 12 phần kịch bản, tìm thấy ${sections.length}.`);

const C = {
  navy: '0B1930', ink: '142B45', muted: '52657A', teal: '087F78',
  mint: '76E7C7', pale: 'E7F6F1', paper: 'F5F8FC', white: 'FFFFFF',
  line: 'D8E2ED', amber: '915513', cream: 'FFF3DF', light: 'C3D2E3'
};
const timings = [
  '00:00–01:00', '01:00–02:30', '02:30–03:45', '03:45–05:00',
  '05:00–06:30', '06:30–08:00', '08:00–10:00', '10:00–11:00',
  '11:00–15:00', '15:00–16:00', '16:00–17:00', '17:00–18:00'
];

function text(slide, value, x, y, w, h, options = {}) {
  slide.addText(value, {
    x, y, w, h, fontFace: 'Arial', fontSize: 18, color: C.ink,
    margin: 0, valign: 'mid', breakLine: false, ...options
  });
}

function box(slide, x, y, w, h, fill = C.white, border = fill) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h, radius: 0.15, rectRadius: 0.15,
    fill: { color: fill }, line: { color: border, width: 1 }
  });
}

function tag(slide, label, x, y, w, dark = false) {
  box(slide, x, y, w, 0.35, dark ? '193951' : C.pale);
  text(slide, label, x + 0.1, y + 0.04, w - 0.2, 0.25, {
    fontSize: 10, bold: true, color: dark ? C.mint : C.teal, align: 'center'
  });
}

function callout(slide, value, y = 6.07, warning = false) {
  box(slide, 0.65, y, 12.03, 0.62, warning ? C.cream : C.pale);
  text(slide, value, 0.85, y + 0.09, 11.63, 0.44, {
    fontSize: 14, bold: true, color: warning ? C.amber : C.teal
  });
}

function base(number, category, heading, subtitle, dark = false) {
  const slide = pptx.addSlide();
  slide.background = { color: dark ? C.navy : C.paper };
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333333, h: 0.07,
    fill: { color: C.mint }, line: { color: C.mint }
  });
  if (heading) {
    text(slide, category.toUpperCase(), 0.65, 0.42, 11.8, 0.26, {
      fontSize: 11, bold: true, charSpacing: 1.4, color: C.teal
    });
    text(slide, heading, 0.65, 0.92, 12.03, 0.62, { fontSize: 29, bold: true });
    text(slide, subtitle, 0.65, 1.65, 12.03, 0.52, { fontSize: 16, color: C.muted });
  }
  text(slide, 'DEFI RECIPES ON ARC  /  ARC TESTNET', 0.65, 7.08, 6.1, 0.2, {
    fontSize: 9, color: dark ? C.light : C.muted
  });
  text(slide, `${timings[number - 1]}   |   ${String(number).padStart(2, '0')} / 12`,
    9.0, 7.06, 3.68, 0.24, { fontSize: 10, color: dark ? C.light : C.muted, align: 'right' });
  slide.addNotes([
    `Người thuyết trình: Lê Văn Tùy | 0919249247 | levantuyit@gmail.com`,
    `Khung diễn tập: ${timings[number - 1]}.`,
    sections[number - 1][0],
    ...(number === 9 ? [script.split('## 5. Chuẩn bị demo và phương án dự phòng')[1].split('## 6.')[0]] : []),
    ...(number === 12 ? [script.split('## 6. Câu hỏi thường gặp')[1].split('## 7.')[0]] : [])
  ]);
  return slide;
}

function card(slide, x, y, w, h, number, heading, body) {
  box(slide, x, y, w, h, C.white, C.line);
  text(slide, number, x + 0.25, y + 0.23, w - 0.5, 0.4, {
    fontSize: 23, bold: true, color: C.teal
  });
  text(slide, heading, x + 0.25, y + 0.86, w - 0.5, 0.7, {
    fontSize: heading.length > 14 ? 20 : 22, bold: true
  });
  text(slide, body, x + 0.25, y + 1.75, w - 0.5, h - 1.97, {
    fontSize: 17, color: C.muted, valign: 'top'
  });
}

function row(slide, label, body, y, x = 0.9, w = 11.5) {
  text(slide, label, x, y, w, 0.38, { fontSize: 20, bold: true });
  text(slide, body, x, y + 0.49, w, 0.9, { fontSize: 17, color: C.muted, valign: 'top' });
}

function contact(slide, x, y, w, dark = false) {
  text(slide, 'Lê Văn Tùy', x, y, w, 0.5, {
    fontSize: 27, bold: true, color: dark ? C.white : C.ink
  });
  text(slide, 'Điện thoại: 0919249247', x, y + 0.7, w, 0.32, {
    fontSize: 17, color: dark ? C.light : C.muted
  });
  text(slide, 'Email: levantuyit@gmail.com', x, y + 1.18, w, 0.34, {
    fontSize: 17, color: dark ? C.mint : C.teal
  });
}

// 01 — Mở đầu.
{
  const s = base(1, '', '', '', true);
  tag(s, 'DỰ ÁN CỘNG ĐỒNG • ARC TESTNET', 0.72, 0.67, 3.5, true);
  text(s, 'DeFi Recipes\non Arc', 0.72, 1.55, 7.0, 1.75, {
    fontSize: 51, bold: true, color: C.white
  });
  text(s, 'Tự động hóa DeFi,\ngiữ quyền kiểm soát.', 0.76, 3.65, 6.7, 1.05, {
    fontSize: 29, color: C.mint
  });
  text(s, 'Giảm thao tác  /  Giới hạn quyền  /  Đối chiếu kết quả',
    0.76, 5.45, 6.7, 0.65, { fontSize: 17, color: C.light });
  box(s, 8.1, 1.55, 4.5, 4.75, '142C45');
  box(s, 8.5, 1.94, 0.88, 0.88, C.mint);
  text(s, 'DR', 8.5, 2.13, 0.88, 0.5, {
    fontSize: 23, bold: true, color: C.navy, align: 'center'
  });
  text(s, 'NGƯỜI THUYẾT TRÌNH', 8.5, 3.15, 3.7, 0.3, {
    fontSize: 11, bold: true, color: C.light, charSpacing: 1
  });
  contact(s, 8.5, 3.78, 3.7, true);
  text(s, 'Dự án độc lập; không phải sản phẩm chính thức của Arc hoặc Circle.',
    0.76, 6.45, 11.85, 0.3, { fontSize: 12, color: C.light });
}

// 02 — Bài toán.
{
  const s = base(2, 'Bài toán', 'Chiến lược đơn giản. Thao tác vẫn lặp lại.',
    'Ví dụ: định kỳ đổi một phần USDC sang EURC.');
  card(s, 0.65, 2.55, 3.85, 3.12, '01', 'Nhớ đúng lịch', 'Bận hoặc quên khiến kế hoạch bị gián đoạn.');
  card(s, 4.74, 2.55, 3.85, 3.12, '02', 'Làm lại nhiều bước', 'Kiểm tra số dư, báo giá, trượt giá và xác nhận ví.');
  card(s, 8.83, 2.55, 3.85, 3.12, '03', 'Kiểm soát bot', 'Bot được dùng bao nhiêu? Gọi đâu? Dừng bằng cách nào?');
  callout(s, 'Không chỉ tự động hóa thao tác — cần làm rõ giới hạn và lịch sử thực thi.');
}

// 03 — Nền tảng.
{
  const s = base(3, 'Nền tảng', 'Vì sao chọn Arc?',
    'Một nền tảng phù hợp cho các quy trình lấy USDC làm trung tâm.');
  const items = [
    ['USDC làm gas', 'Không cần thêm một native token khác để trả phí trên Arc.'],
    ['Chi phí dễ lập kế hoạch', 'Ngân sách chiến lược và chi phí thực thi cùng nhìn bằng USDC.'],
    ['Finality nhanh', 'Đặc tính mạng dưới một giây; không phải cam kết độ trễ toàn ứng dụng.'],
    ['Tương thích EVM', 'Solidity • Foundry • Viem / Wagmi • Next.js']
  ];
  items.forEach(([head, body], i) => {
    const x = 0.65 + (i % 2) * 6.14;
    const y = 2.45 + Math.floor(i / 2) * 1.63;
    box(s, x, y, 5.89, 1.42, C.white, C.line);
    text(s, head, x + 0.25, y + 0.18, 5.39, 0.36, { fontSize: 22, bold: true, color: C.teal });
    text(s, body, x + 0.25, y + 0.67, 5.39, 0.57, { fontSize: 16, color: C.muted });
  });
  callout(s, 'USDC gas và USDC ERC-20 là cùng một tài sản. Không cộng hai số dư.', 6.07);
}

// 04 — Khái niệm.
{
  const s = base(4, 'Phạm vi MVP', 'Recipe biến ý định thành một quy trình',
    'Người dùng cấu hình quy trình có sẵn, thay vì tự ghép từng lời gọi hợp đồng.');
  const labels = ['Hành động', 'Lịch chạy', 'Ngân sách', 'Giới hạn', 'Theo dõi'];
  labels.forEach((label, i) => {
    const x = 0.65 + i * 2.46;
    box(s, x, 2.5, 2.18, 0.85, C.pale);
    text(s, label, x + 0.1, 2.75, 1.98, 0.31, { fontSize: 18, bold: true, color: C.teal, align: 'center' });
    if (i < 4) text(s, '→', x + 2.2, 2.76, 0.25, 0.28, { fontSize: 15, color: C.teal });
  });
  box(s, 0.65, 3.86, 5.89, 1.68, C.white, C.line);
  box(s, 6.79, 3.86, 5.89, 1.68, C.white, C.line);
  row(s, '01  USDC → EURC DCA', 'Đổi định kỳ theo ngân sách.\nLuồng demo chính của bài nói.', 4.06, 0.95, 5.29);
  row(s, '02  USDC Yield Auto-Compounder', 'Hướng tự động hóa phần thưởng.\nCần xác minh chuỗi compound đầy đủ.', 4.06, 7.09, 5.29);
  callout(s, 'MVP ưu tiên thực thi, quyền hạn và vận hành — chưa đặt marketplace mở làm trọng tâm.');
}

// 05 — Cấu hình DCA.
{
  const s = base(5, 'Recipe 01', 'DCA USDC → EURC theo ngân sách',
    'Cấu hình minh họa; không phải khuyến nghị đầu tư hay bảo đảm lợi nhuận.');
  [['50', 'USDC tổng ngân sách'], ['5', 'USDC mỗi lượt'], ['24 giờ', 'Chu kỳ'], ['≤ 10', 'Lượt theo ngân sách']].forEach(([value, label], i) => {
    const x = 0.65 + i * 3.07;
    box(s, x, 2.52, 2.82, 1.48, i === 0 ? C.navy : C.white);
    text(s, value, x + 0.15, 2.78, 2.52, 0.56, {
      fontSize: 34, bold: true, color: i === 0 ? C.mint : C.teal, align: 'center'
    });
    text(s, label, x + 0.15, 3.51, 2.52, 0.26, {
      fontSize: 13, color: i === 0 ? C.light : C.muted, align: 'center'
    });
  });
  row(s, 'Lấy tiền từ ví theo từng lượt', 'Cấu hình ngân sách không đồng nghĩa đã nạp toàn bộ tiền vào hệ thống.', 4.35);
  callout(s, 'Cần đủ số dư, allowance và route hợp lệ. Đến lịch không bảo đảm swap thành công.', 6.07, true);
}

// 06 — Phân biệt mục tiêu với hiện trạng.
{
  const s = base(6, 'Recipe 02', 'Auto-Compounder: mục tiêu và hiện trạng',
    'Trình bày đúng mức độ hoàn thiện, không coi thiết kế là bằng chứng đã triển khai.');
  box(s, 0.65, 2.52, 5.89, 3.12, C.white, C.line);
  box(s, 6.79, 2.52, 5.89, 3.12, C.white, C.line);
  tag(s, 'MỤC TIÊU SẢN PHẨM', 0.95, 2.83, 2.58);
  tag(s, 'NHÁNH KEEPER HIỆN CÓ', 7.09, 2.83, 2.85);
  text(s, 'Nhận thưởng\n→ Đổi về USDC nếu cần\n→ Tái đầu tư', 0.95, 3.56, 5.29, 1.42, { fontSize: 24, bold: true });
  text(s, 'Kiểm tra reward\n→ claimRewardsForUser\n→ Bỏ qua nếu không có reward', 7.09, 3.56, 5.29, 1.42, { fontSize: 23, bold: true });
  callout(s, 'Chưa khẳng định hoàn tất claim → swap → tái gửi. APY hiển thị không phải cam kết.', 6.07, true);
}

// 07 — Kiến trúc quyền.
{
  const s = base(7, 'Kiểm soát quyền', 'Ba hợp đồng, nhiều lớp giới hạn',
    'Session key, allowance token và trạng thái recipe là các cơ chế khác nhau.');
  const nodes = [
    [0.65, 2.55, 2.02, 'Ví người dùng', C.navy],
    [3.04, 2.55, 1.65, 'Keeper', C.navy],
    [5.06, 2.55, 4.12, 'SharedExecutorProxy', C.teal],
    [9.55, 2.55, 3.13, 'Protocol đích', C.navy]
  ];
  nodes.forEach(([x, y, w, label, fill], i) => {
    box(s, x, y, w, 0.82, fill);
    text(s, label, x + 0.1, y + 0.24, w - 0.2, 0.32, { fontSize: 18, bold: true, color: C.white, align: 'center' });
    if (i < 3) text(s, '→', x + w + 0.06, y + 0.25, 0.28, 0.3, { fontSize: 18, color: C.teal });
  });
  box(s, 0.65, 3.85, 3.72, 1.73, C.white, C.line);
  box(s, 4.61, 3.85, 4.11, 1.73, C.white, C.line);
  box(s, 8.96, 3.85, 3.72, 1.73, C.white, C.line);
  row(s, 'Pause / Revoke', 'Quyền dừng của người dùng;\ncó vai trò pause quản trị.', 4.06, 0.9, 3.22);
  row(s, 'SessionKeyRegistry', 'Thời hạn, thu hồi, quota cộng dồn;\ncó thể dùng chung nhiều recipe.', 4.06, 4.86, 3.61);
  row(s, 'RecipeGuardrail', 'Giới hạn địa chỉ protocol\nvà function selector.', 4.06, 9.21, 3.22);
  callout(s, 'Revoke session ≠ xóa allowance. Whitelist không tự chứng minh mọi tham số đều an toàn.', 6.07, true);
}

// 08 — Vòng đời keeper.
{
  const s = base(8, 'Thực thi', 'Keeper: từ lịch chạy đến xác nhận giao dịch',
    'Dịch vụ ngoài blockchain chuẩn bị, kiểm tra và theo dõi từng lượt chạy.');
  const steps = ['Đến hạn', 'Kiểm tra', 'Chọn route', 'eth_call', 'Hàng đợi', 'Gửi', 'Xác nhận', 'Nhật ký'];
  steps.forEach((label, i) => {
    const x = 0.65 + (i % 4) * 3.07;
    const y = i < 4 ? 2.6 : 4.12;
    box(s, x, y, 2.82, 1.12, i === 3 ? C.navy : C.white, i === 3 ? C.navy : C.line);
    text(s, `${i + 1}`.padStart(2, '0'), x + 0.17, y + 0.15, 0.5, 0.25, {
      fontSize: 12, bold: true, color: i === 3 ? C.mint : C.teal
    });
    text(s, label, x + 0.17, y + 0.55, 2.48, 0.34, {
      fontSize: 22, bold: true, color: i === 3 ? C.white : C.ink
    });
  });
  text(s, 'PostgreSQL  •  BullMQ / Redis theo cấu hình  •  Retry, backoff và RPC failover',
    0.85, 5.58, 11.63, 0.3, { fontSize: 16, color: C.muted });
  callout(s, 'eth_call kiểm tra tại một thời điểm. Đã gửi giao dịch ≠ đã được xác nhận.');
}

// 09 — Bản đồ thao tác, không phải ảnh kết quả demo.
{
  const s = base(9, 'Demo trực tiếp • 4 phút', 'DCA: cấu hình → cấp quyền → theo dõi',
    'Chuyển sang ứng dụng. Không chờ đủ 10 lượt; chuẩn bị giao dịch lịch sử đã xác minh.');
  box(s, 0.65, 2.48, 4.05, 3.27, C.navy);
  text(s, 'CẤU HÌNH MINH HỌA', 0.95, 2.79, 3.45, 0.3, { fontSize: 12, bold: true, color: C.mint });
  text(s, 'Ngân sách: 50 USDC\nMỗi lượt: 5 USDC\nChu kỳ: 24 giờ\nSession limit: 50 USDC', 0.95, 3.42, 3.45, 1.87, {
    fontSize: 21, color: C.white, paraSpaceAfterPt: 15
  });
  const steps = [
    ['11:00', 'Kết nối ví; xác minh Arc Testnet.'],
    ['11:35', 'Đặt ngân sách, lịch và slippage phù hợp.'],
    ['12:20', 'Kiểm tra spender, allowance và session.'],
    ['13:20', 'Kích hoạt; phân biệt pending với confirmed.'],
    ['14:15', 'Đối chiếu hash; chỉ rõ Pause / Revoke.']
  ];
  steps.forEach(([time, body], i) => {
    const y = 2.55 + i * 0.63;
    text(s, time, 5.05, y, 0.85, 0.35, { fontSize: 16, bold: true, color: C.teal });
    text(s, body, 6.08, y, 6.38, 0.43, { fontSize: 17 });
  });
  callout(s, 'Nếu chậm quá 20–30 giây: dùng lịch sử đã xác minh; không nới giới hạn để ép demo.', 6.07, true);
}

// 10 — Các công cụ bổ trợ.
{
  const s = base(10, 'Hệ sinh thái công cụ', 'Swap, Send, Bridge và Unified Balance',
    'Có mã tích hợp không đồng nghĩa mọi luồng đã được xác minh đầu cuối.');
  [
    ['Swap', 'Báo giá và đổi\nUSDC / EURC.'],
    ['Send', 'Gửi USDC\ntrên Arc Testnet.'],
    ['Bridge', 'Approve → burn\n→ attestation → mint.'],
    ['Unified Balance', 'Xem, nạp và chi tiêu\nqua App Kit.']
  ].forEach(([head, body], i) => {
    card(s, 0.65 + i * 3.07, 2.55, 2.82, 3.07, `0${i + 1}`, head, body);
  });
  callout(s, 'Unified Balance / Gateway ở keeper mặc định tắt; chưa tuyên bố recipe tự dùng vốn xuyên chuỗi.', 6.07, true);
}

// 11 — Mức độ hoàn thiện.
{
  const s = base(11, 'Hiện trạng & ưu tiên', 'Chứng minh lõi thực thi trước khi mở rộng',
    'Đối chiếu theo kịch bản ngày 22/10/2026; không phải kết quả kiểm thử hay demo mới.');
  box(s, 0.65, 2.52, 5.89, 3.12, C.white, C.line);
  box(s, 6.79, 2.52, 5.89, 3.12, C.white, C.line);
  tag(s, 'ĐÃ CÓ TRONG MÃ', 0.95, 2.83, 2.4);
  tag(s, 'CẦN XÁC MINH / HOÀN THIỆN', 7.09, 2.83, 3.58);
  text(s, 'Cấu hình recipe và API\nScheduler, eth_call, hàng đợi\nNhật ký và ba hợp đồng lõi', 0.95, 3.58, 5.29, 1.56, {
    fontSize: 22, paraSpaceAfterPt: 16
  });
  text(s, 'Từng route chạy đầu cuối\nChuỗi Auto-Compounder đầy đủ\nĐộ bền vận hành; bảo mật độc lập', 7.09, 3.58, 5.29, 1.56, {
    fontSize: 21, paraSpaceAfterPt: 16
  });
  callout(s, 'Báo cáo nội bộ 06/10: keeper 94/94 test đạt khi đó. Không thay thế kiểm toán độc lập.', 6.07, true);
}

// 12 — Tổng kết và liên hệ.
{
  const s = base(12, '', '', '', true);
  tag(s, 'TỔNG KẾT & HỎI ĐÁP', 0.75, 0.67, 2.7, true);
  text(s, 'Tự động hóa.\nCó giới hạn.\nCó bằng chứng.', 0.75, 1.55, 7.0, 2.75, {
    fontSize: 43, bold: true, color: C.white, paraSpaceAfterPt: 12
  });
  text(s, 'Mời trải nghiệm trên Arc Testnet\nvà góp ý cho quy trình, quyền hạn, lịch sử.', 0.8, 4.83, 6.7, 0.9, {
    fontSize: 22, color: C.mint
  });
  text(s, 'Cảm ơn bạn đã theo dõi!', 0.8, 6.15, 6.6, 0.4, { fontSize: 20, color: C.light });
  box(s, 8.1, 1.55, 4.5, 4.75, '142C45');
  text(s, 'KẾT NỐI VỚI TÔI', 8.5, 2.03, 3.7, 0.3, { fontSize: 12, bold: true, color: C.mint });
  contact(s, 8.5, 2.88, 3.7, true);
  text(s, '18 phút trình bày\n+ 2 phút trao đổi tùy chương trình', 8.5, 5.15, 3.7, 0.67, {
    fontSize: 15, color: C.light
  });
}

pptx.writeFile({ fileName: output }).then(() => {
  console.log(`Đã tạo 12 slide: ${output}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
