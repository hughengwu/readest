use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::models::*;

// sherpa-onnx here is vendored as a Kotlin/JNI wrapper around prebuilt
// jniLibs (see android/src/main/jniLibs), not compiled from Rust, and there
// is no iOS counterpart yet (Android-only, per the offline-TTS plan). `mobile`
// covers both platforms, so registration must still succeed on iOS — an
// unregistered `None` handle makes every command fail lazily instead of
// aborting plugin setup for the whole app at iOS startup.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<OfflineTts<R>> {
    #[cfg(target_os = "android")]
    {
        let handle = api.register_android_plugin("com.readest.offline_tts", "OfflineTTSPlugin")?;
        Ok(OfflineTts(Some(handle)))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = api;
        Ok(OfflineTts(None))
    }
}

/// Access to the offline-tts APIs.
pub struct OfflineTts<R: Runtime>(Option<PluginHandle<R>>);

impl<R: Runtime> OfflineTts<R> {
    pub fn init(&self) -> crate::Result<InitResponse> {
        match &self.0 {
            Some(handle) => handle.run_mobile_plugin("init", ()).map_err(Into::into),
            None => Err(crate::Error::UnsupportedPlatformError),
        }
    }
}

impl<R: Runtime> OfflineTts<R> {
    pub fn synthesize(&self, payload: SynthesizeArgs) -> crate::Result<SynthesizeResponse> {
        match &self.0 {
            Some(handle) => handle
                .run_mobile_plugin("synthesize", payload)
                .map_err(Into::into),
            None => Err(crate::Error::UnsupportedPlatformError),
        }
    }
}

impl<R: Runtime> OfflineTts<R> {
    pub fn get_all_voices(&self) -> crate::Result<GetVoicesResponse> {
        match &self.0 {
            Some(handle) => handle
                .run_mobile_plugin("get_all_voices", ())
                .map_err(Into::into),
            None => Err(crate::Error::UnsupportedPlatformError),
        }
    }
}
