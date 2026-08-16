# sherpa-onnx's Kotlin wrapper (Tts.kt) is called into via JNI native
# methods and its config data classes are read field-by-field via JNI
# reflection from native code; R8 renaming those breaks both. This is a
# consumerProguardFiles rule (declared in build.gradle.kts), so it flows
# into the app module's own R8 pass automatically — the copy in this
# plugin's own proguard-rules.pro only applies if this module is ever
# minified standalone, which never happens when consumed as a dependency.
-keep class com.k2fsa.sherpa.onnx.** { *; }
