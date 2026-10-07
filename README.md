# TDLUXY Studio

Studio sáng tạo đa nền tảng được xây bằng Expo/React Native: một codebase responsive dùng chung cho web, Android và iOS.

## Hàng đợi bền vững và hạn mức video

Backend lưu điểm khôi phục vào SQLite trước khi gửi Muse và ngay sau khi nhận mã phiên:

- `prepared`: yêu cầu chưa gửi; tự chạy tiếp khi backend khởi động lại, giữ nguyên ảnh tham chiếu.
- `submitting`: đang gửi; nếu bị gián đoạn thì chuyển sang **Cần kiểm tra**. Không tự gửi lại vì Muse không cung cấp khóa chống trùng phía dịch vụ.
- `tracking`: đã có mã phiên và danh sách video có trước yêu cầu; sau khởi động lại chỉ tiếp tục chờ/tải video mới, không gửi lại prompt. Khi theo dõi hết thời gian hoặc mất kết nối, dùng **Tiếp tục theo dõi** trong Lịch sử.
- Tác vụ cũ không có điểm khôi phục không thể tự tiếp tục an toàn. Không thay đổi trạng thái tác vụ cũ đã hoàn tất.

Tắt backend bình thường sẽ chờ lưu trạng thái trước khi đóng kết nối. File tải dở dùng đuôi `.part`; file hoàn tất được đổi tên và có thể dùng lại khi khôi phục. Chỉ chạy **một worker** trên một thư mục trạng thái; khóa tiến trình sẽ từ chối worker thứ hai để tránh chạy trùng. Đây vẫn là hàng đợi cục bộ, không phải hệ thống nhiều máy chủ.

Mặc định mỗi người dùng (kể cả admin): **2 tác vụ đang chờ/chạy, 20 yêu cầu/ngày UTC, kho video 2 GiB**. Mỗi tác vụ giữ chỗ và được lưu tối đa **256 MiB** video; toàn hệ thống tối đa **16 tác vụ**, giữ tối thiểu **512 MiB** đĩa trống. Đổi các biến `TDLUXY_VIDEO_*` trong `backend/.env` theo mẫu `.env.example`, rồi khởi động lại backend. Hạn mức kho này áp dụng cho video tạo ra; ảnh Muse và tệp đăng bài tạm vẫn dùng giới hạn riêng. Client Muse hiện nhận một số media vào RAM trước khi kiểm tra kích thước ghi đĩa; giới hạn này không phải giới hạn RAM của tiến trình.

Lịch sử tự làm mới, hiển thị dung lượng và hỗ trợ hủy yêu cầu chưa gửi, tiếp tục theo dõi, xóa tác vụ/video với xác nhận. Xóa không hoàn lại lượt trong ngày. Mã yêu cầu được giữ để tránh tạo lại khi gửi trùng sau lỗi mạng; frontend giữ mã chờ qua tải lại trang trong cùng phiên đăng nhập, không lưu prompt/ảnh vào bộ nhớ trình duyệt cho mục đích này.

Chat mới ưu tiên tài khoản Muse không bận. Nếu tài khoản của phiên đang bận, trả thông báo ngay rằng **tin nhắn chưa gửi**, không chờ sau một video dài. Phiên có video chưa rõ kết quả không nhận thêm yêu cầu mới để tránh nhận nhầm tệp; có thể mở cuộc trò chuyện mới. Sau khi nhận tác vụ video, giao diện không khóa toàn bộ studio và có thể chuyển sang Lịch sử.

API bổ sung: `GET /api/muse/usage`, `POST /api/muse/jobs/{id}/resume`, `POST /api/muse/jobs/{id}/cancel`, `DELETE /api/muse/jobs/{id}`. Tất cả kiểm tra đăng nhập và quyền sở hữu. `POST /api/muse/videos` nhận `request_id` tùy chọn; cùng mã và cùng nội dung trả cùng tác vụ, cùng mã khác nội dung trả 409.

## Tổ chức source

- `backend/services/accounts.py`: tài khoản, phiên đăng nhập, vault Muse.
- `backend/services/jobs.py`: model tác vụ và migration SQLite.
- `backend/services/video_engine.py`: gửi một lần, lưu điểm khôi phục, theo dõi và tải kết quả.
- `backend/services/limits.py`, `worker_lease.py`: hạn mức tài nguyên và khóa worker.
- `src/services`: API, lưu token, chống gửi trùng yêu cầu video.
- `src/components`: thư viện, trình đăng bài, các bảng studio và quản trị.
- `src/styles/studio.ts`, `src/types.ts`: styles và kiểu dữ liệu dùng chung.

Kiểm tra thay đổi: `npm.cmd run typecheck`, `backend\.venv\Scripts\python.exe -m unittest discover -s backend\tests -q`, `npm.cmd run export:web`. Sau khi build web, có thể chạy `backend\.venv\Scripts\python.exe backend\tests\web_smoke.py` để kiểm tra màn Lịch sử trên desktop/mobile với API giả lập, không gọi Muse thật.

## Chạy ứng dụng

```bash
npm.cmd install
npm.cmd run web
```

Dùng `npm.cmd run android` hoặc `npm.cmd run ios` để mở ứng dụng với Expo trên thiết bị/emulator. Android cần Android Studio; iOS Simulator cần macOS và Xcode.

## Tạo bản cài đặt

Cài và đăng nhập [EAS CLI](https://docs.expo.dev/build/introduction/), sau đó chạy:

```bash
npx.cmd eas-cli build --platform android --profile preview
npx.cmd eas-cli build --platform ios --profile production
```

Profile `preview` tạo APK Android để cài thử. Profile `production` tạo bản iOS phân phối qua App Store Connect và cần Apple Developer account cùng thông tin ký ứng dụng. EAS Build chạy trên hạ tầng đám mây.

## Muse bridge cục bộ

**TDLUXY Studio** là tên sản phẩm; Muse.ai là dịch vụ bên ngoài mà backend dùng cho đăng nhập, chat và tạo video từ prompt/ảnh tham chiếu. Backend gọi trực tiếp Python client MuseAI-API đã ghim tại commit `bf964f7c022f11a3574e2e17a8ec57e7c9b0e596`. Đây là client không chính thức dùng giao thức Hatch/Noise, không phải REST API công khai. Chủ dự án đã xác nhận có quyền dùng và sửa mã nguồn cho công việc này; quyền đó không thay thế điều khoản sử dụng Muse.ai. Khả năng chat phụ thuộc vào model/tài khoản Muse; tạo video có thể mất vài phút và phụ thuộc dịch vụ Muse.

Tạo concept ảnh gửi yêu cầu qua Muse Chat để nhận prompt; nếu Muse trả về tệp ảnh thì bridge hiển thị thumbnail và kích thước gốc trong gallery, mở xem ảnh gốc độ phân giải cao và lưu tệp nguồn không giảm chất lượng. Ảnh được lưu theo tài khoản; URL ảnh là token có thời hạn 12 giờ và có thể cấp lại khi tải lịch sử chat. Tệp kết quả chỉ lấy từ tin nhắn của Muse/assistant, không lấy ảnh tham chiếu người dùng. MuseAI-API hiện không có model xuất tệp ảnh độc lập, nên công cụ tạo ảnh trả prompt trừ khi Muse thực sự trả về tệp ảnh. Tạo video gửi prompt (và ảnh tham chiếu nếu có) qua chat stream Muse rồi theo dõi media trong cùng phiên chat; video kết quả hiển thị ở tab tạo video. Chỉnh ảnh preset và collage 2×2 hiện xử lý ảnh thật trên backend bằng Pillow và hiển thị ảnh kết quả; chưa có xóa nền/retouch AI hoặc template ghép tùy biến. Edit video, tạo nhạc vẫn là brief/kế hoạch, chưa xuất tệp. Tính năng Đăng video mở một Chromium headless riêng cho từng tài khoản, stream ảnh chụp vào app và nhận thao tác người dùng; hỗ trợ TikTok/YouTube Studio, tải video tạm lên backend (giới hạn 250 MB), tự gắn tệp khi trang mở hộp chọn file. Người dùng tự đăng nhập và xác nhận đăng bài — không tự động bấm nút đăng. Cookie và video tạm bị xóa khi đóng phiên/đăng xuất. Không dùng cho dữ liệu hoặc tài khoản bạn không có quyền xử lý.

### Cài và chạy backend (Windows)

Python 3.11+ được yêu cầu bởi thư viện Muse. Trong PowerShell:

```powershell
py -3.12 -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
npm.cmd run backend
```

Nếu Python launcher không có 3.12, dùng bản Python 3.11+ đã cài, ví dụ thay `py -3.12` bằng `py -3.14`. Mở `backend\.env` và đặt `TDLUXY_ADMIN_EMAIL`, `TDLUXY_ADMIN_PASSWORD` (ít nhất 12 ký tự), cùng `TDLUXY_MUSE_VAULT_KEY`. Tạo khóa vault bằng:

```powershell
backend\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Backend tự đặt `PLAYWRIGHT_BROWSERS_PATH` về `backend\.playwright-browsers` khi khởi chạy. Khi cài Chromium lần đầu, đặt biến này trong PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\backend\.playwright-browsers"
backend\.venv\Scripts\python.exe -m playwright install chromium
```

Không thay khóa vault sau khi đã kết nối Muse nếu chưa sao lưu/mã hóa lại dữ liệu — khóa sai sẽ khiến cookie không giải mã được. Giữ `.env` và khóa ở máy chủ, không commit/chia sẻ. Backend mặc định chỉ bind `127.0.0.1:8787`; tài khoản, session Muse đã mã hóa và video tải về được giữ dưới `backend\.muse-state` / `backend\outputs`. Không đưa các thư mục này lên Git.

Trong terminal thứ hai:

```powershell
npm.cmd run web
```

### Truy cập web từ xa qua Cloudflare Tunnel (Windows)

Chạy `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start_remote.ps1` để đóng gói web, mở backend chỉ trên `127.0.0.1` và tạo Cloudflare Quick Tunnel HTTPS. Script tự tạo mật khẩu chia sẻ ngẫu nhiên (28 ký tự), tải cloudflared từ GitHub Releases chính thức nếu cần và xác minh chữ ký trước khi chạy. Mật khẩu chỉ được in trong terminal khi tunnel sẵn sàng; nó không được lưu trong bundle hay tệp cấu hình. Người nhận URL cần nhập mật khẩu. Phiên truy cập tự hết hạn sau 12 giờ và đăng nhập bị giới hạn tối đa 5 lần mỗi phút.

Giữ cửa sổ PowerShell mở khi sử dụng; nhấn `Ctrl+C` để đóng tunnel và backend do script khởi chạy. URL Quick Tunnel thường đổi sau mỗi lần chạy. Máy chủ cần luôn bật và có Internet. Đây là cách chia sẻ tạm thời, không phải dịch vụ production; hãy gửi mật khẩu qua kênh riêng, không gửi cùng nơi công khai URL.

Ở mobile Expo Go trên cùng mạng LAN, đặt `EXPO_PUBLIC_MUSE_API_URL` thành địa chỉ LAN của máy chạy backend, ví dụ `http://192.168.1.20:8787`, trước khi khởi động Expo. Android emulator mặc định dùng `10.0.2.2`; trình duyệt máy chủ mặc định dùng localhost. Để truy cập backend qua mạng, bật host LAN, đặt `MUSE_BRIDGE_TOKEN` ở backend và cấu hình cùng token trong `EXPO_PUBLIC_MUSE_BRIDGE_TOKEN` phía app. Token Expo public được đóng vào bundle, vì vậy chỉ dùng như mã ghép nối tạm trên mạng tin cậy; nó **không** thay thế xác thực người dùng hoặc TLS và không phù hợp để bảo vệ dịch vụ công khai. Không commit token.

### API backend và an toàn

- `POST /api/muse/auth/otp` và `/api/muse/auth/verify`: xác thực Muse. Tự nhập mã OTP trong ứng dụng; không ghi mã hay cookie vào log.
- `GET /api/health`: trạng thái bridge.
- `POST /api/auth/register`, `/api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`: tài khoản TDLUXY và session bearer; app lưu token bằng SecureStore trên mobile và sessionStorage trên web.
- `GET /api/admin/overview`, `/api/muse/accounts`: chỉ admin; tình trạng dịch vụ và nhóm tài khoản Muse dùng chung.
- `POST /api/muse/auth/otp`, `/api/muse/auth/verify`: chỉ admin; thêm tài khoản Muse vào vault được mã hóa.
- `POST /api/muse/chat`, `GET /api/muse/history`: chat và đọc lịch sử.
- `POST /api/muse/videos`, `GET /api/muse/jobs`, `GET /api/muse/jobs/{job_id}`: tạo video bất đồng bộ, liệt kê và theo dõi tác vụ đã lưu.
- `POST /api/media/images/edit`, `/api/media/images/collage`: preset chỉnh ảnh thật và xuất collage.
- `/api/publisher/session*`: mở/stream/điều khiển trình duyệt theo phiên người dùng; trang giới hạn trong TikTok/YouTube Studio, không tự đăng.
- `GET /api/muse/jobs/{job_id}/files/{index}/access`: nhận link tải có grant hết hạn sau 10 phút.
- `GET /api/muse/jobs/{job_id}/files/{index}`: mở video bằng bridge token hoặc grant còn hiệu lực.

Bridge chỉ cho CORS từ các origin local được cấu hình. Khi bind ra khỏi localhost, phải đặt `MUSE_BRIDGE_TOKEN`. Không tự mở backend ra Internet; script Cloudflare Tunnel ở trên giữ backend ở loopback và đặt lớp mật khẩu phiên cho mọi API. Hình tham chiếu được giới hạn số lượng/kích thước và xóa sau tác vụ. Job video được lưu metadata trong SQLite dưới `backend\.muse-state`; file kết quả nằm trong `backend\outputs`. Liên kết xem video được cấp grant có thời hạn, không cần đưa bridge token vào URL.

Kiểm tra backend sau khi cài dependencies:

```powershell
backend\.venv\Scripts\python.exe -m compileall backend
backend\.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
```

## Giao diện

Web/mobile dùng chung UI responsive TDLUXY Studio. Có tài khoản email/mật khẩu, vai trò user/admin, tách job và chat session theo người dùng; quản trị viên được cấu hình qua biến môi trường khi khởi tạo. Video AI có chọn tối đa 4 ảnh tham chiếu, lưu lịch sử và phân phối qua nhóm Muse hoạt động; từng tài khoản Muse chỉ xử lý một yêu cầu tại một thời điểm. Dự án/Lịch sử hiện chủ yếu hiển thị video AI; chưa có thư viện cloud, billing/VIP subscription, tạo ảnh AI, dựng video nguồn hay tạo nhạc. Remote browser là điều khiển thủ công qua ảnh chụp định kỳ, không phải stream video thời gian thực hoặc auto-publishing.
