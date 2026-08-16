use tauri::{command, AppHandle, Runtime};

use crate::models::*;
use crate::OfflineTtsExt;
use crate::Result;

#[command]
pub(crate) async fn init<R: Runtime>(app: AppHandle<R>) -> Result<InitResponse> {
    app.offline_tts().init()
}

#[command]
pub(crate) async fn synthesize<R: Runtime>(
    app: AppHandle<R>,
    payload: SynthesizeArgs,
) -> Result<SynthesizeResponse> {
    app.offline_tts().synthesize(payload)
}

#[command]
pub(crate) async fn get_all_voices<R: Runtime>(app: AppHandle<R>) -> Result<GetVoicesResponse> {
    app.offline_tts().get_all_voices()
}
