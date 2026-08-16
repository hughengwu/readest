use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<OfflineTts<R>> {
    Ok(OfflineTts(app.clone()))
}

/// Access to the offline-tts APIs.
pub struct OfflineTts<R: Runtime>(AppHandle<R>);

impl<R: Runtime> OfflineTts<R> {
    pub fn init(&self) -> crate::Result<InitResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn synthesize(&self, _args: SynthesizeArgs) -> crate::Result<SynthesizeResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
    pub fn get_all_voices(&self) -> crate::Result<GetVoicesResponse> {
        Err(crate::Error::UnsupportedPlatformError)
    }
}
