package com.readest.offline_tts

import android.app.Activity
import android.util.Base64
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

// Bundled as an app asset (see android/src/main/assets/offline-tts/), not
// downloaded at runtime: mainland-China reachability of GitHub/HF-hosted
// model files is unreliable, and this model is the only voice this plugin
// offers, so there's nothing to pick at runtime.
private const val MODEL_ASSET_DIR = "offline-tts/vits-melo-tts-zh_en"
private const val VOICE_ID = "offline-melo-zh-en-0"
private const val VOICE_NAME = "离线中文语音"
private const val VOICE_LANG = "zh-CN"

@InvokeArg
class SynthesizeArgs(
    val text: String? = "",
    val speed: Float? = 1.0f
)

@TauriPlugin
class OfflineTTSPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "OfflineTTSPlugin"
    }

    private var tts: OfflineTts? = null
    private val isInitializing = AtomicBoolean(false)
    private val coroutineScope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    @Command
    fun init(invoke: Invoke) {
        val loaded = tts
        if (loaded != null) {
            invoke.resolve(JSObject().apply {
                put("success", true)
                put("sampleRate", loaded.sampleRate())
            })
            return
        }
        if (!isInitializing.compareAndSet(false, true)) {
            invoke.reject("Offline TTS is already initializing")
            return
        }
        coroutineScope.launch {
            try {
                val engine = withContext(Dispatchers.IO) { loadModel() }
                tts = engine
                invoke.resolve(JSObject().apply {
                    put("success", true)
                    put("sampleRate", engine.sampleRate())
                })
            } catch (e: Throwable) {
                // Catches Throwable, not just Exception: a missing/mismatched
                // native .so surfaces as UnsatisfiedLinkError, which is an
                // Error, not an Exception — left uncaught it crashes the
                // whole app instead of just leaving this engine unavailable.
                Log.e(TAG, "Failed to initialize offline TTS", e)
                invoke.reject("Failed to initialize offline TTS: ${e.message}")
            } finally {
                isInitializing.set(false)
            }
        }
    }

    // Reads model files straight out of the APK's assets via AssetManager —
    // sherpa-onnx's JNI supports this natively (OfflineTts(assetManager, ...)),
    // so there's no need to extract ~70MB to app storage on first run.
    private fun loadModel(): OfflineTts {
        // dictDir deliberately omitted: sherpa-onnx's own Android reference
        // app (SherpaOnnxTtsEngine/TtsEngine.kt) never sets it for this exact
        // model, and for good reason — dictDir feeds cppjieba, a vendored C++
        // dependency that opens it with plain std::ifstream, not the
        // AAssetManager-aware reader model/lexicon/tokens go through. An
        // asset-relative dictDir isn't a real filesystem path, so the native
        // side calls exit(-1) on the failed open — an unrecoverable process
        // kill no Kotlin try/catch can intercept, not just a thrown error.
        val config = OfflineTtsConfig(
            model = OfflineTtsModelConfig(
                vits = OfflineTtsVitsModelConfig(
                    model = "$MODEL_ASSET_DIR/model.int8.onnx",
                    lexicon = "$MODEL_ASSET_DIR/lexicon.txt",
                    tokens = "$MODEL_ASSET_DIR/tokens.txt",
                ),
                numThreads = 2,
                debug = false,
            ),
            ruleFsts = "$MODEL_ASSET_DIR/phone.fst,$MODEL_ASSET_DIR/date.fst,$MODEL_ASSET_DIR/number.fst",
        )
        return OfflineTts(assetManager = activity.assets, config = config)
    }

    @Command
    fun get_all_voices(invoke: Invoke) {
        val voice = JSObject().apply {
            put("id", VOICE_ID)
            put("name", VOICE_NAME)
            put("lang", VOICE_LANG)
            put("disabled", false)
        }
        invoke.resolve(JSObject().apply {
            put("voices", JSONArray(listOf(voice)))
        })
    }

    @Command
    fun synthesize(invoke: Invoke) {
        val args = invoke.parseArgs(SynthesizeArgs::class.java)
        val text = args.text?.trim().orEmpty()
        if (text.isEmpty()) {
            invoke.reject("Text must not be empty")
            return
        }
        val engine = tts
        if (engine == null) {
            invoke.reject("Offline TTS is not initialized")
            return
        }
        val speed = args.speed ?: 1.0f
        coroutineScope.launch {
            try {
                val (bytes, sampleRate) = withContext(Dispatchers.Default) {
                    val audio = engine.generate(text = text, sid = 0, speed = speed)
                    // Reuse sherpa-onnx's own native WAV writer instead of
                    // hand-rolling a RIFF header from the raw float samples.
                    val wavFile = File.createTempFile("offline-tts-", ".wav", activity.cacheDir)
                    try {
                        audio.save(wavFile.absolutePath)
                        wavFile.readBytes() to audio.sampleRate
                    } finally {
                        wavFile.delete()
                    }
                }
                invoke.resolve(JSObject().apply {
                    put("audioBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    put("sampleRate", sampleRate)
                })
            } catch (e: Throwable) {
                Log.e(TAG, "Offline TTS synthesis failed", e)
                invoke.reject("Offline TTS synthesis failed: ${e.message}")
            }
        }
    }
}
