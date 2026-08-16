# sherpa-onnx's Kotlin wrapper (Tts.kt) is called into via JNI native
# methods and instantiated via Class.forName-style lookups from the .so;
# R8 can't see those references and will strip/rename the classes otherwise.
-keep class com.k2fsa.sherpa.onnx.** { *; }
