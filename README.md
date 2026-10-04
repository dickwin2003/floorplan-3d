# 户型装修设计

中文 | [English](README.en.md)

📘 **[使用说明（AI 生成器 · 上传设计图出 2D/3D）](使用说明.md)**

纯前端的户型装修设计工具：在 2D 平面图上摆放家具、拆改墙体、测量尺寸，一键切换到 Three.js 3D 场景，可以鸟瞰，也可以第一人称漫游。整个应用就是一个 `index.html`，无需构建，打开即用。

## 功能

**2D 平面布置**
- 按原始户型 1:60 / 1:100 比例显示，尺寸单位 mm
- 从左侧家具库拖入 60 余种家具家电（卧室、客厅、餐厨、卫浴、家电、书房休闲）
- 拖动移动、旋转（Shift 自由角度）、调整尺寸，贴墙自动吸附
- 测量工具（靠近墙面自动吸附，Shift 锁定水平 / 垂直）
- 拆改非承重墙，承重墙单独标示
- 图层开关：尺寸标注、房间名、家具、网格、承重墙

**3D 场景**
- 鸟瞰、斜视、俯视多种视角，点击房间列表可飞到对应房间
- 漫游模式：桌面端 WASD + 鼠标，触屏设备用虚拟摇杆，可以点门开关
- 全高墙 / 剖切墙切换，日照时间滑块，夜景灯光
- 精细家具模型：柜门分缝与拉手、软包床头、带环境反射的金属与陶瓷材质等
- 在 3D 中也能选中、拖动家具，与 2D 方案实时同步

**方案与统计**
- 房间面积与套内使用面积自动统计
- 为每个房间更换地面材料（木地板、地砖、大理石、水磨石、地毯等），按面积加 5% 损耗估算造价
- 撤销 / 重做，方案自动保存在浏览器本地
- 中文 / English 界面切换（顶栏右侧按钮，默认中文，选择会记住）
- 导出 PNG 图片，导出 / 导入方案 JSON

## 快速开始

```bash
git clone <仓库地址>
cd <仓库目录>
```

然后直接用浏览器打开 `index.html`。也可以起一个本地静态服务器：

```bash
python3 -m http.server 8000
# 访问 http://localhost:8000
```

> Three.js 通过 jsDelivr CDN 加载，首次打开 3D 场景需要联网。

## AI 生成器：上传设计图 → 出 2D / 3D（app.html）

`app.html` 是可交付的 Web 入口：**上传一张户型 / 平面设计图，AI 视觉模型解析为墙体、门窗、房间、家具数据，自动渲染 CAD 风格 2D 图纸与可交互的 3D 动态场景**，均可一键导出 PNG、下载方案 JSON（可手改后重新导入）。

- 纯静态站点，可部署到任意静态托管（GitHub Pages / Vercel / nginx）
- AI 接口在页面内配置（OpenAI 兼容格式，默认智谱 `glm-4.5v`，可换任意支持图片输入的模型），Key 仅存本机浏览器
- 直连遇 CORS 时：`node server.js`（零依赖）同时提供静态托管与 `/api/proxy` 转发
- 渲染引擎在 `plan-render.js`（`Plan2D` / `Plan3D` 两个类），示例数据在 `demo-plan.js`

```bash
python3 -m http.server 8000     # 或 node server.js（含 CORS 代理）
# 访问 http://localhost:8000/app.html        上传入口
# 访问 http://localhost:8000/app.html#demo   无 Key 直接看示例方案
```

## 示例：从设计图自动生成 2D / 3D（design.html）

`design.html` 是内置示例：以 `doc/1.jpg`（超帅豪华汉雅包间平面设计图）为原型，把户型反向解析成数据后，**打开页面即自动生成同一方案的 2D 设计图与 3D 动态场景**：

- 2D：CAD 风格平面图（墙体 / 门窗 / 家具 / 尺寸标注 / 图名），可滚轮缩放、拖动平移，一键导出 3200×2400 PNG
- 3D：Three.js 场景，开场飞入 + 自动旋转（可开关），鼠标 / 触屏自由旋转缩放，可导出 PNG
- Three.js 已本地化到 `lib/`，离线可用；`doc/` 内附带预生成的 2D / 3D 成品图

```bash
# 访问 http://localhost:8000/design.html        交互页面
# 访问 http://localhost:8000/design.html#3d     直接进入 3D 动态
# 访问 http://localhost:8000/design.html#full   整幅 2D 出图模式
```

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `T` | 切换 2D / 3D |
| `V` / `M` / `X` | 选择 / 测量 / 拆改墙体 |
| `R` / `Shift+R` | 选中家具顺时针 / 逆时针旋转 90° |
| `Delete` / `Backspace` | 删除选中家具 |
| `Ctrl/⌘ + D` | 复制选中家具 |
| `Ctrl/⌘ + Z`，`Ctrl/⌘ + Shift + Z` | 撤销，重做 |
| `F` | 适应窗口 |
| `+` / `-` | 放大 / 缩小 |
| `[` / `]` | 展开 / 收起左侧家具库、右侧面板 |
| `Shift + F` | 全屏 |
| `Esc` | 取消当前操作 |
| 漫游：`WASD` / 方向键，`Shift`，`E` | 移动，快走，开关门 |

## 技术栈

- 原生 HTML / CSS / JavaScript，无框架、无构建步骤
- 2D 平面图用 SVG 绘制
- 3D 场景用 [Three.js](https://threejs.org/) r160（OrbitControls、PointerLockControls、RoundedBoxGeometry、RoomEnvironment、CSS2DRenderer）
- 数据保存在 `localStorage`

## 自定义户型

户型数据写在 `index.html` 里：

- `ROOMS`：房间多边形、名称、默认地面材料
- `WALLS` / `WINS`：墙体与窗洞
- `MATS`：地面材料名称与单价
- `LIB`：家具库（类型、名称、默认尺寸、颜色）
- `buildFurniture()`：各类家具的 3D 模型

改这些数据就能换成自己的户型。

## 社交媒体

- X（Twitter）：[@akokoi1](https://x.com/akokoi1)

## 许可协议

[MIT](LICENSE)
