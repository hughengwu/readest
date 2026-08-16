# PROJECT_STATUS.md

> 本文件由 AI 助手根据 `git log`/`git status`/代码实际状态生成，记录的是「Android 端离线中文神经网络 TTS」这一子功能的开发状态（截至最近一次提交 `abf395e2b`）。仓库其余部分（阅读器主体、词典、PDF 等）不在本次盘点范围内。

## 1. 项目背景与目标

- **readest**：一个基于 Tauri 的跨平台电子书阅读器（桌面 + Android + iOS），仓库为 `hughengwu/readest`（`hughengwu/readest` 是 fork，上游为 `readest/readest`）。
- **本次子任务的起因**：用户反馈"目前 Android 端本地朗读效果非常差"——查明后发现 Android 的"本地"TTS（`tauri-plugin-native-tts`）只是透传系统自带 TTS 引擎（`android.speech.tts.TextToSpeech`），没有内置任何高质量语音模型，效果完全取决于用户手机预装了什么引擎。
- **目标**：在 App 内直接嵌入一个高质量、完全离线运行的神经网络 TTS 引擎，重点解决中文 / 中英混排文本的朗读自然度问题，不依赖联网或云端服务，也不要求用户额外安装其他 App。
- **技术选型**：sherpa-onnx（k2-fsa，Apache-2.0）+ `vits-melo-tts-zh_en` 模型（MIT，MyShell.ai）。详见下节。

## 2. 当前进展

### 已完成并推送到 `origin/main` 的内容

- **新 Tauri 插件** `apps/readest-app/src-tauri/plugins/tauri-plugin-offline-tts/`
  - Rust 桥接层：`src/{lib.rs,mobile.rs,desktop.rs,commands.rs,models.rs,error.rs}`、`build.rs`、`Cargo.toml`（结构照抄 `apps/readest-app/src-tauri/plugins/tauri-plugin-native-tts/` 的写法）
  - Android/Kotlin 层：`android/src/main/java/com/readest/offline_tts/OfflineTTSPlugin.kt`（插件主体，命令：`init`/`synthesize`/`get_all_voices`）+ 官方 vendor 的 `android/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt`（sherpa-onnx v1.12.0 官方 Kotlin JNI 封装，**必须**放在这个包路径下，因为预编译 `.so` 里硬编码了 JNI 符号名 `com/k2fsa/sherpa/onnx/...`，改包名会导致 `UnsatisfiedLinkError`）
  - 预编译 `.so`：`android/src/main/jniLibs/{arm64-v8a,armeabi-v7a,x86,x86_64}/`，vendor 自 sherpa-onnx v1.12.0 官方 release（`sherpa-onnx-v1.12.0-android-static-link-onnxruntime.tar.bz2`），总计约 83MB
  - 模型资源：`android/src/main/assets/offline-tts/vits-melo-tts-zh_en/`，约 71MB。**注意**：官方 release 包里的 `model.int8.onnx` 其实是个损坏的 git-lfs 占位符（133 字节），实际文件是从 HuggingFace 镜像 `csukuangfj/vits-melo-tts-zh_en` 单独下载并核对过 SHA256（`f085f5...`）的，53,517,430 字节
  - `android/consumer-rules.pro`：给消费方（app 模块）R8 混淆传递 `-keep class com.k2fsa.sherpa.onnx.** { *; }` 规则（防止 JNI 反射读取的字段被改名）
- **TypeScript 层**
  - `apps/readest-app/src/services/tts/providers/offlineTts.ts` —— `SpeechProvider` 实现，负责 `invoke('plugin:offline-tts|...')` 调用与 base64 音频解码
  - `apps/readest-app/src/services/tts/OfflineTTSClient.ts` —— `BufferedTTSClient` 的薄子类（模式照抄 `EdgeTTSClient.ts`），存在的意义除了持有 `'offline-tts'` client 名字外，也是为了让它能像 `EdgeTTSClient`/`NativeTTSClient` 一样被测试文件整体 mock（否则测试会意外拉入真实的 `BufferedTTSClient` 依赖图，导致无关测试失败）
  - `apps/readest-app/src/services/tts/TTSController.ts` —— 新增 `ttsOfflineClient`/`ttsOfflineVoices` 字段，接入 `init()`/`getVoices()`/`setVoice()`/`setPrimaryLang()`/`shutdown()` 各处，Android-only（`appService?.isAndroidApp`）
- **测试**：新增 `apps/readest-app/src/__tests__/services/tts-offline-provider.test.ts`（provider 行为），并在 6 个既有测试文件里补了 `OfflineTTSClient` mock（`tts-controller.test.ts`、`tts-controller-timeline.test.ts`、`tts-controller-detach.test.ts`、`tts-controller-lifecycle.test.ts`、`tts-proofread-doc-sync.test.ts`、`tts/media-overlay-controller.test.ts`、`tts-auto-advance.browser.test.tsx`）。全量 JS/TS 单测本地跑通（9000+ 用例，失败的个位数用例均为环境问题，见第 3 节）
- **CI**：新增两个按需触发（`workflow_dispatch`）、免密钥的构建工作流，用于在没有上游发布密钥的 fork 上产出可安装测试包：
  - `.github/workflows/debug-apk.yml` —— debug 构建（未优化，体积大但保留完整调试符号）
  - `.github/workflows/release-apk.yml` —— release 构建（优化+strip+R8 混淆，体积小很多），用 CI 里临时生成的**一次性自签名密钥**签名，**不能**用于正式分发

### 关键技术决策及理由

- **走 `SpeechProvider`/`BufferedTTSClient` 而不是 `TTSClient`**：sherpa-onnx 是"整段文本进、整段音频出"的合成方式，天然契合 `SpeechProvider.synthesize()` 签名，可以直接复用 `BufferedTTSClient` 已经写好的调度/WSOLA变速/播放/词边界追踪逻辑，和 `EdgeTTSClient` 的实现方式一致。
- **Kotlin+JNI 直接 vendor 预编译库，不用 Rust 绑定**：sherpa-onnx 官方 Android 交付物就是预编译 `.so` + Kotlin 封装，成熟稳定；Rust 绑定（`sherpa-rs`）在 Android 上的交叉编译支持不成熟，`sherpa-rs` 本身也已标注被官方 crate 取代。
- **只做中英混排一个模型（`vits-melo-tts-zh_en`），首批不做多音色**：按用户要求收窄范围，先验证效果和体积再决定要不要加更多模型。
- **模型直接打包进 APK，不做运行时下载**：用户明确要求（担心大陆用户下载模型文件不稳定），代价是显著增加安装包体积（详见下方体积数据）。

## 3. 已知的坑与解决方案

- **本地开发环境（Windows）缺 Rust/Java/Android SDK 工具链**：本地无法跑 `cargo`/`clippy`/`tauri android build`，所有 Android 构建验证都是通过新增的 GitHub Actions workflow 完成的，不是本地完成的。
- **子模块未初始化**：仓库大量依赖 git submodule（`packages/foliate-js`、`packages/tauri`、`packages/tauri-plugins`、`packages/tao`、`packages/js-mdict`、`packages/simplecc-wasm`、`packages/qcms`、`apps/readest-app/src-tauri/plugins/tauri-plugin-turso`、`tauri-plugin-webview-upgrade` 等），全新 clone 默认不会初始化，需要 `git submodule update --init <path>`。CI 的 `git submodule update --init --recursive` 步骤会自动处理，本地不会。
- **Windows `core.autocrlf=true` 与 Biome 的 LF 期望冲突**：导致 `pnpm -w format:check`（pre-push hook 的一部分）对着几乎全仓库文件报错。本地已通过 `git config core.autocrlf false` + `git reset --hard HEAD` 修复（纯本地环境问题，不影响已提交内容）。
- **`js-mdict`/`@simplecc/simplecc_wasm` 是通过 `tsconfig.json` 的 `paths` 别名指向对应 git submodule 源码/`public/vendor/` 目录的，不是走 npm registry**——子模块没初始化 + `pnpm setup-vendors` 没跑过，会导致 `tsgo`/`next build` 报"找不到模块"，容易误判成代码 bug。
- **`androidResources.noCompress` 必须配在 app 模块（`apps/readest-app/src-tauri/gen/android/app/build.gradle.kts`），配在库模块（插件自己的 `build.gradle.kts`）无效**——最终 APK 打包是 app 模块说了算，库模块的这项配置会在合并时被丢弃。已通过实际解包 APK 验证确认修复生效（`model.int8.onnx` 等文件现在是 `STORED` 而非 `DEFLATED`）。
- **`consumerProguardFiles("consumer-rules.pro")` 指向的文件当初并不存在**（`tauri-plugin-native-tts` 插件本来就是这么写的，一直没人发现，因为它一直没做过 release/混淆构建）——库模块自己 `build.gradle.kts` 里的 `proguardFiles` 只在单独构建该库模块时生效，对被 app 消费时的混淆没有任何作用；必须建立真正的 `consumer-rules.pro` 文件。已修复（`apps/readest-app/src-tauri/plugins/tauri-plugin-offline-tts/android/consumer-rules.pro`）。
- **`dictDir` 不能传 Android assets 相对路径**（**目前最大的未解决怀疑点，见第 4 节**）：起初给 `OfflineTtsVitsModelConfig.dictDir` 传了 `"offline-tts/vits-melo-tts-zh_en/dict"`（assets 相对路径）。经过对照 sherpa-onnx 源码（`sherpa-onnx/csrc/melo-tts-lexicon.cc` → `InitJieba(dict_dir)` → `sherpa-onnx/csrc/jieba.cc`）确认：`model`/`lexicon`/`tokens`/`ruleFsts` 都是 sherpa-onnx 自己的代码通过 `ReadFile(AAssetManager*, filename)` 读的，唯独 `dictDir` 是喂给第三方库 cppjieba 的，cppjieba 内部用普通 `std::ifstream` 开文件，根本不认识 Android assets 路径，会导致底层直接 `exit(-1)`（无条件杀进程，Kotlin/Java 层任何 try/catch 都拦不住）。对照 sherpa-onnx 官方 Android 示例 App（`SherpaOnnxTtsEngine/TtsEngine.kt`）验证：官方对这个具体模型压根不设置 `dictDir`。已移除 `dictDir` 配置（`OfflineTTSPlugin.kt`），但**用户反馈修复后仍然崩溃，尚未确认真正根因**（见下）。
- **调试信息缺失**：全程没有拿到过用户手机的 `adb logcat`，所有根因分析都是靠对照 sherpa-onnx 官方 C++ 源码 + 官方示例 App 反推的，属于有依据的推测，不是从实际崩溃堆栈确认的。

## 4. 未完成事项 / 待办

- **【最高优先级、当前阻塞】朗读功能启动仍然闪退**：用户在最新一次反馈（`abf395e2b` 之后打的 release 包）里报告"启动朗读功能还是 app 闪退"。当前状态：
  - 已经修复过一次 `dictDir` 相关的崩溃（commit `fd13bf685`），但**没有实际验证过这个修复是否生效**——中间直接跳去做了 release 包的体积优化（`abf395e2b`），用户测试的是"dictDir 修复 + release 混淆"叠加后的包，无法判断到底是 dictDir 修复不彻底，还是 release 混淆引入了新问题。
  - 助手已经要求用户做两件事，**均在等待回复，尚无结果**：
    1. 用不带混淆的 debug 包（[Actions run 31949170169](https://github.com/hughengwu/readest/actions/runs/31949170169)，已含 dictDir 修复）复测，看是否是 release 混淆导致的新问题
    2. 抓 `adb logcat` 崩溃日志发回
  - **下一步**：拿到上述任一结果后，需要针对性排查——如果是 debug 包也崩，dictDir 假说需要重新审视（比如检查 `ruleFsts`/`lexicon`/`tokens` 路径是否真的如源码分析那样安全，或者压根是另一个完全不同的崩溃点）；如果是 release 特有问题，重点看 R8 混淆是否还漏了什么类/字段没 keep 住（`consumer-rules.pro` 目前只 keep 了 `com.k2fsa.sherpa.onnx.**`，没有覆盖到 `OfflineTTSPlugin.kt` 自己，理论上不需要但值得复查）。
- **未验证项**（受限于没有 Android 设备/adb access，助手无法自行验证，只能等用户反馈）：
  - 离线中文语音是否真的能正常合成播放（哪怕不崩溃，还没听过实际朗读效果）
  - 修复 offline-tts 崩溃后，在线 Edge TTS 语音选择是否真的恢复正常（用户反馈"在线朗读也没了"，理论分析认为是同一次崩溃导致 `TTSController.init()` 没跑完，但未经验证）
  - 中低端机型上的推理延迟/耗电情况完全没测过
- **用户明确要求暂缓/未做的事项**：
  - 首批只做 `vits-melo-tts-zh_en` 一个模型，不接入 AISHELL-3 等多音色模型（用户在早期方案确认阶段明确选择"仅中英混排模型"）
  - 不做运行时模型下载/管理 UI（用户明确选择"模型部署在安卓设备本身"，即打包进 APK，所以 `TTSDownloader.ts` 那套下载基础设施不需要复用/扩展）
  - 不做 iOS / 桌面端支持（`src/desktop.rs` 里所有命令都返回 `UnsupportedPlatformError`，`mobile.rs` 对非 Android 平台也是 no-op 降级，没有 iOS 对应的 Swift 插件）
  - 未提交 git commit：`.github/workflows/vercel-merge.yml` 部署到 Vercel 那条 CI 一直是失败的（`Input required and not supplied: vercel-token`），**这是 fork 本身缺少 `vercel-token` secret 导致的既有问题，与本次改动无关**，不需要现在处理

## 5. 如何继续

1. **先看对话/沟通记录里用户是否回复了上一轮的两个诊断请求**（debug 包复测结果 + `adb logcat`），这是解锁当前阻塞的关键信息。
2. 如果拿到了 logcat：直接搜 `FATAL EXCEPTION`/`AndroidRuntime`/`sherpa`/`offline_tts`/`libc` 相关行，定位是 Java 层异常还是原生层 `exit()`/`abort()`/`SIGSEGV`。
3. 如果只知道"debug 也崩"或"debug 不崩但 release 崩"：
   - 前者说明需要重新审视 `OfflineTTSPlugin.kt`（`apps/readest-app/src-tauri/plugins/tauri-plugin-offline-tts/android/src/main/java/com/readest/offline_tts/OfflineTTSPlugin.kt`）里配置 `OfflineTtsConfig`/`OfflineTtsVitsModelConfig` 的每个字段，逐个对照 sherpa-onnx 源码确认是否走 asset-safe 读取路径（参考本文件第 3 节列出的排查方法：直接去 https://github.com/k2-fsa/sherpa-onnx 的 `sherpa-onnx/csrc/` 下找对应 `.cc` 文件读源码，不要凭经验猜）
   - 后者说明要重新审视 R8/混淆相关配置（`android/consumer-rules.pro`、`apps/readest-app/src-tauri/gen/android/app/build.gradle.kts` 里的 `proguardFiles`），可能需要临时关掉 `isMinifyEnabled` 或加更细的 keep 规则来二分定位
4. 每次改完代码验证，走这个流程（不要本地尝试构建 Android，本机没有工具链）：
   ```
   git add -A && git commit -m "..." && git push --no-verify origin main
   gh workflow run debug-apk.yml --ref main   # 或 release-apk.yml
   gh run list --workflow=debug-apk.yml --limit 1
   gh run watch <run-id> --exit-status
   gh run download <run-id> -n readest-debug-arm64 -D <目录>
   ```
   （`--no-verify` 是因为本仓库 `pre-push` hook 会跑全量 `pnpm test`，其中有 3 个与本功能无关的预存失败用例——PDF 相关测试因为这台环境 jsdom 缺 `DOMMatrix`——已经跟用户确认过可以跳过，不是新引入的问题）
5. 关键文件速查表：
   - Kotlin 插件主体：`apps/readest-app/src-tauri/plugins/tauri-plugin-offline-tts/android/src/main/java/com/readest/offline_tts/OfflineTTSPlugin.kt`
   - sherpa-onnx 官方封装（不要改包名/不要改这个文件本身的逻辑）：`.../android/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt`
   - TS 侧 provider：`apps/readest-app/src/services/tts/providers/offlineTts.ts`
   - TS 侧接入点：`apps/readest-app/src/services/tts/TTSController.ts`
   - CI 构建：`.github/workflows/debug-apk.yml`、`.github/workflows/release-apk.yml`
