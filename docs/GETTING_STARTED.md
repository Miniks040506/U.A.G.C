# Bắt đầu với UAGC

[← README](../README.md)

Hướng dẫn này đi từ tải xuống đến lần chạy đầu tiên. Ví dụ dùng **Windows + Claude Desktop**, với UAGC đặt tại `C:\tools\U.A.G.C`. Nếu bạn chọn thư mục khác, thay đường dẫn tương ứng trong các đoạn bên dưới.

## 1. Chuẩn bị và tải xuống

1. Cài [Node.js](https://nodejs.org/) 22.13 trở lên và [Git](https://git-scm.com/downloads).
2. Cài, mở và đăng nhập [Claude Desktop](https://claude.ai/download). Cần ứng dụng desktop hỗ trợ MCP cục bộ; chỉ mở website chat chưa đủ cho cách cấu hình này.
3. Trên [repo UAGC](https://github.com/Miniks040506/U.A.G.C), chọn **Code → Download ZIP**, giải nén. Đặt thư mục có `package.json` tại `C:\tools\U.A.G.C`. Nếu GitHub báo 404, kiểm tra bạn đã đăng nhập tài khoản có quyền vào repo riêng tư.
4. Mở PowerShell từ Start và chạy lần lượt:

```powershell
Set-Location 'C:\tools\U.A.G.C'
node --version
git --version
npm.cmd ci --ignore-scripts
npm.cmd test
```

Hai lệnh version cần hiện số phiên bản. Lệnh cuối cần báo `fail 0`. Không cần tự chạy `npm start` khi dùng Claude Desktop; ứng dụng sẽ mở UAGC giúp bạn.

**macOS/Linux:** dùng Terminal, thay đường dẫn Windows bằng đường dẫn tuyệt đối trên máy và dùng `npm` thay cho `npm.cmd`. Có thể lấy đường dẫn Node bằng `command -v node`.

## 2. Tạo cấu hình chạy thử

Bước này dùng worker demo đi kèm UAGC. Nó tạo một file cố định để kiểm tra kết nối, **không dùng AI và không gọi model trả phí**. Ứng dụng chat chủ vẫn có hạn mức riêng.

Trong PowerShell, lấy đường dẫn Node:

```powershell
(Get-Command node).Source
```

Dùng Notepad tạo file `C:\tools\U.A.G.C\agents.local.json`, chọn **Save as type: All files**, encoding UTF-8, để tên không bị thành `.json.txt`. Dán nội dung:

```json
{
  "stateDir": "C:/tools/uagc-state-desktop",
  "runtimes": {
    "demo": {
      "kind": "cli",
      "argv": [
        "C:/Program Files/nodejs/node.exe",
        "C:/tools/U.A.G.C/fixtures/fake-worker.mjs",
        "{{promptFile}}"
      ]
    }
  },
  "defaults": {
    "workspaceMode": "worktree",
    "permissions": "runtime-managed",
    "timeoutSeconds": 30
  }
}
```

Thay đường dẫn `node.exe` bằng kết quả trên nếu khác. Trong JSON, dùng dấu `/` như mẫu; giữ nguyên `{{promptFile}}`. `stateDir` là nơi lưu lịch sử công việc và bản làm việc, nên đặt ngoài dự án muốn sửa.

Kiểm tra cấu hình:

```powershell
npm.cmd run doctor -- --config .\agents.local.json
```

Dòng `demo` cần hiện `FOUND`. Các agent khác báo `MISSING` không ảnh hưởng đến demo. `FOUND` chỉ xác nhận tìm thấy chương trình, chưa xác nhận agent AI đã đăng nhập.

## 3. Thêm UAGC vào Claude Desktop

Theo [hướng dẫn MCP chính thức](https://modelcontextprotocol.io/docs/develop/connect-local-servers), mở **Settings → Developer → Edit Config** trong ứng dụng desktop. File cấu hình trên Windows thường ở `%APPDATA%\Claude\claude_desktop_config.json`.

Nếu đây là lần cấu hình đầu tiên, dán toàn bộ đoạn sau. Nếu file đã có công cụ khác, chỉ thêm mục `uagc` bên trong `mcpServers`, giữ nguyên các mục cũ.

```json
{
  "mcpServers": {
    "uagc": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/tools/U.A.G.C/src/index.mjs",
        "--config",
        "C:/tools/U.A.G.C/agents.local.json"
      ]
    }
  }
}
```

Thay đường dẫn nếu cần, lưu file, thoát hẳn Claude Desktop rồi mở lại. Trong danh sách công cụ/kết nối, kiểm tra có `uagc` và các tool như `runtime_list`, `agent_delegate`. Tên vị trí trong giao diện có thể thay đổi theo phiên bản ứng dụng.

Bạn có thể nhắn:

> Hãy gọi runtime_list của UAGC và kiểm tra runtime demo có được tìm thấy không.

Nếu ứng dụng hỏi cho phép dùng tool, xem yêu cầu rồi xác nhận. Không nhập các câu nhắn này vào PowerShell.

## 4. Chạy thử một công việc

Tạo **thư mục demo mới**, tách khỏi source UAGC. Các lệnh dưới đây dùng `C:\tools\uagc-demo`; nếu đã có thư mục này, chọn tên khác.

```powershell
New-Item -ItemType Directory -Path 'C:\tools\uagc-demo'
Set-Location 'C:\tools\uagc-demo'
git init -b main
Set-Content -Path README.md -Value '# UAGC demo'
git add README.md
git commit -m "chore: initialize demo"
git status --short
```

Nếu Git yêu cầu danh tính, đặt tên/email **chỉ cho repo demo**, rồi chạy lại lệnh commit:

```powershell
git config user.name "UAGC Demo"
git config user.email "demo@example.invalid"
git commit -m "chore: initialize demo"
```

Sau commit, `git status --short` cần không có output. Quay lại Claude Desktop và nhắn:

> Dùng UAGC, runtime demo, làm việc trong C:/tools/uagc-demo. Giao task tạo worker-output.txt, kèm plan kiểm tra luồng demo. Chọn workspaceMode worktree, permissions runtime-managed. Theo dõi đến khi hoàn tất, đọc agent_result và cho tôi xem thay đổi. Chờ tôi duyệt trước khi apply; chưa cleanup.

**Kết quả mong đợi:** ứng dụng trả job ID và báo file `worker-output.txt` có hai dòng `implemented` và `plan-received`. Lúc này file nằm trong bản làm việc riêng, chưa có trong thư mục demo nguồn.

Nếu kết quả đúng, nhắn tiếp:

> Tôi duyệt thay đổi của job này. Hãy gọi agent_apply rồi báo kết quả.

Trong PowerShell, kiểm tra:

```powershell
Set-Location 'C:\tools\uagc-demo'
Get-Content .\worker-output.txt
git status --short
```

File cần chứa:

```text
implemented
plan-received
```

Cuối cùng nhắn:

> Hãy gọi agent_cleanup để dọn bản làm việc riêng của job vừa hoàn tất.

Cleanup không xóa file đã apply vào repo demo. UAGC không tự commit/push. Worker demo không hiểu yêu cầu tùy ý và không hỗ trợ sửa tiếp bằng `agent_resume`.

## Dùng agent AI thật

**Runtime** là chương trình agent thực hiện công việc; **model** là AI bên trong chương trình đó. UAGC cần runtime được cài và đăng nhập riêng. Một tài khoản trong ứng dụng chat chủ không tự đăng nhập cho runtime.

1. Chọn runtime và cài theo hướng dẫn của nhà phát triển. Với Hermes, xem [cài đặt chính thức](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) và [chế độ ACP](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp).
2. Cấu hình provider/model bằng công cụ của runtime và thử chạy một yêu cầu đơn giản trực tiếp trước. Với Hermes có thể dùng `hermes model` để chọn cấu hình. Dịch vụ model có thể tính phí riêng.
3. Runtime phải khởi chạy được từ cùng môi trường với UAGC. Nếu Hermes được cài trong WSL, gateway chạy bằng Node Windows không tự nhìn thấy lệnh đó; cần cấu hình môi trường tương ứng. Luồng WSL này chưa được repo kiểm chứng trọn vẹn.
4. Sau khi lệnh `hermes acp` hoạt động, có thể thay nội dung `agents.local.json` bằng cấu hình dưới. Cấu hình dùng model mặc định bạn đã chọn trong Hermes, không đoán tên model.

```json
{
  "stateDir": "C:/tools/uagc-state-desktop",
  "runtimes": {
    "hermes": {
      "kind": "acp",
      "target": "hermes",
      "argv": ["hermes", "acp"],
      "prerequisite": "hermes"
    }
  },
  "defaults": {
    "workspaceMode": "worktree",
    "permissions": "read-only",
    "timeoutSeconds": 900
  }
}
```

Thay đường dẫn state theo hệ điều hành. Nếu lệnh Hermes không nằm trên PATH của ứng dụng chủ, dùng đường dẫn executable đầy đủ trong `argv[0]` và `prerequisite`. Với cấu hình ACP này, không cần truyền model/provider cho UAGC khi muốn dùng mặc định của runtime.

5. Khởi động lại ứng dụng chủ, gọi `runtime_list`, rồi thử task đọc/review nhỏ với `permissions=read-only`.
6. Khi cần sửa code, chỉ với worker bạn tin tưởng, yêu cầu `permissions=approve-all`. Chế độ này tự chấp thuận yêu cầu quyền ACP, không tạo sandbox bảo vệ toàn máy.

Ví dụ câu nhắn cho công việc thật:

> Dùng UAGC runtime hermes và model mặc định của Hermes để sửa lỗi tổng tiền khi số lượng bằng 0 trong D:/repos/my-app. Lập kế hoạch, dùng worktree riêng và permissions approve-all. Chạy test liên quan, đọc patch và báo phần cần tôi review. Chờ tôi duyệt trước khi apply, không commit/push.

Nếu cần sửa tiếp, nhắn rõ lỗi cần sửa và yêu cầu `agent_resume` với job ID đó. Review kết quả mới trước apply. Sau apply, chạy kiểm tra của dự án rồi mới cleanup. Job đã apply không được resume.

Tên runtime xuất hiện trong danh sách không phải chứng nhận tương thích. Hermes/provider thật chưa nằm trong bài test end-to-end của repo. [Cấu hình model alias, profile và CLI khác](TECHNICAL.md#configuration) dành cho khi bạn đã xác minh tổ hợp muốn dùng.

## Xử lý lỗi thường gặp

| Thông báo hoặc hiện tượng | Cách xử lý |
| --- | --- |
| `node` / `git` không được nhận diện | Cài công cụ còn thiếu, mở terminal mới và chạy lại lệnh version. |
| `npm.ps1` bị chặn | Dùng `npm.cmd` trong PowerShell như hướng dẫn. |
| `Cannot find package` | Chạy `npm.cmd ci --ignore-scripts` trong thư mục có `package.json`. |
| Không thấy UAGC | Kiểm tra đường dẫn và JSON, thoát hẳn/mở lại ứng dụng. Với Claude, xem log tại `%APPDATA%\Claude\logs`. |
| Agent báo `MISSING` | Kiểm tra cài đặt runtime và đường dẫn executable; demo chỉ cần Node. |
| `FOUND` nhưng job lỗi | Kiểm tra đăng nhập, model và log; `FOUND` chưa kiểm tra kết nối AI. |
| Repo có thay đổi chưa commit | Review rồi commit hoặc cất riêng thay đổi trước khi giao việc; không xóa để ép chạy. |
| Target branch hoặc HEAD changed | Nhánh/commit nguồn đã đổi; tạo job mới từ trạng thái hiện tại và review lại. |
| State directory is locked | Đóng gateway còn chạy hoặc dùng `stateDir` riêng cho mỗi ứng dụng. Nếu từng crash, xem phần phục hồi bên dưới. |
| CLI requires an argv/env placeholder | Cấu hình tuyên bố chọn model/provider nhưng không truyền được; sửa template theo [tài liệu](TECHNICAL.md#configuration). |
| Job timeout hoặc cancelled | Đọc kết quả và lưu phần việc muốn giữ trước cleanup; job lỗi không được apply trực tiếp. |
| `interrupted` / `termination-uncertain` | Kiểm tra tiến trình, session và worktree trước khi phục hồi thủ công. |

**Phục hồi khóa sau crash:** file `gateway.lock` nằm trong `stateDir`, chứa PID chủ sở hữu. Chỉ xóa chính file khóa khi đã xác minh gateway cũ không còn chạy và đã kiểm tra/dừng các worker còn sống. Không xóa thư mục state: nó chứa prompt, log và phần việc chưa áp dụng. Sau khi mở lại, job dở dang sẽ được đánh dấu `interrupted`, không tự chạy lại.

**Nâng cấp từ 0.2.1:** hoàn tất/review các job cũ trước khi nâng cấp. Bản mới từ chối apply job cũ thiếu thông tin nhánh nguồn; không tự thêm trường vào file trạng thái để vượt kiểm tra. Xem [changelog](../CHANGELOG.md).
