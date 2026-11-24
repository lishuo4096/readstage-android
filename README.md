# 墨声 ReadStage

Android Markdown 阅读、编辑、角色听读器，基于 MIT 开源项目 [mdreader-android](https://github.com/zero-made/mdreader-android) 扩展。应用 ID：`cn.readstage.app`，0.2.1 调试版，minSdk 26、targetSdk 35。

本次重构的界面、持续播放、逐句跟随与测试说明见 [0.2.0 更新记录](docs/UPDATE-0.2.0.md)。

最新小版本修复见 [0.2.1 更新记录](docs/UPDATE-0.2.1.md)。

## 开始使用

从 [Releases](https://github.com/lishuo4096/readstage-android/releases/latest) 下载 `ReadStage-0.2.1-debug.apk` 并安装。阅读与编辑无需 API。可先点击「体验示例」。

1. 在首页点击「打开文件夹」，选择存放 Markdown 的文件夹并授权；书架先显示文件夹卡片，点击进入才查看文件。Android 对存储根目录有限制，建议在 Documents 下建立子文件夹。
2. 工作区递归列出最多 500 个 Markdown／文本文件。切换文件、重新启动分别恢复每个文件的阅读位置。
3. 「编辑」支持源码、格式工具、撤销重做、查找替换和预览；自动保存本机草稿，点击「保存到文件」才写回原文件。只读文件保存失败时保留草稿。
4. 已授权工作区支持「新建 Markdown」。

浏览器保留上游 GFM 表格、任务列表、代码高亮、目录、搜索、代码复制、KaTeX、Mermaid、YAML 元数据卡片、字号与多主题。渲染库离线打包。支持工作区相对 Markdown 链接，以及 PNG/JPG/WebP/GIF 相对图片（单图最多 5 MB）；某些云文档提供者的非层级 URI 可能不支持相对资源。

## 配置听读

「听读设置」中选择服务，填写完整 API URL、模型与 Key，再保存。不同服务分别保存配置和加密密钥；切换服务前请保存。

| 服务 | 默认模型 | 协议 |
| --- | --- | --- |
| 小米 MiMo | mimo-v2.5-tts | chat/completions；assistant 原文、user 语气、audio 音色，Base64 WAV 响应 |
| 通义千问 | qwen3-tts-instruct-flash | DashScope multimodal-generation，下载签名音频 |
| 兼容服务 | gpt-4o-mini-tts | /audio/speech，WAV 音频字节响应 |

支持音色列表、自定义语气、试听、0.75–2 倍速、段落切换与进度拖动。音色清单每行格式 `ID|显示名|性别|特点`，请只填写当前模型支持的 ID；内置性别／特点标签仅作选角参考，可根据试听修正。千问语气控制需 instruct 模型；兼容服务需支持 instructions 字段。

首句生成后立即播放，后续采用六槽窗口、两路并发持续补缓存。临时 API 错误自动重试，永久请求错误直接提示。

听读按文档哈希、片段编号和片段内毫秒位置保存，每 1.5 秒更新。恢复时重新合成该段并定位，模型生成时长可能略有变化。编辑导致哈希变化后，旧听读位置与导演方案失效。代码块不朗读。

播放使用 Android mediaPlayback 前台服务、音频焦点和唤醒锁；支持后台与锁屏播放。强杀后从最近保存的位置恢复。连续合成依赖应用调度，极端省电策略可能中断，不承诺强杀后继续播放。

## AI 导演

文本模型和语音服务独立配置，可混用。文本服务必须兼容 chat/completions 和 JSON 响应；MiMo 默认文本模型为 mimo-v2.6-flash。

1. 在听读设置中填写文本模型 URL、模型与独立 API Key，保存并测试连接。
2. 打开文档，点击「导演 → 分析全文」。每批 12 段，携带相邻上下文和已有角色。
3. 模型识别角色、性别、性格与逐段语气，从音色清单选角。校验片段完整覆盖、角色和音色有效性；支持单个 ID、字符串编号及 from/to 闭区间；按原始 ID 检查覆盖，缺失时只补请求遗漏片段，必要时逐段修复，失败保留上次完整方案。
4. 在角色卡调整音色并试听；分段卡可改说话者和语气。显示前 300 个分段编辑卡，听读使用全部结果。
5. 勾选「开启 AI 导演听读」，返回文档播放。修改供应商、模型或音色清单后需重新分析。

角色识别是模型推断，支持人工复核。每个文件分别保存方案；当前尚未实现整个工作区统一角色库。长文会发起多次文本请求；取消可停止后续批次，已经提交的请求可能仍完成和计费。

## 数据与安全

文件使用 Android SAF，无全盘存储权限。密钥用 Android Keystore AES-GCM 加密，界面不回填密钥，禁用系统备份；源码和 APK 不内置测试密钥。

主动连接测试、试听、听读、导演分析才发送对应文本到配置服务。文档远程图片会请求其 URL。Markdown 经 DOMPurify 清洗，Mermaid strict 模式，CSP 禁止远程／内联脚本和 iframe。API 使用 HTTPS，不跟随重定向；千问音频下载不附带 API Key。

## 构建与验证

本机工具链：JBR 21、Android SDK 36、AGP 9.0.0、Gradle 9.1.0，无需 NDK。

```powershell
$env:JAVA_HOME = 'C:\Google\Android\Android Studio\jbr'
.\gradlew.bat :app:assembleDebug
node --test tests/core.test.cjs
```

本机 local.properties 配置 SDK 路径。构建产物位于 app/build/outputs/apk/debug/app-debug.apk。调试签名用于测试，正式分发前应配置发布密钥。

`tests/live_mimo.py` 从环境变量 MIMO_TEST_KEY 读取密钥，执行真实模型列表、TTS 与角色导演测试，产生 API 调用。`tests/device.cjs` 使用 ADB 转发的 WebView 调试端口验证设备交互；不传密钥只测试离线功能。实际结果见 [测试记录](docs/VALIDATION.md)。

## 复用来源

采用：[zero-made/mdreader-android](https://github.com/zero-made/mdreader-android)（MIT），提交 920130f4269a02a07e7e9360149ab8f712fb951c，2026-11-23 拉取。
理由：已有离线 Markdown、数学、Mermaid 与 SAF 文件夹浏览，且无外部 Android 运行依赖。
接入：保留 Java Activity、viewer 与资源，新增 ReaderBridge、PlaybackService、studio UI 和核心逻辑，修改读写权限、窗口 Insets、渲染安全。

对比过 Markor（Apache-2.0，改造范围较大）与 MD-view（MIT，偏纯浏览）。协议参考用户提供的 PC 项目 marktext-tts，未修改该工程。新增 DOMPurify 3.3.1，许可见 DOMPURIFY-LICENSE。其余资源许可保留于 THIRD_PARTY_LICENSES.md 与 LICENSE。

## 开源许可

本项目采用 [MIT License](LICENSE)，保留原作者及 ReadStage 修改部分的版权声明。上游来源见 [NOTICE.md](NOTICE.md)，随包渲染库的独立许可见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
