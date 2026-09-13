> Hãy fix vulnerabilities trong project Node.js này theo cách an toàn và tối ưu.
>
> Mục tiêu:
> - Kiểm tra toàn bộ dependency đang có lỗ hổng qua `npm audit`
> - Ưu tiên `npm audit fix` trước để cập nhật các bản vá không phá vỡ
> - Chỉ dùng `npm audit fix --force` nếu bắt buộc và có xác nhận rằng breaking change là chấp nhận được
> - Không bỏ qua build/test/lint sau khi cập nhật
>
> Thực hiện theo thứ tự:
> 1. Xác định project đang dùng npm và danh sách package có vulnerability
> 2. Phân tích `package.json` và `package-lock.json`
> 3. Cập nhật dependency theo nguyên tắc:
>    - ưu tiên version patch/minor an toàn
>    - không tự ý nâng major nếu không cần
>    - nếu cần nâng major, giải thích rõ lý do và tác động
> 4. Chạy lệnh:
>    - `npm audit fix`
>    - nếu không giải quyết được hết thì `npm audit fix --force` chỉ khi cần thiết
>    - `npm install` hoặc `npm update` nếu lockfile chưa được cập nhật
> 5. Verify bằng:
>    - `npm run build`
>    - `npm test` nếu có
>    - `npm run lint` nếu có
> 6. Báo cáo rõ:
>    - dependency nào đã được cập nhật
>    - vulnerability còn lại còn nguyên hay đã được giảm
>    - có breaking change hay không
>    - file nào đã thay đổi
>    - trạng thái build/test cuối cùng
>
> Nếu có lỗi sau update, hãy sửa triệt để và không dừng ở mức “có vẻ ổn”.