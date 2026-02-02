# WISDEMY - Solid of Revolution Visualizer 🧊
**Công cụ trực quan hóa Khối Tròn Xoay 3D (Solid of Revolution Visualizer)**

Một ứng dụng web giúp học sinh và giáo viên toán trải nghiệm tích phân và hình học không gian một cách trực quan nhất. Hỗ trợ vẽ hàm phân mảnh, tính diện tích/thể tích và chia sẻ bài tập qua Link.

![Screenshot](https://raw.githubusercontent.com/dohoangtu2212/solid-of-revolution/main/thumbnail.png)

## ✨ Tính năng chính
- **Vẽ đồ thị 3D**: Xoay quanh trục Ox/Oy (Update soon), hỗ trợ hàm phân mảnh (Piecewise).
- **Tính toán**: Tích phân tính Diện tích (S) và Thể tích (V) thời gian thực.
- **Chia sẻ**: Lưu toàn bộ cấu hình bài tập vào đường dẫn (URL) để gửi cho người khác.
- **Giao diện**: Dark mode hiện đại, hỗ trợ gõ công thức toán học ($sqrt(x), pi, e...$).

## 🚀 Cách chạy (Local Development)
Bạn cần một local server để chạy ứng dụng (do bảo mật module JS):
1. **VS Code**: Cài extension "Live Server" -> Chuột phải `index.html` -> "Open with Live Server".
2. **Python**: Mở terminal -> `python -m http.server` -> Vào `localhost:8000`.
3. **Node.js**: `npx http-server .`

## 🌐 Cách đưa lên mạng (Deployment)
Để không bị "sập server" khi tắt máy, hãy làm theo cách sau:

### Cách 1: GitHub Pages (Khuyên dùng)
1. Tạo một repository mới trên GitHub (ví dụ: `solid-visualizer`).
2. Upload tất cả các file trong thư mục này lên đó.
3. Vào **Settings** -> **Pages** -> Tại mục **Branch**, chọn `main` và bấm **Save**.
4. Đợi 1 phút, GitHub sẽ cấp cho bạn một đường link (ví dụ: `yourname.github.io/solid-visualizer`).
5. Dùng link đó trên iPad/Laptop thoải mái, không bao giờ sập!

### Cách 2: Upload file nén
Bạn có thể nén cả thư mục thành `.zip` rồi kéo thả lên [Netlify Drop](https://app.netlify.com/drop). Nó sẽ tạo link web ngay lập tức.

## 🛠 Công nghệ sử dụng
- **Three.js**: Render đồ thị 3D.
- **KaTeX**: Hiển thị công thức toán.
- **Vanilla JS**: Không framework, siêu nhẹ.

---
© 2024 WISDEMY Project.
