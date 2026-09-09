const pptxgen = require('pptxgenjs');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = 'DeFi Recipes on Arc';
pptx.subject = 'Product demo';
pptx.title = 'DeFi Recipes on Arc - Product Demo';
pptx.company = 'DeFi Recipes on Arc';
pptx.lang = 'vi-VN';
pptx.theme = {
  headFontFace: 'Arial',
  bodyFontFace: 'Arial',
  lang: 'vi-VN'
};
pptx.defineLayout({ name: 'CUSTOM_WIDE', width: 13.333, height: 7.5 });
pptx.layout = 'CUSTOM_WIDE';

const C = {
  navy: '081B33',
  ink: '11233A',
  muted: '60728A',
  cyan: '08A6D6',
  cyanLight: 'DDF6FC',
  blue: '2667FF',
  green: '19A974',
  greenLight: 'E1F8EF',
  gold: 'F5B82E',
  goldLight: 'FFF5D8',
  rose: 'D94C6A',
  roseLight: 'FCE9EE',
  white: 'FFFFFF',
  surface: 'F4F8FC',
  line: 'D8E4EF'
};

function addText(slide, text, x, y, w, h, options = {}) {
  slide.addText(text, {
    x, y, w, h,
    margin: options.margin ?? 0,
    breakLine: false,
    fontFace: options.fontFace ?? 'Arial',
    fontSize: options.fontSize ?? 15,
    color: options.color ?? C.ink,
    bold: options.bold ?? false,
    align: options.align ?? 'left',
    valign: options.valign ?? 'mid',
    fit: 'shrink',
    ...options
  });
}

function pill(slide, label, x, y, w, fill = C.cyanLight, color = C.cyan) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.34, rectRadius: 0.08, fill: { color: fill }, line: { color: fill } });
  addText(slide, label, x, y + 0.02, w, 0.25, { fontSize: 8.5, bold: true, color, align: 'center' });
}

function iconCircle(slide, label, x, y, fill = C.cyan) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y, w: 0.52, h: 0.52, fill: { color: fill }, line: { color: fill } });
  addText(slide, label, x, y + 0.01, 0.52, 0.44, { fontSize: 17, bold: true, color: C.white, align: 'center' });
}

function background(slide, number) {
  slide.background = { color: C.white };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.16, fill: { color: C.cyan }, line: { color: C.cyan } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.19, w: 13.333, h: 0.31, fill: { color: C.navy }, line: { color: C.navy } });
  addText(slide, 'DEFI RECIPES ON ARC', 0.55, 7.25, 2.6, 0.14, { fontSize: 7.5, bold: true, color: 'B6D4E8' });
  addText(slide, String(number).padStart(2, '0'), 12.22, 7.23, 0.55, 0.16, { fontSize: 8, bold: true, color: C.white, align: 'right' });
}

function title(slide, eyebrow, heading, subheading) {
  addText(slide, eyebrow.toUpperCase(), 0.65, 0.48, 4.5, 0.22, { fontSize: 9, bold: true, color: C.cyan, charSpacing: 1.2 });
  addText(slide, heading, 0.65, 0.78, 11.8, 0.58, { fontFace: 'Arial', fontSize: 28, bold: true, color: C.navy });
  if (subheading) addText(slide, subheading, 0.65, 1.41, 11.4, 0.36, { fontSize: 12.5, color: C.muted });
}

function bullet(slide, text, x, y, w, accent = C.cyan) {
  slide.addShape(pptx.ShapeType.ellipse, { x, y: y + 0.08, w: 0.13, h: 0.13, fill: { color: accent }, line: { color: accent } });
  addText(slide, text, x + 0.25, y, w - 0.25, 0.34, { fontSize: 14, color: C.ink, breakLine: false });
}

function metric(slide, value, label, x, color, fill) {
  slide.addShape(pptx.ShapeType.roundRect, { x, y: 5.75, w: 1.78, h: 0.85, rectRadius: 0.06, fill: { color: fill }, line: { color: fill } });
  addText(slide, value, x, 5.87, 1.78, 0.25, { fontSize: 19, bold: true, color, align: 'center' });
  addText(slide, label, x, 6.23, 1.78, 0.16, { fontSize: 8.5, bold: true, color: C.muted, align: 'center' });
}

function addNotes(slide, note) {
  slide.addNotes(note);
}

// 1. Cover
{
  const slide = pptx.addSlide();
  slide.background = { color: C.surface };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 5.25, h: 7.5, fill: { color: C.navy }, line: { color: C.navy } });
  slide.addShape(pptx.ShapeType.arc, { x: 7.35, y: -1.1, w: 6.2, h: 6.2, adjustPoint: 0.2, line: { color: C.cyan, width: 2.5, transparency: 16 }, fill: { color: C.white, transparency: 100 } });
  slide.addShape(pptx.ShapeType.arc, { x: 8.4, y: 1.15, w: 4.2, h: 4.2, adjustPoint: 0.2, line: { color: C.blue, width: 1.2, transparency: 40 }, fill: { color: C.white, transparency: 100 } });
  pill(slide, 'ARC TESTNET', 0.68, 0.72, 1.15, '103E62', '7CE4FF');
  addText(slide, 'DeFi Recipes\non Arc', 0.67, 1.48, 4.05, 1.23, { fontFace: 'Arial', fontSize: 33, bold: true, color: C.white, breakLine: true });
  addText(slide, 'Automate your DeFi strategy', 0.7, 2.95, 3.8, 0.36, { fontSize: 16, color: 'B6D4E8' });
  addText(slide, 'Demo sản phẩm | Tự động hoá DeFi phi lưu ký', 0.7, 5.9, 3.85, 0.28, { fontSize: 11, color: 'B6D4E8' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 5.85, y: 1.35, w: 6.25, h: 4.55, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.line, width: 1.2 }, shadow: { type: 'outer', color: '9DB5C8', opacity: 0.18, blur: 2, angle: 45, distance: 2 } });
  addText(slide, 'Dashboard', 6.2, 1.72, 1.8, 0.25, { fontSize: 12, bold: true });
  pill(slide, 'Connected', 10.35, 1.65, 1.15, C.greenLight, C.green);
  addText(slide, 'USDC → EURC DCA', 6.2, 2.34, 3.0, 0.3, { fontSize: 19, bold: true, color: C.navy });
  addText(slide, 'Weekly • $50 USDC • Max slippage 0.5%', 6.2, 2.75, 4.75, 0.24, { fontSize: 10.5, color: C.muted });
  slide.addShape(pptx.ShapeType.roundRect, { x: 6.2, y: 3.35, w: 5.52, h: 1.22, rectRadius: 0.07, fill: { color: C.cyanLight }, line: { color: C.cyanLight } });
  addText(slide, 'Next execution', 6.48, 3.62, 1.65, 0.2, { fontSize: 10, color: C.muted });
  addText(slide, 'In 2 days', 6.48, 3.9, 1.7, 0.28, { fontSize: 18, bold: true, color: C.cyan });
  pill(slide, 'Active', 10.25, 3.78, 0.86, C.greenLight, C.green);
  slide.addShape(pptx.ShapeType.roundRect, { x: 6.2, y: 4.94, w: 2.1, h: 0.45, rectRadius: 0.06, fill: { color: C.cyan }, line: { color: C.cyan } });
  addText(slide, 'View recipe', 6.2, 5.03, 2.1, 0.17, { fontSize: 10, bold: true, color: C.white, align: 'center' });
  addNotes(slide, 'Chào mừng mọi người đến với DeFi Recipes on Arc. Đây là bản demo một ứng dụng giúp tự động hoá các thao tác DeFi lặp lại, nhưng người dùng vẫn giữ toàn quyền với tài sản. Trong vài phút tới, chúng ta sẽ tạo và kích hoạt một chiến lược DCA thực tế.');
}

// 2. Problem
{
  const slide = pptx.addSlide(); background(slide, 2);
  title(slide, 'Bối cảnh', 'DeFi thủ công khiến chiến lược dễ bị đứt quãng', 'Các thao tác đơn giản lặp lại nhanh chóng trở thành gánh nặng.');
  const items = [
    ['↻', 'Lặp lại', 'Nhớ mua, swap hoặc tái đầu tư đúng lịch.'],
    ['⌁', 'Phân tán', 'Theo dõi nhiều giao dịch, số dư và trạng thái.'],
    ['!', 'Rủi ro', 'Dễ vội vàng khi giá biến động, thiếu giới hạn rõ ràng.']
  ];
  items.forEach(([icon, head, body], index) => {
    const x = 0.78 + index * 4.1;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.15, w: 3.56, h: 2.34, rectRadius: 0.08, fill: { color: C.white }, line: { color: C.line }, shadow: { type: 'outer', color: 'B7C7D4', opacity: 0.12, blur: 1, angle: 45, distance: 1 } });
    iconCircle(slide, icon, x + 0.34, 2.53, index === 2 ? C.rose : index === 1 ? C.gold : C.cyan);
    addText(slide, head, x + 1.06, 2.55, 2.0, 0.27, { fontSize: 18, bold: true, color: C.navy });
    addText(slide, body, x + 0.34, 3.35, 2.85, 0.62, { fontSize: 12.2, color: C.muted, breakLine: true, valign: 'top' });
  });
  addText(slide, 'Kết quả: chiến lược phụ thuộc vào thời gian, sự tập trung và phản ứng của bạn.', 1.0, 5.38, 11.3, 0.35, { fontSize: 18, bold: true, color: C.navy, align: 'center' });
  addNotes(slide, 'Nhiều người dùng đã có chiến lược rõ ràng, ví dụ mua định kỳ. Vấn đề là việc thực thi vẫn thủ công: phải nhớ lịch, kiểm tra giao dịch và phản ứng khi thị trường biến động. Điều đó khiến một chiến lược kỷ luật trở nên khó duy trì.');
}

// 3. Solution
{
  const slide = pptx.addSlide(); background(slide, 3);
  title(slide, 'Giải pháp', 'Một “recipe” biến điều kiện thành hành động tự động', 'Bạn đặt trước quy tắc; hệ thống chỉ thực thi trong phạm vi đã cho phép.');
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.75, y: 2.32, w: 2.5, h: 2.55, rectRadius: 0.08, fill: { color: C.cyanLight }, line: { color: C.cyanLight } });
  iconCircle(slide, '1', 1.73, 2.65, C.cyan); addText(slide, 'Bạn đặt\nđiều kiện', 1.08, 3.42, 1.85, 0.62, { fontSize: 17, bold: true, color: C.navy, align: 'center', breakLine: true });
  slide.addShape(pptx.ShapeType.chevron, { x: 3.5, y: 3.29, w: 0.48, h: 0.52, fill: { color: C.cyan }, line: { color: C.cyan } });
  slide.addShape(pptx.ShapeType.roundRect, { x: 4.35, y: 2.32, w: 4.63, h: 2.55, rectRadius: 0.08, fill: { color: C.navy }, line: { color: C.navy } });
  pill(slide, 'RECIPE ENGINE', 5.68, 2.63, 1.9, '103E62', '7CE4FF');
  addText(slide, 'Kiểm tra an toàn\ntrước khi thực thi', 5.1, 3.18, 3.15, 0.7, { fontSize: 20, bold: true, color: C.white, align: 'center', breakLine: true });
  addText(slide, 'Session Key • Whitelist • Slippage limit', 4.78, 4.23, 3.78, 0.21, { fontSize: 10.5, color: 'B6D4E8', align: 'center' });
  slide.addShape(pptx.ShapeType.chevron, { x: 9.28, y: 3.29, w: 0.48, h: 0.52, fill: { color: C.green }, line: { color: C.green } });
  slide.addShape(pptx.ShapeType.roundRect, { x: 10.13, y: 2.32, w: 2.45, h: 2.55, rectRadius: 0.08, fill: { color: C.greenLight }, line: { color: C.greenLight } });
  iconCircle(slide, '✓', 11.08, 2.65, C.green); addText(slide, 'Giao dịch\nđược ghi nhận', 10.45, 3.42, 1.82, 0.62, { fontSize: 16.5, bold: true, color: C.navy, align: 'center', breakLine: true });
  addNotes(slide, 'Recipe là một chiến lược đóng gói. Bạn đặt số tiền, lịch chạy và giới hạn. Khi đến thời điểm, hệ thống kiểm tra quyền phiên, protocol được phép và điều kiện an toàn trước khi gửi giao dịch. Mọi lần chạy đều được ghi lại để bạn theo dõi.');
}

// 4. Value
{
  const slide = pptx.addSlide(); background(slide, 4);
  title(slide, 'Giá trị', 'Ít thao tác hơn. Nhiều kiểm soát hơn.', 'Arc giúp trải nghiệm tự động hoá nhanh, dễ dự đoán và ưu tiên USDC.');
  const values = [
    ['○', 'Đơn giản', 'Biến chiến lược lặp lại thành một recipe.'],
    ['◷', 'Tiết kiệm thời gian', 'Không cần canh lịch để thực hiện từng lệnh.'],
    ['⌾', 'Kiểm soát tốt hơn', 'Đặt hạn mức, slippage và quyền có thời hạn.'],
    ['↯', 'Tối ưu cho Arc', 'Finality nhanh, phí ổn định bằng USDC.']
  ];
  values.forEach(([icon, head, body], index) => {
    const x = 0.82 + (index % 2) * 6.15; const y = 2.08 + Math.floor(index / 2) * 1.78;
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.52, h: 1.32, rectRadius: 0.06, fill: { color: C.white }, line: { color: C.line } });
    iconCircle(slide, icon, x + 0.34, y + 0.39, index === 3 ? C.gold : C.cyan);
    addText(slide, head, x + 1.1, y + 0.28, 3.7, 0.25, { fontSize: 16, bold: true, color: C.navy });
    addText(slide, body, x + 1.1, y + 0.68, 3.95, 0.24, { fontSize: 11.2, color: C.muted });
  });
  addNotes(slide, 'Điểm quan trọng không chỉ là tự động hoá. Người dùng giảm thao tác nhưng vẫn đặt các ranh giới cụ thể. Trên Arc Testnet, USDC là tài sản trả phí gas, finality nhanh và mức phí dễ dự đoán, rất hợp với những workflow định kỳ.');
}

// 5. Features
{
  const slide = pptx.addSlide(); background(slide, 5);
  title(slide, 'Chức năng', 'Bốn thành phần cho một workflow DeFi an toàn', 'Thiết kế để bạn hiểu điều gì được phép xảy ra trước khi kích hoạt.');
  const features = [
    ['DCA', 'DCA automation', 'Lập lịch mua định kỳ USDC → EURC.'],
    ['KEY', 'Session keys', 'Uỷ quyền có phạm vi và thời hạn rõ ràng.'],
    ['SAFE', 'Transaction guardrails', 'Giới hạn số tiền, protocol và slippage.'],
    ['LOG', 'Execution tracking', 'Xem trạng thái, hash và lịch sử lần chạy.']
  ];
  features.forEach(([icon, head, body], index) => {
    const x = 0.72 + index * 3.15;
    slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.2, w: 2.72, h: 2.64, rectRadius: 0.07, fill: { color: C.white }, line: { color: C.line } });
    slide.addShape(pptx.ShapeType.roundRect, { x: x + 0.27, y: 2.52, w: 0.84, h: 0.43, rectRadius: 0.05, fill: { color: index === 2 ? C.roseLight : C.cyanLight }, line: { color: index === 2 ? C.roseLight : C.cyanLight } });
    addText(slide, icon, x + 0.27, 2.62, 0.84, 0.16, { fontSize: 8.5, bold: true, color: index === 2 ? C.rose : C.cyan, align: 'center' });
    addText(slide, head, x + 0.27, 3.3, 2.13, 0.48, { fontSize: 15, bold: true, color: C.navy, breakLine: true });
    addText(slide, body, x + 0.27, 4.02, 2.13, 0.4, { fontSize: 10.8, color: C.muted, breakLine: true, valign: 'top' });
  });
  addNotes(slide, 'Đây là bốn phần người dùng sẽ gặp trong demo. DCA tạo lịch tự động. Session Key cấp quyền đúng phạm vi. Guardrail là hàng rào bảo vệ cho giao dịch. Và Execution Tracking cho biết recipe đã chạy đến đâu, minh bạch từng bước.');
}

// 6. User flow
{
  const slide = pptx.addSlide(); background(slide, 6);
  title(slide, 'Trải nghiệm', 'Từ kết nối ví đến theo dõi kết quả trong 6 bước', 'Một flow ngắn, có màn hình review trước khi có bất kỳ thao tác on-chain nào.');
  const steps = ['Connect\nwallet', 'Create\nrecipe', 'Set rules', 'Review', 'Activate', 'Monitor\nresults'];
  steps.forEach((step, index) => {
    const x = 0.62 + index * 2.1;
    if (index < steps.length - 1) slide.addShape(pptx.ShapeType.line, { x: x + 1.42, y: 3.45, w: 0.7, h: 0, line: { color: C.line, width: 1.5, beginArrowType: 'none', endArrowType: 'triangle' } });
    slide.addShape(pptx.ShapeType.ellipse, { x, y: 2.72, w: 1.45, h: 1.45, fill: { color: index === 4 ? C.cyan : C.white }, line: { color: index === 4 ? C.cyan : C.line, width: 1.4 } });
    addText(slide, String(index + 1), x, 2.98, 1.45, 0.35, { fontSize: 19, bold: true, color: index === 4 ? C.white : C.cyan, align: 'center' });
    addText(slide, step, x - 0.18, 4.45, 1.82, 0.48, { fontSize: 12, bold: true, color: C.navy, align: 'center', breakLine: true });
  });
  pill(slide, 'amount', 4.25, 5.48, 0.8, C.cyanLight, C.cyan); pill(slide, 'frequency', 5.18, 5.48, 0.95, C.cyanLight, C.cyan); pill(slide, 'limits', 6.28, 5.48, 0.72, C.roseLight, C.rose);
  addNotes(slide, 'Luồng trải nghiệm bắt đầu bằng Connect wallet. Người dùng chọn một recipe, cấu hình số tiền, tần suất và giới hạn. Trước khi kích hoạt luôn có bước Review để nhìn lại chính xác quyền nào đang được cấp. Sau đó dashboard dùng để theo dõi kết quả.');
}

// 7. Live demo
{
  const slide = pptx.addSlide(); background(slide, 7);
  title(slide, 'Demo trực tiếp', 'Tạo một DCA recipe USDC trong chưa đến 2 phút', 'Kịch bản minh hoạ: mua EURC bằng 50 USDC mỗi tuần.');
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.72, y: 2.05, w: 6.55, h: 4.25, rectRadius: 0.07, fill: { color: C.white }, line: { color: C.line } });
  addText(slide, 'Create recipe', 1.03, 2.37, 2.3, 0.25, { fontSize: 15.5, bold: true });
  addText(slide, 'USDC → EURC Recurring DCA', 1.03, 2.82, 3.7, 0.24, { fontSize: 11.3, color: C.muted });
  [['Amount', '$50 USDC'], ['Frequency', 'Weekly'], ['Max slippage', '0.5%']].forEach(([label, value], index) => {
    const y = 3.35 + index * 0.62;
    addText(slide, label, 1.03, y, 1.4, 0.2, { fontSize: 10.5, color: C.muted });
    slide.addShape(pptx.ShapeType.roundRect, { x: 2.48, y: y - 0.06, w: 2.42, h: 0.35, rectRadius: 0.03, fill: { color: C.surface }, line: { color: C.line } });
    addText(slide, value, 2.67, y + 0.015, 1.95, 0.14, { fontSize: 10.4, color: C.ink });
  });
  slide.addShape(pptx.ShapeType.roundRect, { x: 1.03, y: 5.46, w: 1.65, h: 0.43, rectRadius: 0.05, fill: { color: C.cyan }, line: { color: C.cyan } });
  addText(slide, 'Activate recipe', 1.03, 5.55, 1.65, 0.15, { fontSize: 9.5, bold: true, color: C.white, align: 'center' });
  const demoSteps = [
    ['1', 'Create', 'Chọn DCA USDC → EURC.'],
    ['2', 'Schedule', 'Đặt số tiền và tần suất.'],
    ['3', 'Protect', 'Chọn slippage và spending limit.'],
    ['4', 'Activate', 'Xác nhận rồi xem execution history.']
  ];
  demoSteps.forEach(([number, head, body], index) => {
    const y = 2.15 + index * 0.97;
    iconCircle(slide, number, 8.1, y, index === 3 ? C.green : C.cyan);
    addText(slide, head, 8.86, y + 0.02, 1.42, 0.2, { fontSize: 14.5, bold: true });
    addText(slide, body, 8.86, y + 0.31, 3.24, 0.22, { fontSize: 10.5, color: C.muted });
  });
  addNotes(slide, 'Bây giờ là phần demo. Tôi sẽ chọn recipe DCA USDC sang EURC, đặt 50 USDC mỗi tuần, giới hạn slippage ở mức 0.5 phần trăm và xác nhận hạn mức giao dịch. Sau khi Activate, chúng ta mở lịch sử để xem lần thực thi và trạng thái của recipe.');
}

// 8. CTA
{
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };
  slide.addShape(pptx.ShapeType.arc, { x: 7.6, y: -0.95, w: 6.2, h: 6.2, adjustPoint: 0.2, line: { color: C.cyan, width: 2.5, transparency: 16 }, fill: { color: C.navy, transparency: 100 } });
  slide.addShape(pptx.ShapeType.arc, { x: 8.75, y: 1.2, w: 4.05, h: 4.05, adjustPoint: 0.2, line: { color: C.green, width: 1.2, transparency: 45 }, fill: { color: C.navy, transparency: 100 } });
  pill(slide, 'ARC TESTNET', 0.8, 0.85, 1.15, '103E62', '7CE4FF');
  addText(slide, 'Bắt đầu với\nrecipe đầu tiên.', 0.78, 1.58, 6.25, 1.15, { fontFace: 'Arial', fontSize: 34, bold: true, color: C.white, breakLine: true });
  addText(slide, 'Kết nối ví, đặt quy tắc của bạn và để automation thực hiện phần còn lại.', 0.82, 3.05, 5.4, 0.56, { fontSize: 15, color: 'B6D4E8', breakLine: true });
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.82, y: 4.22, w: 2.0, h: 0.57, rectRadius: 0.07, fill: { color: C.cyan }, line: { color: C.cyan } });
  addText(slide, 'Try the demo', 0.82, 4.36, 2.0, 0.19, { fontSize: 12, bold: true, color: C.white, align: 'center' });
  addText(slide, 'Connect wallet  →  Create recipe  →  Activate', 0.82, 5.35, 4.9, 0.22, { fontSize: 11.5, bold: true, color: 'B6D4E8' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 7.35, y: 1.75, w: 4.5, h: 3.82, rectRadius: 0.1, fill: { color: C.white }, line: { color: C.white } });
  addText(slide, 'Ready to automate?', 7.76, 2.18, 3.4, 0.3, { fontSize: 19, bold: true, color: C.navy, align: 'center' });
  iconCircle(slide, '✓', 9.3, 2.93, C.green);
  addText(slide, 'Wallet connected', 8.18, 3.72, 2.8, 0.2, { fontSize: 12.5, bold: true, color: C.navy, align: 'center' });
  pill(slide, 'Arc Testnet', 8.74, 4.17, 1.65, C.cyanLight, C.cyan);
  addText(slide, 'Your strategy. Your rules.', 8.1, 4.85, 3.05, 0.18, { fontSize: 10.5, color: C.muted, align: 'center' });
  addNotes(slide, 'Đây là lúc mời mọi người trải nghiệm. Hãy kết nối ví trên Arc Testnet, chọn recipe DCA và thử cấu hình theo khẩu vị rủi ro của mình. Bạn luôn có thể theo dõi, pause hoặc revoke quyền phiên khi cần.');
}

pptx.writeFile({ fileName: 'DeFi-Recipes-on-Arc-Demo-vi.pptx' });