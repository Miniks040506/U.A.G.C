# Bắt đầu với UAGC

[← README](../README.md)

Hướng dẫn này đi từ tải xuống đến lần chạy đầu tiên. Ví dụ dùng **Windows + Claude Desktop**, với UAGC đặt tại `C:\tools\U.A.G.C`. Nếu bạn chọn thư mục khác, thay đường dẫn tương ứng trong các đoạn bên dưới.

## 1. Chuẩn bị và tải xuống

1. Cài [Node.js](https://nodejs.org/) 22.13 trở lên và [Git](https://git-scm.com/downloads).
2. Cài, mở và đăng nhập [Claude Desktop](https://claude.ai/download). Cần ứng dụng desktop hỗ trợ MCP cục bộ; chỉ mở website chat chưa đủ cho cách cấu hình này.
3. Trên [repo UAGC](https://github.com/Miniks040506/U.A.G.C), chọn **Code → Download ZIP**, giải nén. Đặt thư mục có `package.json` tại `C:\tools\U.A.G.C`. Có thể dùng [link tải ZIP trực tiếp](https://github.com/Miniks040506/U.A.G.C/archive/refs/heads/main.zip). Thư mục giải nén thường có tên `U.A.G.C-main`; đổi tên thành `U.A.G.C` để khớp ví dụ.
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

### Nếu muốn tải bằng Git

Thay bước tải ZIP bằng các lệnh sau, với thư mục đích chưa tồn tại:

```powershell
New-Item -ItemType Directory -Force -Path 'C:\tools'
Set-Location 'C:\tools'
git clone https://github.com/Miniks040506/U.A.G.C.git
Set-Location '.\U.A.G.C'
npm.cmd ci --ignore-scripts
npm.cmd test
```

**Chưa có Claude hoặc Hermes?** Bạn có thể dừng sau khi test báo `fail 0`. Bộ test chạy bằng worker giả lập trên máy, không cần tài khoản AI; lần tải thư viện vẫn cần Internet. Demo qua cửa sổ chat ở bước 3–4 cần ứng dụng chủ còn khả năng gửi yêu cầu. Không cần mua model chỉ để chạy bộ test.

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

## Ví dụ giao việc từng bước

Ví dụ này dành cho **agent thật đã cài, đăng nhập và kiểm tra riêng** theo phần trên. Thay `D:/repos/my-app` bằng đường dẫn dự án của bạn và `hermes` bằng runtime đã cấu hình. Đây là các câu nhắn mẫu cho ứng dụng chủ, không phải lệnh PowerShell và không phải kết quả model đã được repo xác minh.

### A. Review trước, chưa sửa file

Mở terminal trong dự án, chạy `git status --short`. Nếu có thay đổi, lưu thành commit hoặc cất riêng trước khi bắt đầu. Dự án cần có ít nhất một commit.

Gửi trong cửa sổ chat:

> Gọi runtime_list của UAGC để kiểm tra hermes. Nếu khả dụng, dùng agent_delegate với runtime hermes, cwd D:/repos/my-app, workspaceMode worktree, permissions read-only. Task: review cách tính tổng tiền khi số lượng bằng 0. Plan: tìm hàm tính tiền, đọc test liên quan, báo lỗi và đề xuất cách sửa. Chưa sửa file. Theo dõi agent_status đến khi kết thúc, đọc agent_result và báo job ID cùng kết quả.

Bạn cần thấy job ID thật và kết quả từ tool. `FOUND` mới chỉ xác nhận có chương trình; nếu đăng nhập hoặc model lỗi, sửa cấu hình đó trước khi giao việc tiếp.

### B. Giao một thay đổi nhỏ

Sau khi xem review, tạo **job mới** có quyền ghi:

> Tạo job mới bằng UAGC runtime hermes trong D:/repos/my-app, workspaceMode worktree, permissions approve-all. Task: sửa lỗi vừa xác định khi số lượng bằng 0. Plan: xác nhận hành vi mong đợi từ yêu cầu dự án, sửa tối thiểu, thêm hoặc cập nhật test cho lỗi này và chạy test liên quan. Nếu chưa rõ hành vi mong đợi, hỏi tôi trước khi chạy. Chỉ sửa phần liên quan. Đọc agent_result, trình bày patch, lệnh test và kết quả thực tế. Chờ tôi duyệt trước agent_apply; chưa cleanup, không commit/push.

`approve-all` cho phép tự chấp thuận yêu cầu quyền của worker ACP. Chỉ dùng với agent và dự án bạn tin tưởng. Lời nhắn chờ duyệt do ứng dụng chủ thực hiện; UAGC chưa có màn hình xác nhận riêng.

### C. Yêu cầu sửa tiếp khi chưa apply

Nếu còn thiếu một trường hợp, dùng đúng job ID của bước B:

> Với job JOB_ID vừa tạo, gọi agent_resume để bổ sung test cho trường hợp số lượng bằng 1, giữ nguyên phạm vi sửa. Chạy lại test, đọc agent_result và cho tôi xem patch mới. Chưa apply hoặc cleanup.

Thay `JOB_ID` bằng ID thật. Sửa tiếp yêu cầu runtime ACP hỗ trợ resume và job chưa apply; worker demo không hỗ trợ bước này. Nếu không hỗ trợ resume, tạo job mới với yêu cầu đầy đủ.

### D. Duyệt và áp dụng

Sau khi đọc patch và kết quả test:

> Tôi duyệt patch của job JOB_ID. Hãy gọi agent_apply cho đúng job đó và báo kết quả. Chưa cleanup, không commit/push.

Mở terminal trong **dự án của bạn**:

```powershell
Set-Location 'D:\repos\my-app'
git status --short
git diff
```

Chạy lệnh kiểm tra của dự án; ví dụ `npm.cmd test` chỉ khi dự án có script test đó. Kiểm tra cả file mới trong danh sách status: `git diff` mặc định không hiển thị nội dung file chưa được Git theo dõi. Khi hài lòng, bạn có thể tự commit; sau đó yêu cầu `agent_cleanup` cho từng job không cần giữ nữa, gồm cả job review ở bước A.

### Cùng ý định bằng tiếng Anh

> Use UAGC with runtime hermes in D:/repos/my-app. First prepare a focused plan for the zero-quantity total calculation bug. Delegate implementation in a separate worktree with approve-all permissions, run the relevant tests, then show me the job ID, patch and actual test results. Wait for my approval before agent_apply. Do not commit, push or clean up yet.

Ứng dụng chủ/model chịu trách nhiệm hiểu ngôn ngữ và chọn tool. UAGC nhận task/plan từ ứng dụng đó; chưa có bảo đảm mọi model sẽ hiểu hoặc gọi đúng chỉ từ câu nhắn này.

## Cập nhật và gỡ cài đặt

### Cập nhật

Hoàn tất hoặc lưu lại kết quả các job đang chạy, thoát ứng dụng chủ và sao lưu `agents.local.json` trước khi cập nhật. Không chạy đồng thời hai gateway dùng chung `stateDir`.

- **Cài bằng ZIP:** tải ZIP mới, giải nén vào thư mục mới, chép cấu hình cá nhân sang và chạy `npm.cmd ci --ignore-scripts`, rồi `npm.cmd test`. Nếu vị trí thay đổi, sửa đường dẫn UAGC trong cấu hình ứng dụng chủ. Giữ bản cũ đến khi đã kiểm tra bản mới.
- **Cài bằng Git:** trong thư mục UAGC, kiểm tra `git status --short`. Khi không có thay đổi source cần giữ, chạy lần lượt:

```powershell
git pull --ff-only
npm.cmd ci --ignore-scripts
npm.cmd test
```

Đọc [CHANGELOG](../CHANGELOG.md) trước khi mở lại ứng dụng chủ. Nếu Git báo xung đột hoặc từ chối cập nhật, dừng và xử lý thay đổi của bạn; không dùng lệnh reset để ép chạy.

### Gỡ cài đặt

1. Lưu lại phần việc cần giữ; gọi `agent_cleanup` cho các job đã kiểm tra xong khi gateway còn chạy.
2. Trong cấu hình MCP của ứng dụng chủ, xóa riêng mục `uagc`, giữ các công cụ khác và bảo đảm JSON còn hợp lệ. Thoát hẳn ứng dụng để gateway dừng.
3. Xóa thư mục cài UAGC khi không còn cần. State nằm ở vị trí riêng trong `stateDir`; chỉ xóa sau khi chắc chắn đã lưu prompt, log và thay đổi cần giữ, đồng thời không còn gateway/worker sử dụng nó.
4. Node.js, Git và agent AI được cài riêng. Không cần gỡ chúng nếu còn dùng cho dự án khác.

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
