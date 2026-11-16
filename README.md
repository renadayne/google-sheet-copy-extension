# Google Sheet Copy

Extension Chrome (Manifest V3) xuất nội dung một Google Sheet đang mở ra `.xlsx`, `.csv`, hoặc
chép vào clipboard dạng bảng HTML để dán sang sheet khác.

Extension không gọi API của Google. Nó đọc trực tiếp giao diện Sheets: di chuyển con trỏ qua
từng ô, đọc nội dung ở thanh công thức, định dạng ở thanh công cụ, và màu nền ô từ chính điểm ảnh
Sheets vẽ trên lưới.

## Cài đặt (load unpacked)

Cần Node.js 20 trở lên và Chrome 120 trở lên.

1. Cài dependencies:

   ```bash
   npm install
   ```

2. Build ra thư mục `dist/`:

   ```bash
   npm run build
   ```

3. Mở `chrome://extensions` trong Chrome.
4. Bật **Developer mode** ở góc trên bên phải.
5. Bấm **Load unpacked** và chọn thư mục `dist/` (không phải thư mục gốc của repo).
6. Tải lại các tab Google Sheets đang mở. Tab mở từ trước khi cài sẽ không có content script.

Sau mỗi lần sửa code: chạy lại `npm run build`, bấm nút reload của extension trong
`chrome://extensions`, rồi tải lại trang Sheet.

## Sử dụng

1. Mở một Google Sheet và chọn tab cần xuất.
2. Bấm biểu tượng extension để mở popup.
3. Chọn định dạng và các tùy chọn, rồi bấm **Xuất sheet này**.
4. Giữ popup mở cho đến khi xong. Đóng popup (kể cả bấm ra ngoài) sẽ hủy lượt quét.

| Định dạng | Kết quả                                                                           |
| --------- | --------------------------------------------------------------------------------- |
| `.xlsx`   | Tải file về: giá trị, font, cỡ chữ, đậm/nghiêng, màu chữ, màu nền, canh lề, ô gộp |
| `.html`   | Chép bảng có định dạng vào clipboard; mở sheet đích rồi nhấn Ctrl+V               |
| `.csv`    | Tải file về: chỉ có giá trị                                                       |

Tùy chọn:

- **Xuất công thức thay vì giá trị** (mặc định bật): ô có công thức được xuất thành công thức
  hoạt động. Khi tắt, công thức được xuất thành chuỗi văn bản (ví dụ `=SUM(A1:A3)` hiện nguyên
  dạng chữ, không được tính). Xem giới hạn bên dưới.
- **Tất cả các tab**: quét lần lượt mọi tab đang hiện ở thanh dưới. `.xlsx` gộp thành một
  workbook nhiều sheet; `.csv` tải một file cho mỗi tab; `.html` xếp các bảng nối tiếp nhau, mỗi
  bảng có một dòng tiêu đề là tên tab.

Trong lúc quét có thể **Tạm dừng** rồi **Tiếp tục**, hoặc **Hủy**. Khi tiếp tục, extension tự
quay lại đúng tab và ô đang dở. Khi xong hoặc hủy, con trỏ được trả về ô ban đầu.

## Giới hạn đã biết

**Về cách đọc dữ liệu**

- Không đọc được giá trị đã tính của ô công thức. Thanh công thức chỉ hiện công thức, còn kết
  quả được vẽ trên canvas. Vì vậy tắt tùy chọn công thức sẽ cho ra chữ của công thức chứ không
  phải kết quả.
- Công thức tham chiếu tab khác, file khác, hoặc dùng hàm riêng của Google Sheets
  (`IMPORTRANGE`, `QUERY`, `ARRAYFORMULA`...) có thể lỗi ở nơi đích.
- Chỉ chuỗi số đơn giản như `42` hay `3.14` được ghi thành kiểu số trong xlsx. Ngày tháng, tiền
  tệ, phần trăm và số dùng dấu phẩy thập phân được ghi thành văn bản. Định dạng số không được
  giữ.
- Ô trống có màu nền được ghi lại (chỉ màu, không có giá trị) khi lượt quét đi qua nó. Lượt quét
  nhảy qua dãy ô trống bằng Ctrl+→, nên ô trống có màu nằm sau một ô trống không màu có thể bị bỏ
  sót.
- Ô mà Sheets đã tự đổi kiểu sẽ ra giá trị gốc chứ không phải chữ đang hiển thị. Ví dụ ô hiện
  `2.4` nhưng thực chất là ngày thì xuất ra `02/04/2026`.

**Về định dạng**

- **Màu nền ô** được đọc từ canvas lưới của Sheets: lấy mẫu vài điểm ảnh ở dải trên cùng của ô
  đang chọn (vị trí lấy từ khung chọn `.active-cell-border`). Cách này chạy cả khi chỉ có quyền
  xem. Nếu không đọc được (ô nằm ngoài màn hình, không tìm thấy canvas) thì quay về đọc nút màu
  nền trên thanh công cụ. Ô có chữ lớn hoặc nhiều dòng lấp kín phần trên có thể đọc sai màu.
  Màu của định dạng có điều kiện và màu xen kẽ cũng được lấy, vì đó là màu đang hiển thị.
- **Sheet ở chế độ chỉ xem không có định dạng chữ.** Font, cỡ chữ, đậm, nghiêng, màu chữ, canh lề
  được đọc từ các nút trên thanh công cụ, và Sheets ẩn các nút này khi bạn chỉ có quyền xem. File
  xuất ra khi đó chỉ có giá trị, màu nền, ô gộp và bố cục ước lượng.
- Khi có quyền sửa, định dạng lấy từ thanh công cụ nên áp cho cả ô. Định dạng nhiều kiểu trong
  một ô (rich text) bị mất.
- Độ rộng cột và chiều cao hàng không đọc được. File xlsx ước lượng chúng từ nội dung: cột vừa
  với dòng dài nhất (tối đa 60 ký tự), chữ tự xuống dòng và canh giữa theo chiều dọc.
- Không đọc: viền ô, gạch chân (thanh công cụ Sheets không có nút này), gạch ngang, canh lề dọc,
  kiểm tra dữ liệu, ghi chú, bình luận, liên kết, hình ảnh, biểu đồ.

**Về ô gộp**

- Ô gộp được đọc từ name box, vốn hiện cả vùng gộp (ví dụ `A4:A6`) khi con trỏ đứng trong đó.
  Ô gộp hoàn toàn trống nằm giữa vùng trống có thể bị nhảy qua và không được ghi lại.
- Nếu một hàng không tới được, phần còn lại của hàng đó bị bỏ qua và popup ghi cảnh báo.

**Về vận hành**

- Sheets chỉ xử lý một phím điều hướng mỗi khung hình, nên tốc độ tối đa khoảng 60 ô mỗi giây
  khi tab đang hiển thị. Sheet hàng chục nghìn ô sẽ mất nhiều phút.
- Giữ tab Sheets hiển thị trong lúc quét. Khi tab bị ẩn hoặc cửa sổ bị thu nhỏ, trình duyệt
  ngừng vẽ khung hình và việc quét chậm lại còn khoảng một ô mỗi giây.
- Không dùng sheet trong lúc quét (trừ khi đã tạm dừng): extension điều khiển con trỏ của trang.
- Vùng quét bắt đầu từ A1. Số cột lấy từ ô mà Ctrl+End dừng lại; số hàng được thu hẹp về hàng
  cuối có dữ liệu bằng cách dò Ctrl+↑ ở từng cột, nên sheet có rất nhiều cột sẽ mất thêm thời
  gian dò trước khi quét.
- Tab ẩn bị bỏ qua. Hàng, cột ẩn và bộ lọc đang bật có thể làm lệch kết quả.
- Extension phụ thuộc vào cấu trúc DOM của Google Sheets (`#t-name-box`,
  `#t-formula-bar-input`, các nút `#t-bold`, `#t-text-color`...). Google đổi giao diện thì
  extension có thể hỏng. Khi trang tải xong, content script in một bản kiểm tra vào Console
  (`[google-sheet-copy] UI inspection`) và cảnh báo phần tử nào không tìm thấy.
- Điều hướng dùng sự kiện bàn phím và chuột do script tạo ra. Nếu Sheets bỏ qua các sự kiện
  này, việc quét sẽ không chạy.
- Giao diện Sheets cần hiện thanh công thức và thanh công cụ.

## Phát triển

```bash
npm run watch        # build lại khi file đổi
npm run typecheck
npm run lint
npm run format
```

Cấu trúc:

- `src/content/` – content script: đọc DOM (`dom-reader.ts`), đọc màu nền từ canvas
  (`canvas-reader.ts`), điều hướng (`navigator.ts`), quét
  (`extractor.ts`, `sheet-tabs.ts`).
- `src/exporters/` – `xlsx-exporter.ts` (ExcelJS), `html-exporter.ts`, `csv-exporter.ts`.
- `src/popup/` – giao diện popup; nhận kết quả quét và chạy exporter.
- `src/shared/` – kiểu dữ liệu `SheetModel` và các message giữa popup với content script.

Để gọi từng hàm khi gỡ lỗi: mở DevTools trên trang Sheet, chọn extension trong dropdown ngữ
cảnh của Console (mặc định là `top`), rồi dùng đối tượng `gsc`, ví dụ
`await gsc.getUsedRange()`.
