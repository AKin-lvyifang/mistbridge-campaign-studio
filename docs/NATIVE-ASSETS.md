# 原游戏／模组素材预览：接入设计与验证边界

核查日期：2026-10-05。

**状态：已实现受限的本机只读原生素材预览切片；没有真实游戏素材实测。默认仍是原创示意美术。**

## 本次已实现（2026-10-05）

- 桌面目录选择器：只读索引所选目录的 DDS、SLD、DAT，以及仅索引的 SMX／SLP／DRS。浏览器不能提交任意主机路径；绝对目录只在 Electron 主进程与其自有本地服务之间传递。
- DDS：Pillow 12.3.0 解码单一 2D 顶层纹理，拒绝立方体、体积与数组纹理；实际编码若不被 Pillow 支持则明确报错。
- SLD：版本 4，第 0 帧主 BC1 图像、透明度、图层偏移和有符号画布锚点。其他帧与图层仅校验边界；阴影、玩家色、轮廓、损伤、方向、镜像、动画和子图形暂不渲染。详见 SLD-DECODER-NOTICE.md。
- DAT：固定 genieutils-py 0.1.2，先限量解压并检查版本；仅允许其声明支持范围内的 VER 7.7、7.8、8.4、8.8、8.9；更早的枚举值不代表解析器承诺支持，直接拒绝。当前自动化只验证合成 8.9 样本，不宣称其他版本已实测。解析文明 → 单位 → 首个站立图形 → 文件名；只在唯一同名 SLD 存在时判定找到文件，绝不假设单位编号等于文件编号。
- 地图：用户可把所选 SLD 静态帧用于选中对象同玩家／同单位编号的本次会话预览，按锚点贴地并使用现有前景地形遮挡。文明是手动预览配置，不改变场景玩家。方向、时代升级和复合图形不自动应用。
- DDS 可手动关联当前地形编号，采用实验性逐格纹理投影；这不是 DAT 地形自动映射，也没有还原地形混合、水面和海岸。
- 资源映射和图片完全独立于 Project：不写入自动保存、工程 JSON、场景或 ZIP，也不进入大模型上下文。断开目录会清除本次缓存；取消目录选择保留原会话。
- 提供 fixtures/synthetic-assets 内的原创人工 SLD／DDS／DAT，允许没有游戏安装时验证读取流程。这些色块图形不来自游戏，也不能证明真实游戏外观兼容。

实际入口：本地桌面应用顶部「本地素材」。源码启动先安装 requirements.txt，运行 npm run build，再运行 npm run desktop（不要设置 STUDIO_DEV_URL）。静态网页只展示说明，不能选择本机资源目录。

安全与性能边界：单文件 64 MiB；DAT 展开 256 MiB；SLD 4096 单边／4M 像素；DDS 8192 单边／16M 像素；扫描最多 120k 文件系统项目、60k 资源、12 层、15 秒；每次图片解码 15 秒／DAT 45 秒；串行隔离工作进程；POSIX 使用 0700 会话目录／0600 文件；Windows 在创建空缓存目录时原子设置仅当前用户与 SYSTEM 可访问的受保护 DACL，读取实际 ACL 验证后才写入资源，子进程输出继承此 ACL，缓存根目录在使用期间持有禁止删除共享的句柄以防改名替换，PNG LRU 上限 128 MiB；渲染器最多 16 个映射／16M 像素。图像每次按源内容哈希查缓存。POSIX 目录与祖先使用 no-follow 描述符链；Windows 文件用打开后句柄路径核对，Windows 目录扫描竞争窗口及实际运行仍未验收。硬杀进程可能留下仅本用户可读的临时缓存，正常关闭由临时目录清理。

本阶段只支持一个显式资源根，不组合游戏根与模组覆盖层。选择更小的单一目录可避免重复文件名歧义；完整安装目录的大小、当前游戏构建和图形选项仍需实测。

以下保留完整接入设计与未来验收要求；未在上列范围中的内容仍属于后续计划。

本文件在上述已实现切片之外描述下一阶段的完整本地资源适配方案。当前开发工作区没有用户提供的 SLD、SMX、DRS 或游戏 DAT 文件，尚未用实际安装版本验证资源解码。没有读取用户电脑、下载或捆绑原版游戏素材。

## 1. 为什么现在不是游戏画面

`.aoe2scenario` 提供地图、地形编号、单位编号、位置等场景数据；它不包含显示这些对象需要的全部贴图和精灵。现有渲染器用自己绘制的轮廓代替了资源加载。正确导入／导出场景，不等于已经导入游戏画面。

真正的静态原生素材预览在技术上可行。需要补齐的管线是：

1. 用户明确选择自己的游戏资源或许可模组目录。
2. 识别 DE／HD／原版及数据版本，索引文件和哈希。
3. 从 DAT 解析文明、单位、图形和地形之间的引用。
4. 按需解码精灵、贴图、阴影及玩家色，保留锚点。
5. 生成本机专用的 PNG／RGBA 缓存和元数据，再交给地图视口。

这不要求把编辑器改造成游戏引擎，也不要求用生成式图片仿造素材。原生素材可以让建筑和单位直接呈现游戏外观；地形坡面、过渡、遮挡仍需单独实现和对照验证。

## 2. 版本不能混用

| 目标 | 资源特点 | 适配要求 |
| --- | --- | --- |
| 近期 AoE2 DE | SLD 精灵；地形常见 DDS；DAT 提供图形文件名、动画和文明映射 | SLD + DDS + 当前 DAT 版本适配 |
| 早期 DE／部分模组 | 可能包含 SMX 或 SLP；SMX 使用调色板 | 按文件签名识别，加载对应调色板 |
| AoE2 HD | 松散 SLP、PNG 地形、不同 DAT 和目录布局 | 独立 HD 配置，不当成近期 DE |
| 原版／征服者 | DRS 容器中的 SLP、调色板，传统地形混合数据 | DRS 解包、SLP、blendomatic 独立适配 |

SLD 自 DE Build 66692 引入，区别于基于索引调色板的 SLP／SMX。图形层使用 BC1，阴影和玩家色蒙版使用 BC4；玩家色还需要正确的颜色映射。格式包含帧、图层和锚点，而不只是独立图片。[SLD 格式说明](https://github.com/SFTtech/openage/blob/master/doc/media/sld-files.md)、[SMX 格式说明](https://github.com/SFTtech/openage/blob/master/doc/media/smx-files.md)

传统地形的 DRS／blendomatic 研究可以参考，但不能把它直接宣称为 DE 地形效果的完整规范。[DRS](https://github.com/SFTtech/openage/blob/master/doc/media/drs-files.md)、[传统地形](https://github.com/SFTtech/openage/blob/master/doc/media/terrain.md)、[blendomatic](https://github.com/SFTtech/openage/blob/master/doc/media/blendomatic.md)

## 3. 需要选择哪些文件

### 完整本地接入的首选入口

用户选择实际游戏安装目录。Windows Steam 安装的常见目录名是 `AoE2DE`，但不要硬编码盘符，也不要依赖推测的 Mac `.app` 包路径。先识别用户选择目录内的实际文件；自定义 Steam 库、Mac 包装和模组结构均需实测。

近期 DE 的候选相对路径：

| 路径 | 用途 |
| --- | --- |
| `resources/_common/dat/empires2_x2_p1.dat` | 单位、文明、图形与地形元数据 |
| `resources/_common/drs/graphics/` | SLD／SMX／SLP 精灵 |
| `resources/_common/terrain/textures/` | 地形纹理 |
| `resources/_common/palettes/palettes.conf` 及其引用的文件 | 调色板及玩家色 |
| `resources/<语言>/strings/key-value/key-value-strings-utf8.txt` | 可选的名称和说明 |

这些路径来自现有转换器配置，不构成对每个发行平台／构建的兼容承诺。[openage 游戏配置](https://github.com/SFTtech/openage/blob/master/cfg/converter/games/game_editions.toml)

目录名称含 `drs` 不表示其中每个文件都还是 DRS 容器。应依据实际文件和签名决定读取方式。

### 最小验证样本

分两步可以避免要求用户复制整个游戏：

1. **解码证明：** 一份用户有权使用的 `.sld` 精灵，优先选含阴影、玩家色的建筑；另选一个地形 `.dds`。保留原始文件名。单独 SLD 足以验证主图像、尺寸和锚点解码，但不足以自动判断它属于哪个场景单位。
2. **场景映射证明：** 同一构建的 `empires2_x2_p1.dat`，第一步文件，相关调色板，以及一张小场景和游戏内对照截图。先解析 DAT，生成这张场景实际所需文件清单，再选择缺少的精灵／地形文件；不要凭印象指定建筑精灵文件名。

建议首个映射样本只含一种文明、一个时代、一座建筑、一个可旋转单位、一棵树、两种相邻地形及一段缓坡。另记游戏构建号、标准／增强图形选项、启用模组和图形模组优先顺序。整个样本不需要游戏可执行文件、账号凭据或 API 密钥。

**推荐让转换在用户本机运行。** 若要在云端研究用户提供的样本，应由用户明确选择文件和用途；本方案不自动上传原始资源、缓存或截图，也不将它们发给 LUI 模型。

### 模组目录

允许选择一个独立模组根目录，按相对路径覆盖基底资源，并显示每个文件的来源。纯图形模组通常只含替换项，不能假定它包含游戏的全部资源。带 DAT 的数据模组还可能改变单位和图形编号。

初版应明确支持“基底＋一个显式模组”；以后才扩展到多个有序覆盖层。不要把文件系统遍历顺序当成游戏模组优先级。

## 4. 解码器选择

| 部分 | 候选 | 为什么适合／仍缺什么 |
| --- | --- | --- |
| DE DAT | `SiegeEngineers/genieutils-py` | Python 实现，适合现有本地 Python 服务；LGPL-3.0。0.1.2 发布说明增加 FileVersion 8.9。必须读取实际版本并拒绝未支持版本 |
| SLD | openage 的 SLD 读取实现 | GPL-3.0-or-later，可作为本项目 GPL-3.0 集成的候选；保留版权头、许可证和修改说明。Cython 实现需要构建／打包验证 |
| 旧 SLP／SMX／DRS | openage 或 `sandsmark/genieutils` | 后者 LGPL-3.0，支持相应旧格式；不能因 README 提到 DE 就认定其支持当前 SLD |
| DDS→RGBA／PNG | Pillow | 官方文档明确列出 DDS 解码支持；读取文件头确定实际压缩类型，遇到不支持的格式给出错误，不能默默替换 |

来源：[genieutils-py](https://github.com/SiegeEngineers/genieutils-py)、[版本发布记录](https://github.com/SiegeEngineers/genieutils-py/releases)、[SLD 读取源码](https://github.com/SFTtech/openage/blob/master/openage/convert/value_object/read/media/sld.pyx)、[openage 许可](https://github.com/SFTtech/openage/blob/master/copying.md)、[genieutils](https://github.com/sandsmark/genieutils)、[Pillow DDS 文档](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html#dds)、[Pillow 许可](https://github.com/python-pillow/Pillow/blob/main/LICENSE)

集成前需要固定依赖版本／提交，并随分发包提供所需许可证与对应源代码。这些是代码依赖选择，不会把游戏素材转为 GPL 或获得素材再分发权。

### 不能遗漏的源码细节

- openage 当前 SLD 实现仍有轮廓层 TODO；不要声称所有图层和效果已还原。
- SLD 实际层标志使用 `0x01` 主图、`0x02` 阴影、`0x04` 轮廓、`0x08` 损伤、`0x10` 玩家色。图层复用前帧的标志是 `0x80`。文档中的位编号容易误读，应以源代码和固定样本共同核验。
- 想只显示一个静态帧，仍可能需要解码它依赖的前帧。直接跳到任意帧的压缩块不一定正确。
- **openage 并未替我们完成 DE 地形接入。** 其 DE 转换器仍标记地形导出 TODO，通用媒体导出器对 DDS 显式抛出未实现错误；所以要另接 DDS 解码和地形绘制。[DE 媒体转换](https://github.com/SFTtech/openage/blob/master/openage/convert/processor/conversion/de2/media_subprocessor.py)、[媒体导出器](https://github.com/SFTtech/openage/blob/master/openage/convert/processor/export/media_exporter.py)
- 官方 `DESpriteTool` 用于将 PSD 制作成 SLD，是原创模组美术的制作路线；它不等于完整的游戏资源提取／地图渲染库。[官方 Update 93001](https://www.ageofempires.com/news/age-of-empires-ii-definitive-edition-update-93001/)

## 5. 编号映射与预览接口

不能使用 `单位编号 = 图片文件名` 的假设。推荐的解析链是：

`场景玩家 → 文明／视觉状态 → DAT 单位 → 站立图形 → DAT 图形文件名 → SLD → 帧与图层`

DAT 图形包含 `file_name`、`frame_count`、`angle_count`、`mirroring_mode`、图层和图形增量；单位包含站立图形和碰撞尺寸。DE 转换器使用图形文件名加 `.sld` 找文件。复合建筑／图形还需处理子图形偏移。[图形结构](https://github.com/SiegeEngineers/genieutils-py/blob/main/src/genieutils/graphic.py)、[单位结构](https://github.com/SiegeEngineers/genieutils-py/blob/main/src/genieutils/unit.py)

地形索引应保留替代地形、混合顺序、混合类型及覆盖蒙版；不能只把 0、1、2 映射成固定颜色或推测的文件名。[地形结构](https://github.com/SiegeEngineers/genieutils-py/blob/main/src/genieutils/terrainblock.py)

现有工程模型仅有玩家编号，没有完整的文明／时代视觉配置。下一阶段须从原生场景提取这些信息，或提供清楚标注的预览配置；预览选择不能静默改变导出场景的玩家数据。

下列接口是**设计示例，不是现有 API**：

```ts
interface AssetProfile {
  id: string;
  edition: 'aoe2de' | 'aoe2hd' | 'aoc';
  gameBuild?: string;
  datVersion: string;
  datSha256: string;
  graphicsResolution: 'standard' | 'enhanced' | 'unknown';
  sourceLayers: { id: string; label: string; priority: number }[];
  decoderVersion: string;
}

interface StaticSpriteFrame {
  graphicId: number;
  frameIndex: number;
  angleIndex: number;
  atlasKey: string;
  rect: [number, number, number, number];
  hotspot: [number, number];
  sourceCanvasSize: [number, number];
  shadowKey?: string;
  playerColorMaskKey?: string;
  sourceSha256: string;
}

interface RenderBinding {
  unitId: number;
  civilizationId: number;
  visualState: string;
  graphicId: number;
  footprintTiles: [number, number];
  childGraphics: { graphicId: number; dx: number; dy: number }[];
}

interface PreviewCoverage {
  resolvedObjects: number;
  totalObjects: number;
  resolvedTerrainTypes: number;
  totalTerrainTypes: number;
  missing: { kind: string; id: number; reason: string }[];
}
```

转换器输出可直接被浏览器使用的 PNG 图集和 JSON 元数据。桌面版负责读取所选目录；浏览器版可在用户选择后导入转换包。浏览器不需要直接运行游戏，也不需要访问任意磁盘路径。

接入后仍应显示具体覆盖率。部分缺失时使用明显的缺失资源符号并允许查看原因，不悄悄用示意树木代替原生树木后标成“游戏画面”。通用 PNG 图集导入只是转换包接口，不应被命名成“已支持游戏目录导入”。

## 6. 高度的真实含义

官方 2025 年补丁预告的 Scenario Editor 部分明确将可选高度从 7 扩展至 16；正式 Update 141935 页面链接该完整预告。这支持近期 DE 编辑器中的 16 级选项，并不证明所有旧版本、HD 或自定义文件都相同。[官方完整变更](https://www.ageofempires.com/news/a-sneak-peek-at-new-content-coming-to-age-of-empires-ii-definitive-edition/)、[正式 141935 发布](https://www.ageofempires.com/news/age-of-empires-ii-definitive-edition-update-141935/)

本项目的 DE 1.59 解析依赖将每格 elevation 存为无符号 8 位数，默认 0。**字段能够保存更大数值，不等于游戏支持把它们作为合法高度。** 当前应用编辑范围仍是 0–16；0 是本项目采用的平地基线，单位为级，不是米。现有原生回读测试只证明这些数值写入后仍相同，不能代替目标构建的游戏实测。

界面必须同时区分：

- **编辑范围：** 固定 0–16 级。
- **本图最低／最高：** 从全部格子计算，随编辑更新。
- **当前格／目标笔刷高度：** 数值和位置反馈。
- **视觉起伏：** 坡面明暗、等高线和图例；缩放或视觉强调不能改写原生高度。

平地图应显示“最低 = 最高”，不要用自动归一化色带制造并不存在的高差。坡面插值是预览算法；其坡形和对象贴地行为仍需与游戏对照。

## 7. 验证顺序与完成条件

### 没有游戏素材时就能完成

1. 实现有界的文件探测、路径与文件头校验、版本错误及缺失列表。
2. 使用项目自有的合成测试文件验证帧边界、透明度、锚点和解码失败行为。
3. 验证 JSON＋PNG 预览包契约、取消导入、重新导入、缓存失效和内存上限。
4. 改善现有高度图例、坡面、选择反馈和可读性。

这些检查通过只能说明管线基础有效；没有实际素材时不得声称原游戏外观已验收。

### 必须使用用户有权使用的同版本样本

1. 记录 edition、游戏构建、DAT 版本、图形分辨率、文件哈希、转换器版本。
2. 解码一座建筑和一个单位，检查尺寸、透明边缘、脚下锚点、阴影和两种玩家色。
3. 检查多方向／镜像，尤其是朝向边界；比较静态帧而不是任意动画瞬间。
4. 验证 DAT 单位→图形→文件的映射，确保换文明／时代时不会误用建筑外观。
5. 检查两种地形接缝、海岸与坡面；把未还原的混合／水面效果明确标记出来。
6. 创建 0、1、7、8、16 级的平台及连续坡道，核对最低／最高、对象贴地、点击命中和等高线。
7. 导出，在实际目标游戏打开，截图对照坐标、朝向、玩家色、坡面和遮挡。
8. 以实际纹理在大地图和平移缩放场景测量帧时间及纹理内存，不把色块渲染性能当成原素材性能。

### 静态原生预览不承诺的内容

不运行 AoE2 战斗、寻路、AI、触发器、迷雾规则或单位行为。精灵和纹理读取成功也不自动还原全部水面、粒子、损伤、桥梁、城墙连接、建筑复合层和特殊遮挡。最终玩法与复杂画面仍以目标游戏测试为准。

## 8. 本地资源与发布边界

- 仅读取用户明确选择的资源根目录，不修改游戏安装或订阅模组。
- 转换缓存留在本机；项目导出只保存逻辑编号和资源配置摘要，默认不含原版图像／DAT。
- 不将游戏资源放入 Git、公开站点、源码包、CI 测试夹具或普通工程 ZIP。
- 模组素材保留作者和来源；下载得到模组不自动等于获准再次发布其美术。
- 按源文件哈希、构建、模组顺序、解码器版本缓存，游戏更新后失效重建。
- 解码在隔离进程／Worker 中执行，限制文件大小、像素总量、帧数、执行时间和图集内存；拒绝目录越界、压缩包路径穿越和异常文件。
- 若以后增加素材分享或打包发布，应作为独立的明确操作，并检查相应素材授权。



## 跨平台预算与缓存修复（2026-10-06）

实际 CI 发现：Windows 的 chmod 并不表达 POSIX 权限位；macOS 资源解码进程在无保护的 resource.setrlimit 启动阶段退出。Linux 同一快照通过。Windows 桌面流水线还因 PowerShell 最后一个原生命令的成功退出码掩盖了前面的测试失败。

当前修复保留各层限制：Linux 的 1.5 GiB 虚拟地址空间硬限制；macOS 改用 1.5 GiB 峰值驻留内存 watchdog（每 50ms 检查，并在解析前后检查），避免把系统预留的虚拟地址空间当作资源实际内存占用。Unix CPU 与文件输出限制逐项应用，某一项不可用不会跳过其他项，也不提高继承来的更低限额。各平台原有文件／展开体积／像素／结构数量限制与 15/45 秒父进程截止时间仍生效。Windows 没有声称新增内核内存限额，依靠这些格式分配边界和父进程截止时间。watchdog 是进程级事后检查，不等同于内核预分配硬上限；可测量性中断时直接终止工作进程。

Windows 缓存不再把 chmod 0700/0600 当作隐私证明。新目录使用显式安全描述符创建；只允许当前用户和 SYSTEM 的完整访问，禁止继承其他主体权限，文件继承限制。在读回校验前固定根目录的非删除共享句柄，拒绝符号链接／重解析点，并保持至清理开始，防止可写临时目录父项改名替换缓存根。创建、固定或读回校验失败则拒绝使用缓存。测试在 Windows 上用独立的 PowerShell/.NET ACL 读取核验真实权限和工作进程创建的文件继承。此边界不隔离同一用户的进程、管理员或 SYSTEM。

桌面 CI 每个 run step 只执行一个原生命令，避免后续成功覆盖前面的 npm／Python 失败。冻结运行时 smoke 输出不含路径或数据的 workerLimits 摘要，用于记录各平台实际启用的限制。修复后的 macOS／Windows 结果必须以新提交的 CI 为准；本地 Linux 通过不代表那些平台已通过。

依据：[Python 资源限制](https://docs.python.org/3/library/resource.html)、[Apple XNU RLIMIT_AS 实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_resource.c)、[Python Windows chmod](https://docs.python.org/3.12/library/os.html#os.chmod)、[Windows 原子目录安全描述符](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createdirectoryw)、[GitHub Actions 退出码](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#exit-codes-and-error-action-preference)。
