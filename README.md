# SeedCount Web v1.2

上传培养皿照片 → 自动定位计数区域 → 本机 AI 逐粒计数。**照片不出设备，断网也能用。**

算法、模型与 Android v0.5、微信小程序版完全相同（同一套权重、同一套参数），
基准照片实测精度一致：MAE 0.29 粒、平均相对误差 0.23%、14 张中 13 张完全正确。

v1.2 变更：界面改为极简双栏工作区；框选器支持同时添加多个矩形、圆形、
多边形或手绘区域，并增加固定可见的“添加区域”和“完成”操作。
单区域与自动定位继续使用原算法和参数。

## 一、在自己电脑上打开（本地试用）

受浏览器安全限制，**双击 index.html 打不开**（WASM 推理引擎要求 HTTP 环境）。
任选一种方式在本机启动一个静态服务器：

| 系统 | 操作 |
| --- | --- |
| Windows | 双击 `启动-Windows.bat`（需先安装 Python） |
| macOS | 双击 `启动-Mac.command` |
| Linux | 执行 `./start.sh` |
| 通用 | 在本目录执行 `python3 -m http.server 8000`，浏览器打开 http://localhost:8000/ |

启动脚本会额外发送两个响应头（COOP/COEP），让推理引擎启用多线程，速度更快；
直接用 `python3 -m http.server` 也能正常运行，只是退化为单线程。

本机启动后，同一 WiFi 下的手机浏览器访问 `http://<本机局域网IP>:8000/` 也可使用。

## 二、部署成公开网址（对外分发）

把整个目录原样上传到任意静态托管，所有人打开链接即可使用：

| 平台 | 操作 | WASM 多线程 |
| --- | --- | --- |
| Cloudflare Pages | 拖入目录即可（已附 `_headers`） | ✅ |
| Netlify | 拖入目录即可（已附 `_headers`） | ✅ |
| Vercel | 导入目录（已附 `vercel.json`） | ✅ |
| GitHub Pages / Gitee Pages | 推送目录（已附 `.nojekyll`） | ❌（自动单线程，仍可用） |
| 自建服务器 | nginx 增加 `add_header Cross-Origin-Opener-Policy same-origin;` 与 `add_header Cross-Origin-Embedder-Policy require-corp;` | ✅ |

部署到 HTTPS 后自动获得 PWA 能力：第二次打开完全离线；在手机浏览器菜单里
选「添加到主屏幕」，用起来就和 App 一样。

## 三、使用步骤

1. 把照片拖到左侧拖放区，或点击拖放区选择文件（手机上还可以直接调用摄像头拍照）。
2. 如需限定范围，点「添加区域」；可连续添加多个矩形、圆形、多边形或手绘区域。
3. 点「开始计数」。首次会下载模型（5.5 MB）并加载推理引擎（14 MB），
   之后两者都会被缓存，**断网可用**。
4. 结果区可切换「原图／标注／表格」，逐粒结果可直接查看或下载 CSV；标注图也可下载。
5. **务必人工复核叠加图，不要只看总数。**

浏览器要求：近四年的 Chrome / Edge / Safari / Firefox（需支持 WebAssembly SIMD）。
单张耗时取决于设备算力，约 3~15 秒。

## 四、文件结构

```
index.html            页面（唯一入口）
css/style.css         样式（桌面双栏布局，窄屏自动堆叠）
js/app.js             界面逻辑
js/model-web.js       推理后端（onnxruntime-web，WASM 本机推理）
js/decoder.js         照片解码（EXIF 自动转正，长边 ≤3000，与安卓版一致）
js/roi-editor.js      框选编辑器
js/core/              算法核心，与微信小程序 utils/ 逐行对应
vendor/ort/           ONNX Runtime Web（1.30.0，仅 wasm 后端三件套）
seed_sd1.onnx         模型（与小程序、Android 同一套权重）
sw.js + manifest      PWA（离线缓存 + 添加到主屏幕）
_headers / vercel.json / .nojekyll   各平台部署配置
start.py / start.sh / 启动-*         本地一键预览
```

## 五、精度回归测试

部署或改动后，用 14 张基准照片（S01~S07 = 123 粒，S08~S14 = 35 粒）复跑一遍，
预期 `MAE=0.29  MAPE=0.23%  exact=13/14`。
