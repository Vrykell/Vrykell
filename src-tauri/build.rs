fn main() {
    let manifest = include_str!("windows-context-menu/application.manifest");
    // A shell package identity on the main process couples its lifetime to shell activations.
    assert!(
        !manifest.contains("urn:schemas-microsoft-com:msix.v1"),
        "The shell package identity must belong only to the dedicated host."
    );
    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new().app_manifest(manifest),
    );
    tauri_build::try_build(attributes).expect("failed to prepare application resources");
}
