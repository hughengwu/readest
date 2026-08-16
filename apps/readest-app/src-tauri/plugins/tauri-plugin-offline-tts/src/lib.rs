use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

#[cfg(desktop)]
use desktop::OfflineTts;
#[cfg(mobile)]
use mobile::OfflineTts;

/// Extensions to [`tauri::App`], [`tauri::AppHandle`] and [`tauri::Window`] to access the offline-tts APIs.
pub trait OfflineTtsExt<R: Runtime> {
    fn offline_tts(&self) -> &OfflineTts<R>;
}

impl<R: Runtime, T: Manager<R>> crate::OfflineTtsExt<R> for T {
    fn offline_tts(&self) -> &OfflineTts<R> {
        self.state::<OfflineTts<R>>().inner()
    }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("offline-tts")
        .invoke_handler(tauri::generate_handler![
            commands::init,
            commands::synthesize,
            commands::get_all_voices,
        ])
        .setup(|app, api| {
            #[cfg(mobile)]
            let offline_tts = mobile::init(app, api)?;
            #[cfg(desktop)]
            let offline_tts = desktop::init(app, api)?;
            app.manage(offline_tts);
            Ok(())
        })
        .build()
}
