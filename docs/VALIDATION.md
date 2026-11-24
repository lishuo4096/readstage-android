# 验证记录

测试日期：2026-11-23（Asia/Shanghai）。最终交付版本：ReadStage 0.1.0，调试签名。

## 构建与核心逻辑

JBR 21、Android SDK 36、AGP 9.0.0、Gradle 9.1.0，离线 assembleDebug 成功。minSdk 26、targetSdk 35，纯 Java + 内置 WebView，无 JNI。

`node --test tests/core.test.cjs`：3 项通过，覆盖长文本无丢字／Unicode 边界、三种语音协议请求结构，以及导演对无效音色、遗漏／重复片段、未知说话者的拒绝。

## Android 15 实际运行

设备：`emulator-5582`，AVD `ReadStage_API_35`，Android 15，API 35，x86_64 Google APIs。镜像来自 Google 官方 `x86_64-35_r09.zip`，下载后 SHA-1 校验一致。另在 API 36.1 上做了初步离线验证。

已安装、启动并通过 WebView 设备交互测试：

- 离线 Markdown 表格、数学公式和 Mermaid 实际渲染。
- 源码编辑、写回文件、从磁盘重新加载后内容保留。
- 本机草稿恢复，包括空白草稿。
- 滚动位置保存和重新打开恢复。
- DOMPurify 清除事件属性，Mermaid strict 与页面 CSP 已启用。
- Android Keystore 保存语音和文本服务密钥。
- 真实 MiMo 导演分析、角色清单与逐段语气。
- 真实语音 API 合成，Android 前台服务实际播放，暂停并读取片段内时间。
- 按 Home 切到后台后，自动从第一段继续到第二段；检查时仍在播放，片段内时间约 11.4 秒。证据：`evidence/background-result.json`。

测试脚本：`tests/device.cjs`。设备自动化结果：`evidence/device-result.json`；导演界面截图：`evidence/device-webview.png`。

## 工作区单独检查

通过 Android 系统文件选择器选择测试目录 `Documents/ReadStageTest`，确认访问授权，随后测试：

- 正确列出 one.md 与 two.md。
- one.md 滚动到约 650 像素，并选择听读第 4 段。
- 切换 two.md 后再切回 one.md，恢复约 649.9 像素与片段索引 3。
- 在已授权目录中新建 created-by-test.md，编辑并写回；重新加载内容一致。

证据：`evidence/workspace-result.json`。脚本：`node tests/device.cjs workspace`，要求测试目录预先存在且已通过 SAF 授权。

## 真实 API 单独检查

用户提供的 MiMo 测试密钥仅通过进程环境变量或设备配置入口使用，没有写入项目文件或 APK。

PC 端真实返回模型列表、253,484 字节 RIFF/WAV 音频。文本模型 `mimo-v2.6-flash` 对女性林岚和男性老人给出性格描述、茉莉／白桦音色建议及不同语气。Android 15 内又通过独立原生网络桥完成导演与合成播放。

证据：`evidence/live-api-result.json`、`evidence/mimo-live.wav`。复现：设置环境变量 MIMO_TEST_KEY 后运行 `python tests/live_mimo.py`，会产生真实 API 调用。

千问和兼容语音入口已实现请求与响应适配，并通过结构测试；未提供对应服务密钥，未做真实服务验证。兼容供应商是否支持 instructions，以及自定义音色 ID，须由其实际协议确认。

## 范围与限制

这是可安装测试版本，没有做正式商店分发、发布签名、真实手机厂商省电策略、超大工作区或长时间压力测试。角色库按文档保存，尚无跨工作区整本统一选角。片段编辑卡显示前 300 段；听读使用全部有效方案。某些非层级云文档 URI 不支持相对资源。

导演识别属于模型推断，提供人工修正。取消分析阻止后续批次，已提交的请求可能仍完成。系统强制结束后恢复最近进度，不保证强杀后连续播放。
