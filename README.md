# MES 包材计算 · 单页版（mes-calc-web）

MES 生产助手的「生产计算 / 包材计算」页独立纯网页版：手填或扫码录入批号、填分桶与参数 → 本地计算包材用量、托数、重量范围 → 保存到本机历史、复制结果、导出 CSV。

**纯前端静态站**：无云函数、无登录、无订单/人员数据、无任何 npm 依赖、无外部资源请求。计算全部在本机浏览器完成。

## 本地运行

页面使用 ES Module 加载脚本，必须通过 HTTP 访问（`file://` 直开会被浏览器拦模块跨域）：

```bash
# 在 mes-calc-web 目录执行任意静态服务器，例如：
python3 -m http.server 8080
# 然后访问 http://127.0.0.1:8080/
```

## 目录结构

```
mes-calc-web/
├── index.html            # 页面结构（卡片顺序与 App 目标版式一致）+ 扫码浮层 + PWA 元信息
├── manifest.webmanifest  # PWA 清单（名称/图标/主题色/standalone）
├── sw.js                 # Service Worker（app shell 预缓存 + 离线回退）
├── icons/                # PWA 图标（192/512/maskable-512/apple-touch-180，真 PNG）
├── css/style.css         # MES 设计令牌 + 目标版式样式
├── js/
│   ├── calc.js           # 计算内核：公式与 mes-uniapp/utils/calc.js 同一份（computeMaterial / computeWeightRange；仅注释措辞按本页口径）
│   ├── store.js          # localStorage：历史记录
│   ├── app.js            # 页面状态、渲染、扫码、保存/历史/复制/导出 + SW 注册/安装引导
│   └── vendor/
│       ├── zxing.min.js      # ZXing 0.23.0 UMD（Apache-2.0），原生 BarcodeDetector 不可用时懒加载
│       └── LICENSE-zxing.txt # ZXing 许可文本
└── README.md
```

## 功能

| 区块 | 内容 |
| --- | --- |
| 批号 | 手填或「扫码」填入（仅作展示与历史记录；无订单查询、无产品编码） |
| 分桶件数 | A–J 5 列×2 行 + 零箱 / 瓶·件 / 件·托 |
| 生产数据 | 3 列×2 行：入库瓶数 / 取样数（唯一输入）/ 领用内包数 / 桶数 / 入库数 / 托码；卡内三键「保存 / 历史 / 清空」（2:1:1）+「复制结果 / 导出 CSV」 |
| 包材卡片 | 标签/防伪追加 + 5 列表格（包材 / 领用 / 实用 / 损耗 / 退回，实用自动） |
| 重量参数 | 单箱重量 / 单瓶重量 + 重量范围（自动） |
| 托分页 | 件号、零箱（最后一托）、首托 / 上一托 / 下一托 / 尾托 |

- **扫码（双引擎）**：批号右侧「扫码」打开全屏相机浮层。优先用浏览器原生 `BarcodeDetector` 逐帧识别；不支持时（Safari / Firefox / 微信等）自动懒加载本地 ZXing（`js/vendor/zxing.min.js`，全局 `ZXing`，不联网、不引 npm 依赖）继续识别。识别后清洗（去空白/非字母数字、转大写、最多 12 位）并回填批号，自动关闭浮层；不截图、不上传图像。关闭浮层、按 Esc、页面切后台或锁屏会立即停止相机。
- **相册兜底**：浮层底部「从相册选择图片」用 ZXing 解码本地图片；相机被拒/不可用时浮层切换为兜底面板，提示相册识别或手动输入。微信内置浏览器额外提示「可点右上角「…」在 Safari 中打开」。相机与相册识别均在本地完成，不上传图片。
- **扫码兼容性**：

| 环境 | 引擎 | 说明 |
| --- | --- | --- |
| Chrome / Edge / Android WebView | 原生 `BarcodeDetector` | 优先路径，识别速度快 |
| iOS Safari / Firefox / 微信 | 本地 ZXing | 原生缺失时自动加载 vendor 文件；相机需 HTTPS/localhost 与授权 |
| 相机不可用 | 相册识别 / 手动输入 | 浮层切兜底面板，不卡死 |

ZXing 来源：`@zxing/library@0.23.0`（`umd/index.min.js`，362 KB / gzip≈108 KB，Apache-2.0），许可文本见 `js/vendor/LICENSE-zxing.txt`。
- **历史记录**：按批号去重，最多 50 条；支持载入、删除、清空；存储键 `mes-calc-web:records:v1`。
- **复制结果**：与 App 离线复制文案同一格式（批号/瓶件/件托/每桶件数/桶数/件数/瓶数/托数/件号/重量区间/包材用量）。
- **导出 CSV**：UTF-8 BOM，Excel 直接打开不乱码；上半部分为单据信息，下半部分为包材明细。

## 计算口径（与 App 完全一致）

- 计算函数原样复用 `mes-uniapp/utils/calc.js`（`computeMaterial` / `computeWeightRange`），公式未做任何修改。
- 本页无订单流程，`palletPending` 恒为 `false`（等价于 App「无关联订单」时的计算路径）。
- 公式摘要：
  - 件数 = Σ 各桶件数；入库瓶数 = 件数 × 瓶/件 + 零箱瓶数
  - 领用内包数 = 入库瓶数 + 取样数
  - 托数 = ⌊件数 / 件每托⌋ 托 + 余件；总托数 = ⌈件数 / 件每托⌉
  - 件号 = 按桶 A→J 连续编号（字母 + 3 位序号），按 件/托 切分当前托
  - 包材：标签 = 领用内包数 + 标签追加；唛头 = 件数 + 零箱(1) + 有件桶数；纸箱 = 件数 + 零箱(1)；防伪 = 领用内包数 + 防伪追加
  - 重量范围 = 单箱重量 ± 单瓶重量 / 2（保留 3 位小数）

### 与 App 的数值对照（同一组输入）

输入：A=120、B=96、C=80，零箱 5，瓶/件 20，件/托 49，取样 9，标签追加 100，防伪追加 50；单瓶重量 0.35 kg，单箱重量 4.2 kg。

| 结果 | App 计算内核输出 | 单页版显示 |
| --- | --- | --- |
| 桶数 | 3 | 3 |
| 件数 | `296 件 + 5 瓶` | 296 件 + 5 瓶 |
| 入库瓶数 | `5925 瓶` | 5925 瓶 |
| 领用内包数 | `5934 瓶` | 5934 瓶 |
| 托码 | `6 托 + 2 件 + 5 瓶` | 6 托 + 2 件 + 5 瓶 |
| 总托数 / 当前托 | 7 / 第 1 托 | 7 / 第 1 托 |
| 件号（第 1 托） | `A001-A049` | A001-A049 |
| 零箱件号 | `C081（5 瓶）` | C081（5 瓶） |
| 包材实用 | 标签 6034 / 唛头 300 / 纸箱 297 / 防伪 5984 | 同左 |
| 重量范围 | `4.025–4.375 kg` | 4.025–4.375 kg |

## 版式口径

沿用 `mes-uniapp` HEAD `976c21f`「生产计算目标版式」：

- 页面底 `#F2F4F3`，卡片浅底 `#F7F9F8`，白格 + `1px #E3E8E5` 描边，主色 `#008577`
- 无页面标题/页头说明，首卡顶部直接 16rpx 间距；页边距 16rpx、卡间距 12rpx、卡内 16rpx；分桶 5 列×2 行；生产数据 3 列×2 行；包材表 5 列
- 单位换算：设计稿 750rpx，`--u = min(100vw / 750, 1px)`。390 宽下 1rpx = 0.52px（与 App 现场端一致）；≥750px 时 1rpx = 1px，容器 `max-width: 750px` 居中
- 单页版差异（无 App 外壳导致）：
  - 保留页脚（版本说明 + PWA 安装引导；App 用原生导航栏标题）
  - 重量参数格统一为白格 + 描边（App 该卡还是旧灰格，走查 backlog 待统一，这里直接按统一口径实现）
  - 无拖拽排序（保留卡片折叠）；无智能填充、订单行、分享、离线提示条
  - 有扫码（原生 BarcodeDetector + 本地 ZXing 双引擎 + 相册兜底，见上）
- 可点性与对比度（2026-11-02 界面走查后修订）：
  - 分桶格/尾格整体是 `<label>`：点格子任意位置（含四角与 label 区）都能聚焦对应输入；输入热区 88u（390 下 45.8px ≥44px），格高保持 112u、热区不出格
  - 只读值分段渲染：数字 44u 主色、单位 26u `--muted`；复合值统一「数字 空格 单位」写法，按「数字+单位」分段、只在 `+` 处分行；同排三格等高、label 顶部对齐（320/390 实测）
  - 小字主色统一 `--primary-ink`（#0B7263，在 `#E6F4F1` 上 5.16:1）：chip、重量范围、托分页浅绿按钮、历史「载入」
  - 包材「实用」列 0 值用 `--muted`，>0 才用主色系（`--primary-ink`）
  - 复制结果 / 导出 CSV 改白底 + 1px `#E3E8E5` 描边（原先 `#F2F4F3` 底与卡底仅 1.04:1）
  - 「瓶 / 件」「件 / 托」占位符为 `0`（不再写「请选择」误导为选择器），卡头 hint 注明「填数字、点格子任意位置即可输入」

## PWA 安装与离线

已按可安装 PWA 配置（`manifest.webmanifest` + `sw.js` + 192/512 与 maskable 图标），支持安装到桌面/主屏幕，断网可继续计算与读取本地历史。

### 安装

- **Chrome / Edge（桌面与 Android）**：满足安装条件时，页脚会出现「安装到桌面」按钮（来自 `beforeinstallprompt`，不占主流程）；也可以直接用地址栏的安装图标。安装完成后按钮自动隐藏。
- **iOS / iPadOS Safari**：无 `beforeinstallprompt`，页面会显示一行可关闭的提示「点 Safari 底部分享按钮 →「添加到主屏幕」」。
- 已安装（`display-mode: standalone`）或独立运行时不显示任何安装引导。

### 离线能力

`sw.js` 策略（改版时**手动改 `CACHE_VERSION`**，当前 `v5`；`activate` 会清理旧版本缓存）：

| 请求 | 策略 |
| --- | --- |
| 安装/激活 | 预缓存 app shell：`./`、`index.html`、`css/style.css`、`js/app.js`、`js/calc.js`、`js/store.js`、`js/vendor/zxing.min.js`（约 362 KB / gzip≈108 KB）、`manifest.webmanifest`、4 个图标；`activate` 删除旧缓存并 `clients.claim()` |
| 导航（打开页面） | network-first，失败回退缓存的 `index.html`（断网仍能打开） |
| 其他同源 GET（CSS/JS/图标/manifest） | cache-first，缺失时请求并回填缓存 |
| 跨域 / 非 GET | 直接放行，不缓存、不产生额外请求 |

因此首次在线访问后断网，重新打开页面仍可计算、可读写 `localStorage` 历史；相册扫码同样可用（ZXing 已随 app shell 缓存）；页面不发任何外部请求。

### 部署要求

- **HTTPS**（或 `localhost`）才能注册 Service Worker / 安装；`file://` 直开不可用。
- 托管需为 `.webmanifest` 返回 `application/manifest+json`（GitHub Pages 可直接用；国内托管若返回 `application/octet-stream`，需在 Nginx/对象存储里补 MIME）。
- 部署在子路径（如 `/mes-calc-web/`）或域名根都可：`start_url`/`scope` 为相对 `./`，SW 以自身目录为 scope。

### 发布检查清单（国内静态托管必做）

- 每次发布同步更新版本串 `BUILD`：`index.html` 的资源引用、`js/app.js` 的 SW 注册与 ZXing URL、`sw.js` 的 `BUILD` 与 `CACHE_VERSION`（本次为 `20261121a` / `v5`）。资源 URL 变了，CDN 才会回源，否则可能命中陈旧的压缩副本。
- 上传**整包**（含 `js/vendor/zxing.min.js`），不要只传 `index.html`：HTML 与 JS 版本错配会让页面静默失效。
- 上传后在 CDN 控制台刷新 `/` 与 `/index.html` 的全部副本（含 gzip/br 压缩副本）。CDN 会按 `Accept-Encoding` 分缓存，仅用 curl 无压缩头验证可能拿到旧版 HTML 而误判。
- 用**真实浏览器**验收：页面顶部不应出现红色「页面脚本未正常启动」横幅；填 A桶=10、B桶=5、瓶/件=24、件/托=20，入库瓶数应为 360 瓶、件数 15 件、托码 0 托 + 15 件；控制台无 JS 异常。
- `index.html` 里的 `<meta name="app-build">` 可用于快速确认入口是否是新版本。

## 数据与隐私

- 全部数据（历史记录）只写入当前浏览器的 `localStorage`，不发任何网络请求。
- 扫码（相机/相册）在浏览器本地用原生接口或本地 ZXing 识别，不截图、不上传任何图像、不请求任何外部资源。
- 清除浏览器站点数据即彻底删除；换设备/换浏览器不共享。
- 批号只作展示与历史记录，不关联任何云端订单或人员数据。

## 部署到 GitHub Pages

发布内容即本目录根下的 `index.html`、`css/`、`js/`：

1. 新建公开仓库，把 `mes-calc-web/` 目录内的文件放在仓库根目录（`index.html` 在根）。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
3. 保存后访问 `https://<用户名>.github.io/<仓库名>/`。纯静态、无需构建。
