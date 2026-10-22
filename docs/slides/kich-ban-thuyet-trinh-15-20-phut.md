# Kịch bản thuyết trình DeFi Recipes on Arc trong 15–20 phút

## 1. Thông tin sử dụng

- **Ngôn ngữ:** Tiếng Việt. Giữ nguyên tên sản phẩm, thuật ngữ và nhãn giao diện bằng tiếng Anh khi cần đối chiếu màn hình.
- **Khán giả giả định:** Cộng đồng Arc, người dùng DeFi và nhà phát triển; không yêu cầu biết Solidity.
- **Bản chuẩn:** 18 phút, bao gồm khoảng 4 phút demo có lời dẫn. Hỏi đáp không nằm trong 18 phút; có thể dùng 2 phút bổ sung để kết thúc ở mốc 20 phút.
- **Nhịp diễn tập:** Lời thoại khoảng 3.200 đơn vị tách bằng khoảng trắng. Ở nhịp khoảng 200 đơn vị/phút, phần nói mất khoảng 16 phút; cộng khoảng 2 phút thao tác và chuyển màn hình sẽ gần 18 phút. Đây chỉ là ước lượng, không coi cách đếm này là số từ ngôn ngữ học hoặc thời gian đã đo.
- **Thông điệp chính:** Tự động hóa những thao tác DeFi lặp lại, đồng thời đặt giới hạn cho quyền thực thi và giúp người dùng theo dõi kết quả.
- **Bối cảnh:** MVP trên Arc Testnet, không phải bản phát hành mainnet. Đây là dự án cộng đồng độc lập, không phải sản phẩm chính thức của Arc hoặc Circle.
- **Ngày đối chiếu nguồn:** 22/10/2026. Việc chuẩn bị kịch bản không bao gồm chạy lại hệ thống, kiểm thử hoặc xác minh giao dịch trực tiếp trên mạng.

Phần **Lời thoại** có thể đọc trực tiếp. Phần **Trình chiếu**, **Thao tác** và các phụ lục là ghi chú cho người trình bày, không đọc thành tiếng. Thời gian là khung diễn tập, không phải cam kết tốc độ nói; cần bấm giờ một lượt với đúng môi trường demo trước buổi trình bày.

## 2. Phân bổ thời gian và nội dung slide

| Slide | Mốc thời gian | Thời lượng | Nội dung trên slide |
| --- | --- | --- | --- |
| 1 | 00:00–01:00 | 1:00 | DeFi Recipes on Arc: tự động hóa có giới hạn |
| 2 | 01:00–02:30 | 1:30 | Vấn đề: chiến lược đơn giản, thao tác vẫn lặp lại |
| 3 | 02:30–03:45 | 1:15 | Vì sao chọn Arc? |
| 4 | 03:45–05:00 | 1:15 | Recipe là gì và MVP tập trung vào đâu? |
| 5 | 05:00–06:30 | 1:30 | DCA USDC sang EURC theo ngân sách |
| 6 | 06:30–08:00 | 1:30 | Auto-Compounder: mục tiêu và hiện trạng |
| 7 | 08:00–10:00 | 2:00 | Ba hợp đồng và các lớp kiểm soát |
| 8 | 10:00–11:00 | 1:00 | Keeper: từ lịch chạy đến xác nhận giao dịch |
| 9 | 11:00–15:00 | 4:00 | Demo DCA: cấu hình, cấp quyền, theo dõi |
| 10 | 15:00–16:00 | 1:00 | Swap, Send, Bridge và Unified Balance |
| 11 | 16:00–17:00 | 1:00 | Mức độ hoàn thiện và hướng phát triển |
| 12 | 17:00–18:00 | 1:00 | Tổng kết và lời mời trải nghiệm |

Đây là đề cương 12 slide cho bài nói mới, không phải mô tả bộ slide 8 trang trong mã tạo deck cũ. Bộ [PowerPoint 12 slide của Lê Văn Tùy](./DeFi-Recipes-on-Arc-Le-Van-Tuy-vi.pptx) sử dụng đề cương này, kèm lời thoại trong phần ghi chú và thông tin liên hệ ở trang mở đầu, trang kết thúc. Có thể tạo lại bằng lệnh `node .\docs\slides\generate-presentation-deck.js` từ thư mục gốc repository.

## 3. Kịch bản chi tiết

### Slide 1. DeFi Recipes on Arc

**Thời gian:** 00:00–01:00.

**Trình chiếu:** Tên dự án; dòng thông điệp “Tự động hóa DeFi, giữ quyền kiểm soát”; nhãn Arc Testnet.

**Lời thoại:**

Xin chào anh Teddzy, anh Lecter và toàn thể mọi người tham gia event ngày hôm nay.

Mình là Tùy, một nhà phát triển phần mềm và đến nay mình đã có khoảng 15 năm làm việc trong lĩnh vực CNTT.

Mình biết đến Bitcoin từ khá sớm, từ những năm còn học đại học và sau này đi làm vẫn tiếp tục theo dõi. Nhưng phải đến năm 2021, mình mới chính thức bước vào thị trường crypto.

Mình vẫn nhớ cảm giác lần đầu tiên tự thực hiện một giao dịch trên blockchain. Lần đầu mua coin theo một người đồng nghiệp, sáng hôm sau thức dậy thấy tài khoản x3 — thực sự là một cảm giác rất phấn khích. 😄

Nhưng niềm vui đó không kéo dài quá lâu. Kết thúc mùa đầu tiên, mình mất toàn bộ khoản tiền tiết kiệm.

Và cũng chính từ thất bại đó, mình bắt đầu tìm hiểu sâu hơn về crypto, blockchain và DeFi, rồi tìm hiểu thêm về airdrop.

Chính hành trình đó đã đưa mình đến với Arc, và cũng là cơ duyên để hôm nay mình có cơ hội gặp gỡ mọi người và chia sẻ về DeFi Recipes on Arc.

Ý tưởng xuất phát từ một câu hỏi rất thực tế: nếu chúng ta đã biết mình muốn thực hiện một chiến lược đều đặn, tại sao vẫn phải mở ví và làm lại cùng một chuỗi thao tác mỗi lần?

Nhưng khi giao công việc cho một hệ thống tự động, câu hỏi tiếp theo còn quan trọng hơn: hệ thống đó được phép làm gì, được dùng bao nhiêu tài sản, và người dùng có thể dừng nó bằng cách nào?

DeFi Recipes được xây dựng để giải quyết đồng thời hai vấn đề đó: giảm thao tác thủ công và làm rõ giới hạn thực thi.

Trong bài hôm nay, tôi sẽ giới thiệu bài toán, hai recipe cốt lõi, cơ chế kiểm soát quyền và một luồng demo DCA. Toàn bộ phần minh họa nằm trên Arc Testnet; đây là dự án cộng đồng độc lập, không phải sản phẩm chính thức của Arc hay Circle.

### Slide 2. Chiến lược đơn giản, thao tác vẫn lặp lại

**Thời gian:** 01:00–02:30.

**Trình chiếu:** Ba nhóm vấn đề: nhớ lịch; thao tác nhiều bước; khó theo dõi và kiểm soát quyền.

**Lời thoại:**

Hãy lấy một ví dụ đơn giản. Một người dùng muốn định kỳ đổi một phần USDC sang EURC. Chiến lược không phức tạp: chọn số tiền, chọn chu kỳ và thực hiện đều đặn.

Tuy vậy, mỗi lần thực hiện, người dùng vẫn phải nhớ lịch, kiểm tra số dư, mở ứng dụng, xem báo giá, kiểm tra mức trượt giá rồi xác nhận giao dịch. Nếu bận hoặc quên, chiến lược bị gián đoạn. Nếu làm vội, họ có thể bỏ qua những thông tin quan trọng.

Với một vị thế sinh lợi, công việc cũng lặp lại: kiểm tra phần thưởng, nhận thưởng và cân nhắc tái đầu tư. Giá trị của chiến lược không chỉ nằm ở việc chọn đúng sản phẩm, mà còn nằm ở khả năng duy trì quy trình qua thời gian.

Cách xử lý quen thuộc là dùng bot. Nhưng một bot không tự nhiên trở nên đáng tin chỉ vì nó chạy tự động. Nếu bot có quá nhiều quyền, hoặc gọi sai hợp đồng, tự động hóa có thể khiến sai sót diễn ra nhanh hơn.

Vì vậy, bài toán của chúng tôi không phải xây một hệ thống được phép làm mọi thứ thay người dùng. Chúng tôi muốn đóng gói các công việc cụ thể thành quy trình có thể cấu hình, có điều kiện kiểm tra và có lịch sử để đối chiếu.

Điểm bắt đầu là những nhu cầu nhỏ nhưng rõ ràng: mua định kỳ và xử lý phần thưởng. Làm tốt các quy trình này trước sẽ có giá trị hơn việc đưa ra quá nhiều chiến lược khi nền tảng thực thi chưa đủ vững.

### Slide 3. Vì sao chọn Arc?

**Thời gian:** 02:30–03:45.

**Trình chiếu:** USDC làm gas; chi phí dễ lập kế hoạch; finality nhanh; tương thích EVM.

**Lời thoại:**

Arc phù hợp với hướng đi này trước hết vì USDC là tài sản trả phí gas. Với một ứng dụng lấy stablecoin làm trung tâm, người dùng không phải chuẩn bị thêm một loại native token khác chỉ để chi trả phí trên Arc.

Điều đó cũng làm cách giải thích sản phẩm đơn giản hơn: ngân sách chiến lược và chi phí thực thi có thể cùng được nhìn bằng USDC. Với các thao tác định kỳ có quy mô nhỏ, khả năng dự đoán chi phí là một yếu tố quan trọng.

Arc có finality nhanh, ở mức dưới một giây theo đặc tính của mạng. Tuy nhiên, thời gian người dùng nhìn thấy một lượt chạy hoàn tất còn phụ thuộc vào RPC, hàng đợi, ví và dịch vụ bên ngoài. Chúng tôi không đồng nhất tốc độ của blockchain với tốc độ toàn bộ ứng dụng.

Một lợi thế khác là khả năng tương thích EVM. Dự án có thể sử dụng Solidity và Foundry cho hợp đồng, Viem và Wagmi cho giao tiếp blockchain, cùng Next.js cho giao diện.

Cần lưu ý thêm: USDC dùng cho gas và USDC qua giao diện ERC-20 trên Arc là hai cách truy cập cùng một tài sản, không phải hai khoản tiền để cộng lại. Trong các cấu hình số tiền của recipe, dự án sử dụng đơn vị ERC-20 với sáu chữ số thập phân.

### Slide 4. Recipe là gì?

**Thời gian:** 03:45–05:00.

**Trình chiếu:** “Hành động + lịch chạy + ngân sách + giới hạn + theo dõi”; hai recipe cốt lõi.

**Lời thoại:**

Trong dự án, một recipe là một quy trình DeFi đã được định nghĩa trước. Người dùng không phải tự viết mã hay ghép từng lời gọi hợp đồng. Họ chọn quy trình phù hợp, cấu hình các tham số và xem lại quyền cần cấp.

Có thể hiểu recipe qua năm câu hỏi: làm việc gì, khi nào làm, dùng bao nhiêu, giới hạn ra sao và xem kết quả ở đâu.

Ví dụ, với DCA, câu trả lời có thể là: đổi USDC sang EURC, mỗi ngày một lần, mỗi lần năm USDC, trong tổng ngân sách năm mươi USDC, với ngưỡng trượt giá đã chọn.

MVP tập trung vào hai recipe: USDC sang EURC định kỳ, và hướng tự động hóa phần thưởng cho vị thế USDC. Việc giới hạn phạm vi này là chủ đích. Mỗi quy trình bổ sung đều kéo theo thêm cách gọi hợp đồng, điều kiện kiểm tra và tình huống lỗi cần xử lý.

Chúng tôi chưa đặt marketplace mở hay trình kéo thả chiến lược vào trọng tâm của MVP. Ưu tiên hiện tại là làm rõ luồng thực thi, quyền hạn và khả năng vận hành.

Giá trị của một recipe vì thế không chỉ là chiếc nút kích hoạt. Đó là việc biến một ý định của người dùng thành một cấu hình mà giao diện, keeper và hợp đồng cùng có thể xử lý.

### Slide 5. DCA USDC sang EURC theo ngân sách

**Thời gian:** 05:00–06:30.

**Trình chiếu:** Tổng ngân sách 50 USDC; mỗi lượt 5 USDC; chu kỳ 24 giờ; tối đa 10 lượt theo ngân sách. Đây là cấu hình minh họa, không phải khuyến nghị đầu tư.

**Lời thoại:**

Recipe đầu tiên tôi muốn đi sâu là DCA từ USDC sang EURC. Người dùng đặt tổng ngân sách và số tiền cho mỗi lần thực hiện, thay vì chỉ đưa ra một lệnh swap riêng lẻ.

Trong ví dụ này, tổng ngân sách là năm mươi USDC, mỗi lần dùng năm USDC. Về mặt ngân sách, cấu hình tương ứng với tối đa mười lượt. Người dùng có thể chọn chu kỳ hằng ngày, hằng tuần hoặc một khoảng giờ phù hợp trong phạm vi giao diện cho phép.

Cách thực thi hiện tại là lấy tiền từ ví theo từng lượt, hay pull-per-run. Nghĩa là ngân sách được cấu hình không đồng nghĩa toàn bộ số tiền đã được chuyển vào hệ thống ngay lúc kích hoạt. Nhưng người dùng vẫn cần cấp allowance phù hợp và duy trì số dư để các lượt tiếp theo có thể chạy.

Khi đến hạn, keeper kiểm tra trạng thái recipe và ngân sách còn lại, lấy phương án swap, rồi kiểm tra các điều kiện cần thiết trước khi gửi giao dịch. Nếu không đủ số dư hoặc không có route phù hợp, lượt chạy có thể bị bỏ qua; lịch đã đến không phải là bảo đảm giao dịch sẽ thành công.

Phần định tuyến có nhiều phương án tích hợp như App Kit, LI.FI và Curve Direct. Route thực tế phụ thuộc cấu hình runtime của keeper. Một lựa chọn xuất hiện trên giao diện chưa đủ để kết luận backend đang dùng chính lựa chọn đó.

Điều chúng tôi muốn mang lại là khả năng thực thi một kế hoạch định kỳ có giới hạn. DCA không bảo đảm lợi nhuận, còn EURC và USDC vẫn là hai tài sản cần được người dùng tự đánh giá theo mục tiêu của mình.

### Slide 6. Auto-Compounder: mục tiêu và hiện trạng

**Thời gian:** 06:30–08:00.

**Trình chiếu:** Hai cột: “Mục tiêu: nhận thưởng → đổi về USDC → tái gửi” và “Nhánh keeper hiện đọc được: kiểm tra reward → claimRewardsForUser”.

**Lời thoại:**

Recipe thứ hai là USDC Yield Auto-Compounder. Theo thiết kế sản phẩm, mục tiêu là tự động nhận phần thưởng, đổi về USDC nếu cần, sau đó tái đầu tư vào vị thế sinh lợi.

Đây là một nhu cầu dễ hiểu: nếu người dùng phải liên tục quay lại xử lý những khoản thưởng nhỏ, thao tác thủ công có thể trở thành chi phí về thời gian và sự chú ý.

Tuy nhiên, tôi muốn phân biệt rõ mục tiêu thiết kế với những gì đã thấy trong mã nguồn hiện tại. Nhánh keeper của Auto-Compounder đang kiểm tra phần thưởng có thể nhận và tạo lời gọi claimRewardsForUser cho hợp đồng lending được cấu hình. Khi không có phần thưởng, keeper bỏ qua lượt xử lý.

Chỉ từ mã keeper này, chúng ta chưa thể khẳng định đầy đủ chuỗi nhận thưởng, swap rồi tái gửi đã được thực hiện. Muốn kết luận về những gì xảy ra bên trong hợp đồng lending đích, cần kiểm tra riêng hợp đồng và giao dịch liên quan.

Vì thế, trong buổi hôm nay, DCA là luồng demo chính. Auto-Compounder được giới thiệu như một hướng nghiệp vụ đã có phần tích hợp xử lý reward, với chuỗi compound hoàn chỉnh cần được xác minh thêm trước khi công bố là hoàn tất.

Tương tự, con số APY trên thẻ recipe không phải cam kết lợi nhuận. Nó đang là dữ liệu khai báo trong giao diện, không phải bằng chứng về mức sinh lời thực tế của người dùng.

Cách tiếp cận của chúng tôi là trình bày đúng mức độ hoàn thiện, để người dùng biết phần nào có thể kiểm tra hôm nay và phần nào còn cần chứng minh thêm.

### Slide 7. Tự động hóa đi kèm giới hạn quyền

**Thời gian:** 08:00–10:00.

**Trình chiếu:** Ví người dùng → keeper → SharedExecutorProxy → protocol; bên cạnh là SessionKeyRegistry và RecipeGuardrail. Đặt “Pause / Revoke” ở phía người dùng.

**Lời thoại:**

Bây giờ là câu hỏi quan trọng nhất: keeper được phép làm gì?

Kiến trúc hiện tại sử dụng ba hợp đồng chính. Hợp đồng đầu tiên là SessionKeyRegistry, lưu thông tin ủy quyền giữa người dùng và địa chỉ session key của keeper. Thông tin này bao gồm thời hạn hiệu lực, trạng thái thu hồi và hạn mức chi tiêu cộng dồn.

Ở đây cần nhấn mạnh chữ cộng dồn. Hạn mức session không phải mặc nhiên là hạn mức riêng cho từng lần swap, và cũng không phải hạn mức độc lập cho từng recipe. Các recipe dùng cùng cặp ví người dùng và keeper có thể cùng sử dụng quota đó.

Hợp đồng thứ hai là RecipeGuardrail. Nó kiểm tra địa chỉ protocol và function selector, tức là hàm nào trên hợp đồng nào được phép gọi. Đây là lớp giới hạn bề mặt thực thi, thay vì cho phép keeper tùy ý gọi mọi địa chỉ.

Hợp đồng thứ ba là SharedExecutorProxy, đầu mối nhận yêu cầu thực thi. Nó kiểm tra session key, trạng thái pause và guardrail trước khi gọi protocol đích. Hợp đồng cũng có cơ chế chống reentrancy và các xử lý liên quan đến dòng token cho một số loại swap.

Người dùng có thể thu hồi session key hoặc pause thực thi của chính mình trên hợp đồng. Cấp quản trị cũng có khả năng pause toàn hệ thống. Đây là những quyền cần được hiểu rõ: mô hình hiện tại vẫn có vai trò quản trị, không phải một hệ thống đã phi tập trung hoàn toàn.

Một điểm khác thường bị bỏ qua là session key và allowance của token không phải cùng một quyền. Thu hồi session key không tự động xóa mọi allowance đã cấp. Khi ngừng sử dụng, người dùng cần xem lại cả hai, nhất là khi có đường approve không giới hạn.

Những cơ chế này giúp đặt ra các lớp kiểm soát, nhưng không có nghĩa là rủi ro đã biến mất. Kiểm tra địa chỉ và selector không tự chứng minh toàn bộ tham số giao dịch đều an toàn. Với swap, bảo vệ đầu ra còn phụ thuộc vào calldata, adapter và protocol thực thi.

Chúng tôi không xem các báo cáo rà soát trong repository là chứng nhận kiểm toán độc lập. Điểm muốn nhấn mạnh là quyền phải có ranh giới có thể kiểm tra, và những ranh giới đó vẫn cần tiếp tục được kiểm thử, đánh giá.

### Slide 8. Keeper biến lịch chạy thành giao dịch như thế nào?

**Thời gian:** 10:00–11:00.

**Trình chiếu:** Đến hạn → kiểm tra → resolve route → eth_call → hàng đợi → gửi → xác nhận → nhật ký.

**Lời thoại:**

Keeper là dịch vụ chạy ngoài blockchain, đảm nhiệm việc theo dõi các recipe đang hoạt động và đánh giá lúc nào cần xử lý.

Thông tin recipe được lưu trong PostgreSQL. Khi đến hạn, keeper kiểm tra điều kiện, chuẩn bị dữ liệu giao dịch và dùng eth_call để mô phỏng lời gọi thực thi trước khi phát giao dịch. Đây là kiểm tra trên trạng thái blockchain tại thời điểm gọi, không phải dự đoán giá hay bảo đảm kết quả trong tương lai.

Phần xử lý có cơ chế hàng đợi, hỗ trợ BullMQ với Redis theo cấu hình, cùng các luồng gửi và xác nhận giao dịch. Khi RPC gặp giới hạn tần suất hoặc lỗi tạm thời, mã có các cơ chế retry, backoff và chuyển endpoint.

Sau khi gửi, hệ thống cần phân biệt trạng thái đã phát giao dịch với trạng thái đã được xác nhận. Nhật ký và mã giao dịch giúp người dùng đối chiếu lại trên explorer.

Tự động hóa hữu ích không chỉ ở lúc chạy thành công. Nó còn phải giúp chúng ta hiểu vì sao một lượt chưa chạy, đang chờ hay đã thất bại.

### Slide 9. Demo DCA: cấu hình, cấp quyền và theo dõi

**Thời gian:** 11:00–15:00. Khoảng 2 phút lời dẫn, phần còn lại dành cho thao tác, chuyển màn hình và xác nhận ví. Không chờ đủ 10 lượt DCA trong buổi trình bày.

**Trình chiếu:** Chuyển sang ứng dụng; chuẩn bị sẵn một recipe và một giao dịch lịch sử đã xác minh để đối chiếu.

#### 11:00–11:35. Kết nối và chọn recipe

**Thao tác:** Mở dashboard, kết nối ví demo, kiểm tra Arc Testnet, chọn recipe USDC → EURC Recurring DCA qua nút `Simulate & Activate` hoặc nhãn tương ứng của bản đang chạy.

**Lời thoại:**

Bây giờ tôi sẽ đi qua luồng cấu hình một recipe DCA. Đây là ví demo trên Arc Testnet, không dùng tài sản mainnet.

Tôi chọn recipe USDC sang EURC. Màn hình này giúp xem lại tham số và quyền trước khi kích hoạt. Tên Simulation ở đây không có nghĩa mọi con số hiển thị đều vừa được mô phỏng on-chain; phần eth_call thực sự nằm trong luồng kiểm tra của keeper.

#### 11:35–12:20. Đặt ngân sách và giới hạn

**Thao tác:** Nhập tổng ngân sách `50`, mỗi lượt `5`, chọn `Daily: 24 hours`, đặt session spending limit `50` cho ví demo riêng, và chọn mức slippage đã kiểm chứng trước buổi nói. `0.5%` là ví dụ, không bắt buộc dùng khi route không đáp ứng. Không chọn provider chỉ vì nhãn “Recommended”; đối chiếu cấu hình backend trước.

**Lời thoại:**

Ở đây tôi đặt tổng ngân sách năm mươi USDC và mỗi lượt năm USDC. Giao diện tính ra mười lượt theo ngân sách. Tôi chọn chu kỳ hằng ngày, nhưng không cần chờ một ngày để chứng minh toàn bộ luồng trong buổi hôm nay.

Hạn mức session là một cấu hình khác với ngân sách recipe. Trong ví dụ dùng ví riêng này, tôi đặt cùng mức năm mươi USDC để dễ theo dõi. Nếu ví có nhiều recipe dùng chung keeper, cần cân nhắc quota chung trước khi thay đổi.

#### 12:20–13:20. Kiểm tra allowance và cấp quyền

**Thao tác:** Xem kết quả `Runtime Allowance Precheck`, địa chỉ spender, allowance cần thiết và trạng thái session key. Chỉ ký sau khi xác minh đúng chain, địa chỉ và số tiền. Nếu ví hiện allowance vô hạn hoặc thời hạn khác dự kiến, giải thích rõ; không mô tả đó là quyền chỉ giới hạn ở 50 USDC. Có thể dùng ví đã cấp quyền trước và chỉ trình bày phần review để tránh gián đoạn.

**Lời thoại:**

Bước tiếp theo là xem token sẽ được cấp quyền cho địa chỉ nào và keeper đã có session hợp lệ hay chưa.

Hai quyền này khác nhau. Allowance cho phép một spender sử dụng token; session key là quyền được executor kiểm tra khi keeper thực thi. Mức năm mươi USDC của session không có nghĩa mọi allowance token cũng bị giới hạn ở đúng mức đó.

Lần kích hoạt đầu có thể cần nhiều xác nhận ví, chứ không phải luôn chỉ một giao dịch. Tôi sẽ kiểm tra từng yêu cầu trước khi ký, thay vì coi nút Activate là lý do để chấp nhận mọi quyền.

#### 13:20–14:15. Kích hoạt và xem trạng thái

**Thao tác:** Xác nhận kích hoạt trên bản demo đã chuẩn bị. Mở phần recipe đang hoạt động, trạng thái delegation và lịch sử thực thi. Nếu giao dịch mới chưa xác nhận, chỉ gọi nó là pending/submitted.

**Lời thoại:**

Sau khi cấu hình được đồng bộ, chúng ta có thể theo dõi recipe trên dashboard. Cần phân biệt ba điều: recipe đã được đăng ký, delegation đã xác nhận, và một lượt swap đã thực hiện thành công. Chúng không phải cùng một sự kiện.

Nếu trạng thái còn pending, tôi sẽ không gọi đó là đã hoàn tất. Trên testnet, thời gian phản hồi còn phụ thuộc RPC và các thành phần bên ngoài.

#### 14:15–15:00. Đối chiếu bằng chứng và quyền dừng

**Thao tác:** Mở transaction hash của một lượt DCA đã xác minh trước trên ArcScan; nêu rõ nếu đó là lịch sử. Chỉ ra ví liên quan, trạng thái receipt và token transfer tương ứng. Chỉ vị trí pause/revoke và giải thích phạm vi; không thu hồi session chung của ví đang dùng cho mục đích khác.

**Lời thoại:**

Đây là một lượt chạy đã được chuẩn bị và xác minh từ trước để chúng ta đối chiếu, không phải kết quả tôi mặc định gán cho giao dịch vừa tạo. Transaction hash giúp kiểm tra trạng thái và dòng token trên explorer.

Cuối cùng, người dùng có các cách dừng hoạt động hoặc thu hồi quyền. Pause một recipe trong ứng dụng khác với thu hồi session key dùng chung; khi ngừng hẳn, cần xem lại cả allowance token.

Điều tôi muốn mọi người thấy là cả vòng đời: cấu hình, cấp quyền, theo dõi và dừng, chứ không chỉ một màn hình báo thành công.

### Slide 10. Những công cụ USDC bổ trợ

**Thời gian:** 15:00–16:00.

**Trình chiếu:** Bốn tên màn hình: Swap, Send, Bridge, Unified Balance. Không thực hiện thêm giao dịch nếu cần giữ đúng giờ.

**Lời thoại:**

Bên cạnh recipe, giao diện hiện còn có các công cụ thao tác với USDC.

Swap cung cấp luồng lấy báo giá và đổi USDC, EURC qua App Kit. Send gửi USDC trên Arc Testnet. Bridge có luồng chuyển USDC giữa các testnet được cấu hình, theo các bước như approve, burn, lấy attestation và mint.

Unified Balance có các màn hình xem số dư, nạp và chi tiêu qua tích hợp App Kit. Đây là hướng giúp người dùng làm việc với USDC giữa nhiều mạng trong cùng trải nghiệm.

Tuy nhiên, có giao diện và lời gọi SDK không đồng nghĩa mọi luồng đã được xác minh đầu cuối. Ở keeper, các module Unified Balance và Gateway còn có feature flag, mặc định tắt nếu không được bật qua cấu hình.

Vì vậy, tôi xem đây là các công cụ bổ trợ đã có mã tích hợp, không phải tuyên bố rằng recipe hiện tại đã tự động sử dụng ngân sách xuyên chuỗi. Trọng tâm demo hôm nay vẫn là luồng DCA trên Arc Testnet.

### Slide 11. Mức độ hoàn thiện và hướng phát triển

**Thời gian:** 16:00–17:00.

**Trình chiếu:** “Đã có trong mã” và “Cần tiếp tục xác minh, hoàn thiện”; không dùng số người dùng, TVL hay uptime nếu chưa có dữ liệu.

**Lời thoại:**

Đến hiện tại, repository đã có giao diện cấu hình recipe, API đồng bộ, scheduler, mô phỏng eth_call, xử lý hàng đợi, nhật ký và ba hợp đồng thực thi cốt lõi.

Các tệp kiểm thử bao phủ nhiều tình huống như cấu hình DCA, route swap, session quota, scheduler và lỗi HTTP. Báo cáo nội bộ ngày sáu tháng mười ghi nhận chín mươi tư trên chín mươi tư bài kiểm thử keeper đạt tại thời điểm đó. Đây là kết quả lịch sử, không phải lần chạy kiểm thử mới trong buổi chuẩn bị này.

Ưu tiên tiếp theo là xác minh đầu cuối từng route, làm rõ hơn quyền người dùng cấp và hoàn thiện chuỗi Auto-Compounder theo đúng đặc tả. Việc tăng độ bền vận hành và đánh giá bảo mật độc lập cũng quan trọng trước khi mở rộng sử dụng.

Sau nền tảng đó mới là các hướng như nhiều keeper hơn, công cụ tạo recipe và marketplace. Chúng tôi muốn mở rộng từ một lõi đã được chứng minh, thay vì để danh sách tính năng đi trước khả năng kiểm soát và vận hành.

### Slide 12. Tổng kết và lời mời trải nghiệm

**Thời gian:** 17:00–18:00.

**Trình chiếu:** Ba ý: giảm thao tác; giới hạn quyền; đối chiếu kết quả. Kết thúc bằng tên dự án và lời mời thử nghiệm trên testnet.

**Lời thoại:**

Tôi muốn kết lại bằng ba điểm.

Thứ nhất, DeFi Recipes hướng đến một công việc rất cụ thể: giúp người dùng duy trì những thao tác DeFi lặp lại mà không phải thực hiện lại bằng tay ở mỗi chu kỳ.

Thứ hai, tự động hóa phải đi cùng quyền có giới hạn. Session key, quota, whitelist, pause và revoke là những thành phần để người dùng có thể hiểu và kiểm soát hoạt động của hệ thống.

Thứ ba, kết quả cần có bằng chứng để đối chiếu. Trạng thái trên giao diện, nhật ký keeper và giao dịch trên explorer phải được đọc cùng nhau, thay vì chỉ dựa vào một thông báo thành công.

Arc tạo một nền tảng phù hợp cho hướng đi USDC-first này. Phần chúng tôi đang xây dựng là lớp quy trình ở phía trên, để biến ý định của người dùng thành những lượt thực thi có thể kiểm tra.

Chúng tôi mong nhận được phản hồi từ người dùng thử, nhà phát triển và các protocol trong hệ sinh thái: thao tác nào đang tốn thời gian, quyền nào còn khó hiểu, và bằng chứng nào cần hiển thị rõ hơn.

Cảm ơn mọi người đã theo dõi. Tôi xin chuyển sang phần câu hỏi và trao đổi.

## 4. Điều chỉnh thành 15 hoặc 20 phút

### Bản 15 phút

Giữ nguyên thông điệp và phần lưu ý an toàn, rút đúng 3 phút từ bản chuẩn:

| Phần | Thời lượng mới | Cách rút |
| --- | --- | --- |
| Slide 2 | 1:00 | Bỏ ví dụ vị thế sinh lợi; giữ ví dụ DCA và rủi ro bot quá quyền |
| Slide 3 | 1:00 | Rút phần công nghệ; giữ USDC gas và lưu ý độ trễ ứng dụng |
| Slide 6 | 0:45 | Nói mục tiêu, nhánh claim hiện có và lý do chưa tuyên bố compound hoàn chỉnh |
| Slide 7 | 1:30 | Mỗi hợp đồng một ý; giữ phân biệt session key với allowance |
| Slide 9 | 3:00 | Dùng ví đã chuẩn bị quyền; review cấu hình rồi mở lịch sử đã xác minh |

Các slide khác giữ nguyên. Tổng thời gian: 15 phút. Không đọc toàn bộ lời thoại bản 18 phút với tốc độ nhanh hơn để ép giờ.

### Bản 20 phút

Giữ bản chuẩn 18 phút và dành 2 phút cuối cho một hoặc hai câu hỏi. Nếu chương trình yêu cầu 20 phút trình bày liên tục, dùng 2 phút này để giải thích một giao dịch DCA lịch sử: receipt, địa chỉ gọi, token transfer, trạng thái trong nhật ký và điểm khác nhau giữa allowance với quota session. Không thêm một live bridge chưa được diễn tập.

Không cộng thêm video giới thiệu hơn 3 phút từ kịch bản cũ vào bản chuẩn. Nếu dùng video, phải thay thế phần tương ứng và bấm giờ lại.

## 5. Chuẩn bị demo và phương án dự phòng

### Trước buổi trình bày

- Dùng ví testnet riêng, có đủ USDC thử nghiệm cho số tiền demo và gas. Không hiển thị seed phrase, private key, token API hay nội dung tệp môi trường.
- Xác minh đúng chain `5042002`, địa chỉ hợp đồng đang được frontend và keeper sử dụng, session key thực tế và cấu hình provider runtime. Không mặc định các địa chỉ trong tài liệu cũ còn là deployment đang chạy.
- Chạy thử trọn luồng DCA với đúng cấu hình sẽ trình bày. Xác minh recipient và token transfer của route được chọn, không chỉ nhìn receipt thành công.
- Chuẩn bị một recipe đang hoạt động và một transaction hash DCA thành công đã kiểm tra. Mở sẵn explorer và lịch sử ở tab riêng; có thể chuẩn bị ảnh hoặc video dự phòng từ chính phiên test đó.
- Kiểm tra allowance hiện có và các yêu cầu approve. Trong modal hiện có đường approve `maxUint256`; không mô tả mọi approval là chỉ đúng ngân sách. Khi có quyền vô hạn, nêu rõ và cân nhắc chuẩn bị allowance hữu hạn trước bằng công cụ ví phù hợp.
- Kiểm tra thời hạn session thực tế. Modal có đường đăng ký 365 ngày, còn luồng kích hoạt trang chính dùng mặc định 30 ngày; không hứa một thời hạn thống nhất khi chưa đối chiếu luồng đang chạy.
- Không gia hạn hoặc revoke trên ví dùng chung mà chưa hiểu ảnh hưởng. Đăng ký lại cùng cặp user–keeper đặt lại bộ đếm quota; thu hồi session ảnh hưởng các recipe dùng chung session đó.
- Kiểm tra ngôn ngữ UI trước buổi nói. Không cần sửa giao diện để dùng kịch bản tiếng Việt; đọc và chỉ đúng nhãn của bản đang mở.
- Bấm giờ một lượt. Giới hạn chờ lỗi ở khoảng 20–30 giây rồi chuyển phương án dự phòng, thay vì để phần demo chiếm hết thời gian.

### Khi demo không diễn ra như dự kiến

| Tình huống | Cách xử lý | Lời dẫn gợi ý |
| --- | --- | --- |
| RPC chậm, ví chưa phản hồi | Dừng thao tác lặp, chuyển sang lịch sử đã xác minh | “Giao dịch hiện chưa được xác nhận. Tôi sẽ dùng lượt chạy trước để giải thích cách đối chiếu, không coi đây là kết quả của thao tác vừa làm.” |
| Không lấy được route | Giữ nguyên giới hạn, không tăng slippage chỉ để demo thành công | “Route hiện chưa đáp ứng điều kiện. Chúng ta sẽ xem phiên chạy đã kiểm chứng thay vì ép giao dịch bằng cách nới giới hạn.” |
| Allowance hoặc session chưa đủ | Chỉ giải thích điều kiện thiếu; không ký mù | “Cấu hình đã có nhưng quyền thực thi chưa sẵn sàng. Đây là hai trạng thái khác nhau.” |
| Không có reward Auto-Compounder | Giải thích keeper bỏ qua; không tạo kỳ vọng có thưởng tức thì | “Không có reward khả dụng thì nhánh này chưa có công việc để thực hiện.” |
| Chưa có hash hoặc bằng chứng hợp lệ | Dừng ở walkthrough cấu hình | “Phần này minh họa luồng cấu hình; tôi chưa dùng nó làm bằng chứng giao dịch đã thành công.” |

## 6. Câu hỏi thường gặp

**Dự án có giữ private key của người dùng không?**

Luồng ví hiện tại không yêu cầu người dùng giao private key cho keeper. Keeper có key riêng và dùng quyền đã đăng ký. Tuy vậy, người dùng vẫn có rủi ro từ hợp đồng, allowance, quyền quản trị và protocol đích; “phi lưu ký” không có nghĩa là không có rủi ro.

**Thu hồi session key có xóa allowance USDC không?**

Không. Đây là hai cơ chế khác nhau. Nếu muốn chấm dứt quyền token, cần kiểm tra và thu hồi allowance tương ứng. Pause một recipe ở backend cũng không đồng nghĩa đã thu hồi toàn bộ quyền on-chain.

**Có lợi nhuận hay APY được bảo đảm không?**

Không. DCA là cách thực thi theo lịch, không bảo đảm lời. Con số `8.4%` trên catalog hiện là giá trị khai báo trong mã, không phải cam kết hoặc số liệu lợi nhuận được xác minh.

**Dự án đã được audit độc lập chưa?**

Trong nguồn đã quét có tài liệu mang tên audit và các báo cáo rà soát nội bộ, nhưng không đủ bằng chứng để tuyên bố đã có chứng nhận kiểm toán độc lập. Không dùng từ “đã audit” như một bảo chứng an toàn.

**Có miễn phí hoàn toàn không?**

Không nên khẳng định như vậy. Cần tách gas cho thao tác người dùng, gas keeper, phí protocol và phí ứng dụng theo cấu hình. Mã Swap có hỗ trợ custom fee; tài liệu MVP về tài trợ gas không chứng minh mọi thao tác đều miễn phí.

**Chọn provider trên UI có chắc keeper dùng provider đó không?**

Không thể suy ra chỉ từ UI. Scheduler dùng route client theo cấu hình runtime; cần đối chiếu cấu hình và giao dịch thực tế trước khi mô tả provider đang hoạt động.

**Unified Balance đã tự cấp ngân sách cho recipe xuyên chuỗi chưa?**

Có giao diện tích hợp và module readiness trong keeper, nhưng không đủ bằng chứng trong nguồn đã đọc để khẳng định một luồng recipe xuyên chuỗi hoàn chỉnh đang hoạt động. Feature flag của keeper và thao tác App Kit trực tiếp ở frontend là hai phần riêng.

**Nếu keeper ngừng chạy thì sao?**

Lượt tự động hóa có thể bị chậm hoặc không được kích hoạt. Cơ chế retry và failover RPC không thay thế khả năng sẵn sàng của dịch vụ keeper. Mạng keeper phân tán là hướng phát triển, không phải hiện trạng đã chứng minh.

## 7. Cơ sở đối chiếu và giới hạn phát biểu

### Phạm vi đã quét

Đã lập danh mục và quét nội dung các tệp văn bản thuộc cả bốn thư mục được chọn; sau đó đọc sâu các đường thực thi và tài liệu quyết định nội dung bài nói. Loại dependency trong `node_modules` và tệp nhị phân khỏi dữ liệu nghiệp vụ. “Quét toàn bộ” ở đây là rà nội dung phục vụ thuyết trình, không phải kiểm toán bảo mật từng dòng.

Thống kê trước khi thêm tài liệu này:

| Thư mục | Số tệp văn bản | Số dòng đọc/quét |
| --- | ---: | ---: |
| Tài liệu dự án và nguồn slide trong thư mục docs | 28 | 3.721 |
| Mã nguồn frontend | 35 | 7.470 |
| Mã nguồn keeper, gồm kiểm thử và benchmark | 42 | 10.697 |
| Mã nguồn hợp đồng | 4 | 694 |
| **Tổng** | **109** | **22.582** |

Phạm vi yêu cầu không bao gồm đọc sâu thư mục docs-site, deployment, migrations, hợp đồng import hoặc kiểm thử Foundry ngoài bốn thư mục được chọn. Không xác minh deployment hoặc trạng thái dịch vụ trực tiếp.

### Nguồn chính cho từng nhóm nội dung

| Nhóm | Nguồn đối chiếu | Cách sử dụng trong bài |
| --- | --- | --- |
| Định vị, phạm vi MVP, roadmap | [Tầm nhìn dự án](../project-vision.md), [Đặc tả tính năng](../features-spec.md), [Đề xuất kiến trúc](../architecture-proposal.md), [Tech stack](../tech-stack.md) | Lấy mục tiêu; không coi đặc tả là bằng chứng đã triển khai |
| Danh mục hai recipe và số liệu UI | [RecipeCatalog](../../web/src/components/RecipeCatalog.tsx) | Giữ đúng tên recipe; không dùng APY, phí khai báo làm số đo thực tế |
| Cấu hình, approval và session trên UI | [SimulationModal](../../web/src/components/SimulationModal.tsx), [Trang dashboard](../../web/src/app/page.tsx) | Xác định trường demo, nhiều bước ký, quota chung và khác biệt thời hạn session |
| Theo dõi và API frontend | [PortfolioTracker](../../web/src/components/PortfolioTracker.tsx), [API recipes](../../web/src/app/api/recipes/route.ts), [API logs](../../web/src/app/api/logs/route.ts) | Mô tả đăng ký, trạng thái và lịch sử; không đồng nhất trạng thái UI với receipt |
| Lịch chạy và DCA | [Cron scheduler](../../keeper/src/schedulers/cronScheduler.ts), [DCA state](../../keeper/src/domain/dcaConfig.ts), [Route client](../../keeper/src/integrations/circle/dcaSwapRouteClient.ts), [Cấu hình routing](../../keeper/src/config/dcaRouting.ts) | Lấy điều kiện ngân sách, số dư, route runtime và xử lý bỏ qua |
| Auto-Compounder thực tế | [Cron scheduler](../../keeper/src/schedulers/cronScheduler.ts), [Recipe payloads](../../keeper/src/simulation/recipePayloads.ts) | Chỉ xác nhận kiểm tra reward và tạo lời gọi claim; không suy diễn logic bên trong lending |
| Mô phỏng và hàng đợi | [Static simulation engine](../../keeper/src/simulation/staticSimulationEngine.ts), [Queue scheduler](../../keeper/src/schedulers/queueScheduler.ts), [Keeper entrypoint](../../keeper/src/index.ts) | Mô tả eth_call, gửi/xác nhận, retry và endpoints theo mã |
| Lưu trữ và quan sát | [Recipe repository](../../keeper/src/db/repositories/recipesRepository.ts), [Execution logs](../../keeper/src/db/repositories/executionLogsRepository.ts), [Metrics](../../keeper/src/observability/metrics.ts), [Alert monitor](../../keeper/src/observability/monitorAlerts.ts) | Mô tả cấu phần vận hành; không công bố uptime hay thông lượng chưa đo |
| Quyền và guardrail on-chain | [SessionKeyRegistry](../../contracts/src/SessionKeyRegistry.sol), [RecipeGuardrail](../../contracts/src/RecipeGuardrail.sol), [SharedExecutorProxy](../../contracts/src/SharedExecutorProxy.sol) | Hạn mức cộng dồn, whitelist, pause, revoke và giới hạn của mô hình |
| Công cụ bổ trợ | [SwapPanel](../../web/src/components/SwapPanel.tsx), [Swap client](../../web/src/lib/appkit/swap-client.ts), [SendPanel](../../web/src/components/SendPanel.tsx), [BridgePanel](../../web/src/components/BridgePanel.tsx), [UnifiedBalancePanel](../../web/src/components/UnifiedBalancePanel.tsx) | Chỉ mô tả giao diện và lời gọi tích hợp; không tuyên bố E2E đã được chạy lại |
| Readiness xuyên chuỗi ở keeper | [Tài liệu readiness](../unified-balance-gateway-readiness.md), [Runtime config](../../keeper/src/config/runtime.ts), [Circle providers](../../keeper/src/integrations/circle/providers.ts), [Feature flags](../../keeper/src/integrations/circle/featureFlags.ts) | Phân biệt frontend trực tiếp và backend có cờ bật/tắt |
| Kết quả kiểm tra lịch sử | [Báo cáo 06/10](../audit-report-2026-10-06.md), [Báo cáo 05/10](../audit-report-2026-10-05.md), [Báo cáo bảo mật 03/10](../security-audit-2026-10-03.md), [Báo cáo hiệu năng 02/08](../performance-optimization-report-2026-08-02.md) | Số kiểm thử chỉ nêu kèm thời điểm; không dùng benchmark cũ làm SLO hoặc chứng nhận |
| Tư liệu thuyết trình trước | [Mã tạo deck](generate-demo-deck.js), [Lời mở đầu cũ](script-speak.txt), [Phụ đề Office Hours](ARC%20OFFICE%20HOURS%20DeFi%20Recipes.srt) | Tham khảo mạch demo; không sao chép các lời hứa “dưới 2 phút” hoặc cộng thêm video ngoài thời lượng |

Các tài liệu quy chuẩn review, coding, naming, chất lượng và UI/UX đã được quét để hiểu định hướng kỹ thuật, nhưng không cần đọc các quy chuẩn đó thành nội dung thuyết trình. Hợp đồng Counter là mã ví dụ, không đưa vào kiến trúc nghiệp vụ ba hợp đồng.

### Những phát biểu không dùng

- “An toàn tuyệt đối”, “không thể mất tài sản” hoặc “bot không thể làm sai tham số”.
- “Đã được kiểm toán độc lập”, khi chỉ có báo cáo rà soát trong repository.
- “APY 8,4% được bảo đảm”, “mọi giao dịch miễn phí” hoặc “luôn hoàn tất dưới một giây”.
- “Auto-Compounder đã hoàn tất chuỗi claim → swap → tái gửi”, khi chưa kiểm chứng protocol đích và giao dịch.
- “Bấm một lần chỉ ký một giao dịch”, “approve luôn hữu hạn” hoặc “revoke session sẽ xóa allowance”.
- “Tất cả các provider trên UI đều hoạt động”, “Unified Balance đã tự cấp vốn cho recipe xuyên chuỗi”.
- Các số liệu TVL, người dùng, doanh thu, tổng lượt chạy hay tỷ lệ thành công không có bằng chứng trong nguồn đã kiểm tra.