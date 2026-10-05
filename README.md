# 雾桥 · Campaign Studio

一个可以实际编辑地图、保存工程、编译真实 AoE II DE 场景的开源创作工作台。中文优先，采用游戏编辑器式停靠布局；网页 UI 与未来 macOS / Windows 桌面应用共享代码。

**版本 0.1.0 是功能原型。已验证 DE 1.59 样例文件读写，未进行游戏内验证。** 原创示意美术不等于游戏画面；离线规则生成不等于大语言模型。

## 已经能做什么

- 等距地图视口：平移、缩放、小地图导航、地形画笔、对象放置、选择/拖动/复制/删除、锁定与撤销/重做
- 22 种经固定目录核对的原生对象、12 种地形；原创示意预览，不包含微软素材
- 以种子生成河谷、山地关隘和海湾地图，保留道路与聚落；默认关卡「雾桥来信」为原创内容
- 编辑器工程 JSON 下载/打开与浏览器本地自动暂存；原生导入工程内保留完整原件
- 真正的 `.aoe2scenario` 导入/导出：固定普通 DE 1.59、36–480 方形地图，隔离进程读写并再次回读
- 计时对白、即时镜头切换、对象移动、胜利四种原生触发效果；保留导入场景已有触发器
- 离线剧情规则草案，先预览再应用；可手工编辑所有新节点
- 玩家级 `.per` 模板与同名 `.ai`、有限静态检查、可保存自定义脚本
- ZIP 导出：原生场景、AI 文件对、工程、诊断清单、中文导入说明

## 快速运行

要求 Node.js 22.12+（CI 使用 24）、Python 3.12。先克隆/解压本项目。

macOS / Linux：

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run dev
```

Windows PowerShell：

```powershell
npm ci
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev
```

打开 `http://127.0.0.1:5173`。启动器同时运行前端和 `127.0.0.1:8787` 原生服务，退出时按 Ctrl+C。默认只绑定本机。若只需网页编辑，可运行 `npm run dev:ui`；此模式不提供原生文件转换。

如果安装环境不需要 Electron，可在安装时设置 `ELECTRON_SKIP_BINARY_DOWNLOAD=1`；这不会影响网页核心与 Python 原生服务。不要把本地转换服务公开到互联网。

生产方式：

```sh
npm run build
.venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

此时通过 `http://127.0.0.1:8787` 使用已构建应用。Windows 请替换 Python 路径。

## 上手工作流

1. 默认打开原创「雾桥来信」。左侧选择地形或建筑/单位，点击地图绘制与放置。
2. V 选择；B 画笔；H 平移；空格+拖动平移；滚轮缩放；F 适合窗口；G 切换网格。
3. 点对象或左侧「场景」列表，在检查器改坐标、玩家、名称或锁定。
4. 底部「剧情触发」点节点编辑；「剧情助手」提供有限关键词规则草案，应用后可撤销。
5. 先保存工程，再点击「导出场景」。红色错误会阻止导出，警告请阅读。
6. 在游戏编辑器里使用 Open Scenario Folder 找到实际场景目录，放入 `.aoe2scenario` 后打开。
7. `.ai` 与 `.per` 需放入游戏 AI 目录，再在游戏编辑器中手动指定给电脑玩家；本版不会自动绑定。

Cmd/Ctrl+S 保存工程，Cmd/Ctrl+O 打开，Cmd/Ctrl+Z 撤销。文本输入框保留正常文本编辑快捷键。自动暂存是当前浏览器的便利缓存，请下载工程作为正式备份。大工程可能超过浏览器容量，底部/顶部会显示未暂存。

## 实现与验证边界

- **地图可视化：** Canvas2D 原创示意图；不是游戏引擎模拟、游戏贴图或像素级还原。
- **自然语言：** 规则模板，支持有限中英关键词。没有连接 LLM，没有偷偷上传工程，没有假装调用模型。未来可通过 `StoryGenerator` 接口接入。
- **剧情：** 节点时间从场景开始计算；移动下达命令后不会自动等待抵达。没有到达/阵亡分支、音频、完整战役容器、XS/DUC 编译。
- **导入：** 已有触发器作为不透明原生内容保留；UI 不反编译成高级剧情。重新导入已导出的场景会把这些触发器显示为「保留触发器」。
- **兼容性：** 只接收通过测试的普通 DE 1.59；拒绝未知版本/尾部/变体，未知或特殊对象保持锁定占位。不承诺 HD、RoR、Chronicles、模组或所有资料片。
- **桌面：** 已实现 Electron 原生菜单、自包含 Python 编译服务、稳定本地工程存储和双平台打包流程。Linux x64 冻结运行时已通过真实导入/导出测试。macOS（13+，Apple Silicon / Intel）及 Windows x64 安装包仍需对应 CI 验证，签名与公证未完成。详见 [桌面打包](docs/DESKTOP-PACKAGING.md)。
- **网页预览：** 静态预览仅支持工程编辑/保存与 AI 脚本，不调用原生服务；原生场景导入/导出必须在本地完整版本执行。

## 检查与性能

```sh
npm test             # TypeScript domain tests
npm run build        # Type check + Vite production build
npm run test:native  # Real native fixture roundtrips + HTTP security tests
npm run check        # All three
npm run benchmark    # Repeatable generation/validation timings
```

CI 配置在 Linux、macOS、Windows 上运行代码与样例检查，并分别为 macOS arm64/x64 与 Windows x64 构建未签名应用；仅仓库出现成功结果后才可说该平台验证通过。没有游戏运行器，也不会把 CI 结果误称为游戏验证。

真实测量及测试边界见 [验证报告](docs/VERIFICATION.md)、[生成基准 JSON](docs/benchmark.json)、[原生基准 JSON](docs/native-benchmark.json)。测量是当前机器上的实际结果，不能替代浏览器帧率或游戏性能。

## 工程结构

```text
src/                React UI、类型、领域逻辑、Canvas 等距视口
server/             FastAPI 本机接口、严格校验、单次原生子进程
fixtures/           公开空白样例、原创回归/示例场景与来源校验和
scripts/            启动、测试与真实基准
electron/          Electron 原生菜单与隔离 preload
docs/              设计系统、生成/原生边界、验证与发布清单
```

技术选择：React 19 + TypeScript、Radix Primitives、Lucide、Vite、Canvas2D、FastAPI/Pydantic 与固定 AoE2ScenarioParser 0.9.4。UI 设计参考 Apple HIG 与成熟游戏编辑器，具体 token、组件与平台约定在 [设计系统](docs/DESIGN-SYSTEM.md)。

## 许可证与归属

本项目按 **GPL-3.0-only** 发布，见 [LICENSE](LICENSE)。AoE2ScenarioParser 0.9.4 包元数据写 MIT，但实际附带 LICENSE 为 GPL-3.0；本项目按更严格的实际许可文件处理，记录冲突，未宣称已取得维护者澄清。固定版本、来源与 SHA-256 见 [fixtures/SOURCES.json](fixtures/SOURCES.json) 和 [第三方声明](THIRD-PARTY-NOTICES.md)。

原生数据 ID 只是引用。未附带微软游戏贴图、精灵、音效、用户游戏文件或第三方战役。Age of Empires 是其权利人的商标；本项目与 Microsoft、World's Edge、Forgotten Empires 无隶属关系。
