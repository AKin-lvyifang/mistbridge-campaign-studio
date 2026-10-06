# 雾桥 · Campaign Studio

一个可以实际编辑地图、保存工程、编译真实 AoE II DE 场景的开源创作工作台。中文优先，采用游戏编辑器式停靠布局；网页 UI 与未来 macOS / Windows 桌面应用共享代码。

**版本 0.1.0 是功能原型。已验证 DE 1.59 样例文件读写，未进行游戏内验证。** 原创示意美术不等于游戏画面；离线规则草案与大模型编辑助手是两个独立功能。多供应商适配仅完成受控模拟 API 测试，尚未用用户真实账户验证。

## 已经能做什么

- 等距地图视口：平移、缩放、小地图导航、地形画笔、对象放置、选择/拖动/复制/删除、锁定与撤销/重做
- 22 种经固定目录核对的原生对象、12 种地形；原创示意预览，不包含微软素材
- 以种子生成河谷、山地关隘和海湾地图，保留道路与聚落；默认关卡「雾桥来信」为原创内容
- 编辑器工程 JSON 下载/打开与浏览器本地自动暂存；原生导入工程内保留完整原件
- 真正的 `.aoe2scenario` 导入/导出：固定普通 DE 1.59、36–480 方形地图，隔离进程读写并再次回读
- 计时对白、即时镜头切换、对象移动、胜利四种原生触发效果；保留导入场景已有触发器
- 离线剧情规则草案，先预览再应用；可手工编辑所有新节点
- 兼容 OpenAI Chat Completions 的大模型工具调用 LUI：绘制地形、设置原生高度、放置/移动/删除目录对象、种子地图生成与受支持的剧情编辑；先看差异，再确认应用，可撤销
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

打开 `http://127.0.0.1:5173`。启动器同时运行前端和 `127.0.0.1:8787` 原生服务，退出时按 Ctrl+C。默认只绑定本机。若只需网页编辑，可运行 `npm run dev:ui`；此模式不提供原生文件转换或大模型后端。

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
4. 底部「剧情触发」点节点编辑；「剧情助手」提供有限关键词离线规则草案。右侧「大模型助手」使用真实模型工具调用，需先按下方说明配置密钥；两种提案都可撤销。
5. 先保存工程，再点击「导出场景」。红色错误会阻止导出，警告请阅读。
6. 在游戏编辑器里使用 Open Scenario Folder 找到实际场景目录，放入 `.aoe2scenario` 后打开。
7. `.ai` 与 `.per` 需放入游戏 AI 目录，再在游戏编辑器中手动指定给电脑玩家；本版不会自动绑定。

Cmd/Ctrl+S 保存工程，Cmd/Ctrl+O 打开，Cmd/Ctrl+Z 撤销。文本输入框保留正常文本编辑快捷键。自动暂存是当前浏览器的便利缓存，请下载工程作为正式备份。大工程可能超过浏览器容量，底部/顶部会显示未暂存。

## 配置大模型供应商（仅本地会话）

1. 在完整桌面应用或同时运行本地服务的编辑器中，打开右侧「大模型助手」→ 连接设置。
2. 选择 DeepSeek / OpenAI 预设，或选择自定义兼容服务，填写供应商名称、HTTPS Base URL 和模型名。DeepSeek 只是一个预设；所有模型名都可修改。服务需支持 OpenAI Chat Completions 的工具调用协议，并非任意 API 密钥都兼容。
3. 核对界面显示的实际接收地址，再在遮罩输入框中填写该供应商新签发的 API 密钥。修改供应商时必须重新填写密钥，不会沿用旧密钥。不要粘贴进聊天、源代码或工程。提交后输入框清空；配置和密钥仅保存在本地服务内存中，退出服务或断开即清除。
4. 输入编辑要求。模型返回的工具命令先形成预览，查看地形/高度/对象/剧情差异后再应用，可撤销。工程或供应商会话变化会使旧提案失效；更换供应商会清空旧对话，避免旧内容发给新服务。

Base URL 填供应商文档里的完整 API 前缀：如 `https://api.openai.com/v1`，后端只追加 `/chat/completions`，不会自动添加或删除 `/v1`。DeepSeek 预设使用 `https://api.deepseek.com`。不要填写完整 `/chat/completions` 路径，也不要在 URL 中放入密钥、查询参数或用户名密码。本版只连接公共互联网 HTTPS 服务，拒绝 localhost、内网、链路本地及云元数据地址；DNS 解析结果会固定到通过校验的公网 IP，并保留原始域名的 TLS 校验，阻止 DNS 重绑定。禁用重定向与环境代理，不支持本地或私有模型地址。

发送消息会将近期对话及明确限定的工程摘要发送给所选供应商：地图尺寸、地形统计、至多 12×12 个采样格、最多 150 个对象（优先当前选择）与 40 个剧情节点的必要字段。名称和对白可能随摘要发送；不会上传完整地图网格、原生场景副本、自定义 PER 脚本或其他本地文件。密钥只在后端用于向确认过的 HTTPS 地址认证，不进入模型对话。连接设置成功只表示本地保存成功，未验证账户连通性。界面提供发送前说明。

当前没有持久保存密钥选项，不提供模型脚本执行或自主后台编辑。停止按钮取消请求；未点击应用的提案不会改变工程。更多约束、调用预算、API 合约与验证边界见 [模型供应商集成说明](docs/MODEL-PROVIDERS.md)。 已实现受限的本机 DDS／SLD／DAT 实验性静态预览，范围与缺失效果见 [本地游戏素材方案](docs/NATIVE-ASSETS.md)；仅用原创合成资源验证，尚未进行真实游戏素材实测。

## 实现与验证边界

- **地图可视化：** Canvas2D 原创示意图；不是游戏引擎模拟、游戏贴图或像素级还原。
- **离线剧情草案：** 有限中英关键词规则模板，保留 `StoryGenerator` 接口；不会联网。
- **大模型 LUI：** 后端支持 OpenAI 兼容 Chat Completions 工具调用，提供 DeepSeek / OpenAI 预设与自定义公共 HTTPS 地址、模型名。只允许九种有界、类型化的编辑工具，不执行模型代码或脚本。模型工具结果先暂存为提案，并反馈给模型继续对话；本地独立校验并显示精确参数和地图差异，点击应用才改变工程。删除/替换需额外勾选确认，过期提案无法应用。模拟 API 测试通过不等于真实账户连通性或游戏验证。
- **剧情：** 节点时间从场景开始计算；移动下达命令后不会自动等待抵达。没有到达/阵亡分支、音频、完整战役容器、XS/DUC 编译。
- **导入：** 已有触发器作为不透明原生内容保留；UI 不反编译成高级剧情。重新导入已导出的场景会把这些触发器显示为「保留触发器」。
- **兼容性：** 只接收通过测试的普通 DE 1.59；拒绝未知版本/尾部/变体，未知或特殊对象保持锁定占位。不承诺 HD、RoR、Chronicles、模组或所有资料片。
- **桌面：** 已实现 Electron 原生菜单、自包含 Python 编译服务、稳定本地工程存储和双平台打包流程。Linux x64 冻结运行时已通过真实导入/导出测试。macOS（13+，Apple Silicon / Intel）及 Windows x64 安装包仍需对应 CI 验证，签名与公证未完成。详见 [桌面打包](docs/DESKTOP-PACKAGING.md)。
- **网页预览：** 静态预览仅支持工程编辑/保存、离线剧情与 AI 脚本；不会发出 LUI API 请求，也不接受密钥。大模型请求和原生场景导入/导出需本地完整版。

## 检查与性能

```sh
npm test             # TypeScript domain, terrain and LUI command tests
npm run build        # Type check + Vite production build
npm run test:native  # pytest: native roundtrips, HTTP security, provider MockTransport + pinned-transport tests
npm run check        # All three
npm run benchmark    # Repeatable generation/validation timings
```

原生测试入口使用 pytest 收集所有 tests/test_*.py，同时兼容原有 unittest 测试；供应商测试只使用假凭据、受控 MockTransport 与模拟 DNS/TLS I/O，不访问真实 API。

CI 配置在 Linux、macOS、Windows 上运行代码与样例检查，并分别为 macOS arm64/x64 与 Windows x64 构建未签名应用；仅仓库出现成功结果后才可说该平台验证通过。没有游戏运行器，也不会把 CI 结果误称为游戏验证。

真实测量及测试边界见 [验证报告](docs/VERIFICATION.md)、[生成基准 JSON](docs/benchmark.json)、[原生基准 JSON](docs/native-benchmark.json)。测量是当前机器上的实际结果，不能替代浏览器帧率或游戏性能。

## 工程结构

```text
src/                React UI、类型、领域逻辑、Canvas 等距视口
src/lui/            多供应商大模型对话、纯命令预览/应用引擎与本地设置
server/             FastAPI 本机接口、严格校验、单次原生子进程、多供应商会话代理与公网 IP 固定传输
fixtures/           公开空白样例、原创回归/示例场景与来源校验和
scripts/            启动、测试与真实基准
electron/          Electron 原生菜单与隔离 preload
docs/              设计系统、生成/原生边界、验证与发布清单
```

技术选择：React 19 + TypeScript、Radix Primitives、Lucide、Vite、Canvas2D、FastAPI/Pydantic 与固定 AoE2ScenarioParser 0.9.4。UI 设计参考 Apple HIG 与成熟游戏编辑器，具体 token、组件与平台约定在 [设计系统](docs/DESIGN-SYSTEM.md)。

## 许可证与归属

本项目按 **GPL-3.0-only** 发布，见 [LICENSE](LICENSE)。AoE2ScenarioParser 0.9.4 包元数据写 MIT，但实际附带 LICENSE 为 GPL-3.0；本项目按更严格的实际许可文件处理，记录冲突，未宣称已取得维护者澄清。固定版本、来源与 SHA-256 见 [fixtures/SOURCES.json](fixtures/SOURCES.json) 和 [第三方声明](THIRD-PARTY-NOTICES.md)。

原生数据 ID 只是引用。未附带微软游戏贴图、精灵、音效、用户游戏文件或第三方战役。Age of Empires 是其权利人的商标；本项目与 Microsoft、World's Edge、Forgotten Empires 无隶属关系。


## 本地原生素材预览（实验性）

桌面版「本地素材」可只读扫描你有权使用的游戏／模组目录，按需预览 DDS 纹理和 SLD 第 0 帧，并从受支持的 DE DAT 解析文明／单位／站立图形引用。默认仍使用原创示意美术；原生资源不会上传、发给模型或混入工程导出。没有游戏安装时可选 `fixtures/synthetic-assets` 体验完整流程，其中只有原创合成测试资源。

SLD 仅主 BC1 图像，尚不还原阴影、玩家色、损伤、方向、动画、时代升级或子图形。DDS 地形关联是手动实验性平铺，尚无自动 DAT 地形绑定或游戏混合蒙版。目录、图片与地图外观映射只保留当前会话。实际安装资源与游戏内效果仍未验证；详见 [原生素材范围与安全限制](docs/NATIVE-ASSETS.md) 和 [SLD 来源／许可](docs/SLD-DECODER-NOTICE.md)。

源码桌面启动：安装固定 Python 与 npm 依赖后，运行 `npm run build`、`npm run desktop`；目录选择要求桌面自有服务，不适用于 `STUDIO_DEV_URL` 的浏览器调试模式。打包包含固定 Pillow、genieutils-py、各许可证以及 LGPL DAT 库的哈希校验对应源码。
