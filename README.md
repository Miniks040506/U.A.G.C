# U.A.G.C

**Universal Agent Gateway Connectivity**

Để ứng dụng AI lập kế hoạch, giao phần thực hiện cho agent lập trình và trả thay đổi về để bạn duyệt.

[![Version](https://img.shields.io/badge/version-0.2.2-blue)](CHANGELOG.md)
[![Tests](https://github.com/Miniks040506/U.A.G.C/actions/workflows/test.yml/badge.svg)](https://github.com/Miniks040506/U.A.G.C/actions/workflows/test.yml)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Tải ZIP](https://github.com/Miniks040506/U.A.G.C/archive/refs/heads/main.zip) · [Bắt đầu từng bước](docs/GETTING_STARTED.md) · [Cấu hình nâng cao](docs/TECHNICAL.md) · [Thay đổi phiên bản](CHANGELOG.md)

## UAGC giúp bạn làm gì?

Bạn mô tả yêu cầu trong ứng dụng AI. UAGC chuyển công việc cho một agent lập trình, giữ thay đổi trong bản làm việc riêng và trả kết quả để bạn xem trước khi áp dụng.

- **Giao việc rõ ràng:** sửa lỗi, thêm chức năng hoặc review code theo yêu cầu.
- **Xem trước thay đổi:** đọc báo cáo và phần code được sửa trước khi đưa về dự án.
- **Yêu cầu sửa tiếp:** tiếp tục phiên làm việc với những agent hỗ trợ ACP.

UAGC chạy trên máy bạn và cần một ứng dụng hỗ trợ MCP, chẳng hạn Claude Desktop. Không có giao diện chat riêng; tài khoản AI và agent thực hiện công việc được cấu hình riêng.

## Bắt đầu

### 1. Chuẩn bị

Cài [Node.js](https://nodejs.org/) **22.13 trở lên**, [Git](https://git-scm.com/downloads) và ứng dụng AI hỗ trợ MCP cục bộ. Đóng/mở lại terminal sau khi cài.

### 2. Tải UAGC

Chọn **[Tải ZIP](https://github.com/Miniks040506/U.A.G.C/archive/refs/heads/main.zip)**, giải nén và mở terminal trong thư mục chứa file `package.json`. ZIP là mã nguồn từ nhánh `main`; bản hiện tại chưa có bộ cài `.exe` hay trình cấu hình tự động.

Hoặc tải bằng Git:

```powershell
git clone https://github.com/Miniks040506/U.A.G.C.git
cd U.A.G.C
```

Cài các thành phần cần thiết và kiểm tra:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
```

macOS/Linux dùng `npm` thay cho `npm.cmd`. Bộ test dùng worker cục bộ, không gọi model trả phí.

### 3. Kết nối ứng dụng AI

Làm theo [hướng dẫn cấu hình từng bước](docs/GETTING_STARTED.md): tạo file cấu hình, thêm UAGC vào Claude Desktop và chạy thử trên dự án mẫu. Hướng dẫn có đầy đủ nội dung để sao chép, đường dẫn cần thay và kết quả mong đợi.

Bạn có thể thử kết nối bằng worker demo trước, chưa cần cài agent AI. Khi chuyển sang AI thật, chọn agent đã cài và đăng nhập theo [hướng dẫn này](docs/GETTING_STARTED.md#dùng-agent-ai-thật).

### 4. Giao công việc

Sau khi kết nối và cấu hình agent, bạn có thể nhắn:

> Dùng UAGC với runtime tôi đã cấu hình để sửa lỗi trong dự án D:/repos/my-app. Hãy lập kế hoạch, làm việc trong worktree riêng, kiểm tra kết quả và trình bày thay đổi để tôi duyệt trước khi apply. Không commit hoặc push.

Ứng dụng AI hỗ trợ MCP có thể gọi các công cụ UAGC giúp bạn. Nếu ứng dụng chỉ trả lời bằng văn bản, yêu cầu gọi tool và kiểm tra có job ID thật. Xem [ví dụ giao việc, sửa tiếp và duyệt từng bước](docs/GETTING_STARTED.md#ví-dụ-giao-việc-từng-bước).

## Trước khi dùng với dự án thật

- Dự án cần có lịch sử Git và không có thay đổi chưa lưu thành commit. Đừng đổi nhánh hoặc tạo commit mới trong lúc chờ kết quả.
- Chỉ cấp quyền ghi cho agent bạn tin tưởng. Bản làm việc riêng không phải môi trường cách ly toàn bộ máy tính.
- Xem lại code và kết quả kiểm tra trước khi chấp thuận áp dụng. UAGC không tự commit/push; việc chờ bạn duyệt do ứng dụng AI quản lý.
- Nếu công việc lỗi hoặc bị hủy, đọc phần thay đổi còn lại trước khi dọn bản làm việc.

**Trạng thái:** v0.2.2, bản thử nghiệm cho sử dụng có giám sát. Chưa đo mức tiết kiệm token hoặc xác minh việc tự giao việc từ prompt tiếng Việt/Anh với model thật. Luồng MCP/ACP đã được kiểm thử bằng worker cục bộ; danh sách agent có sẵn chưa đồng nghĩa mọi agent/model đã được xác minh thực tế.

## Cần trợ giúp?

| Bạn gặp gì? | Xem ở đâu? |
| --- | --- |
| Chưa biết tải hoặc cấu hình | [Hướng dẫn bắt đầu](docs/GETTING_STARTED.md) |
| Không thấy UAGC, không chạy được agent | [Xử lý lỗi thường gặp](docs/GETTING_STARTED.md#xử-lý-lỗi-thường-gặp) |
| Muốn chọn model, provider hoặc runtime riêng | [Tài liệu kỹ thuật](docs/TECHNICAL.md) |
| Muốn cập nhật hoặc gỡ UAGC | [Cập nhật và gỡ cài đặt](docs/GETTING_STARTED.md#cập-nhật-và-gỡ-cài-đặt) |
| Muốn biết đã kiểm thử những gì | [Phạm vi kiểm chứng](docs/VERIFICATION.md) |

Phát triển từ Universal Agent MCP v0.2.0. Phát hành theo [MIT License](LICENSE).
