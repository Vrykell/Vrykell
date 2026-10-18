//! Pure payload builders for the desktop file clipboard.
//!
//! The three platforms expect a different byte layout for the same file list. Keeping the
//! builders here - with no OS calls - makes the tricky parts (the Windows DROPFILES header,
//! the macOS property list, the Linux URI list) unit-testable on any host. Each builder is
//! gated to its own platform plus `test`, so a build only carries what it can use.

/// Whether a copy carries a copy or a move (cut) intent.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ClipMode {
    Copy,
    Cut,
}

impl ClipMode {
    pub fn from_str(value: &str) -> ClipMode {
        if value.eq_ignore_ascii_case("cut") {
            ClipMode::Cut
        } else {
            ClipMode::Copy
        }
    }

    #[cfg(any(test, target_os = "linux"))]
    pub fn as_str(self) -> &'static str {
        match self {
            ClipMode::Copy => "copy",
            ClipMode::Cut => "cut",
        }
    }

    /// DROPEFFECT_COPY = 1, DROPEFFECT_MOVE = 2.
    #[cfg(any(test, target_os = "windows"))]
    pub fn drop_effect(self) -> u32 {
        match self {
            ClipMode::Copy => 1,
            ClipMode::Cut => 2,
        }
    }
}

/// Size of the Windows DROPFILES header: pFiles, pt.x, pt.y, fNC, fWide.
#[cfg(any(test, target_os = "windows"))]
pub const DROPFILES_HEADER_SIZE: u32 = 20;

/// Windows CF_HDROP payload: a DROPFILES header followed by a double-null-terminated UTF-16LE
/// path list.
#[cfg(any(test, target_os = "windows"))]
pub fn windows_hdrop(paths: &[String]) -> Vec<u8> {
    let path_bytes: usize = paths.iter().map(|path| (path.encode_utf16().count() + 1) * 2).sum();
    let mut out = Vec::with_capacity(DROPFILES_HEADER_SIZE as usize + path_bytes + 2);
    out.extend_from_slice(&DROPFILES_HEADER_SIZE.to_le_bytes()); // pFiles: byte offset of the list
    out.extend_from_slice(&0i32.to_le_bytes()); // pt.x
    out.extend_from_slice(&0i32.to_le_bytes()); // pt.y
    out.extend_from_slice(&0i32.to_le_bytes()); // fNC
    out.extend_from_slice(&1i32.to_le_bytes()); // fWide: UTF-16LE path list
    for path in paths {
        for unit in path.encode_utf16() {
            out.extend_from_slice(&unit.to_le_bytes());
        }
        out.extend_from_slice(&0u16.to_le_bytes());
    }
    out.extend_from_slice(&0u16.to_le_bytes()); // trailing null -> the list ends with a double null
    out
}

/// Windows "Preferred DropEffect" payload: a single little-endian DWORD.
#[cfg(any(test, target_os = "windows"))]
pub fn windows_preferred_drop_effect(mode: ClipMode) -> Vec<u8> {
    mode.drop_effect().to_le_bytes().to_vec()
}

#[cfg(test)]
fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// macOS NSFilenamesPboardType payload: an XML property list array of POSIX paths.
///
/// macOS writes through the system pasteboard (see `macos`), which builds this flavour itself;
/// the builder stays here as the canonical format definition and for cross-host unit tests.
#[cfg(test)]
pub fn macos_nsfilenames_plist(paths: &[String]) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><array>");
    for path in paths {
        out.push_str("<string>");
        out.push_str(&xml_escape(path));
        out.push_str("</string>");
    }
    out.push_str("</array></plist>\n");
    out
}

/// macOS `public.file-url` payload for one path (a percent-encoded file URL).
#[cfg(any(test, target_os = "macos"))]
pub fn macos_file_url(path: &str) -> String {
    file_uri(path)
}

/// Linux `text/uri-list`: one file URI per line, CRLF-terminated.
#[cfg(any(test, target_os = "linux"))]
pub fn linux_uri_list(paths: &[String]) -> String {
    let mut out = String::new();
    for path in paths {
        out.push_str(&file_uri(path));
        out.push_str("\r\n");
    }
    out
}

/// Linux `x-special/gnome-copied-files`: the operation on the first line, then the URIs.
#[cfg(any(test, target_os = "linux"))]
pub fn linux_gnome_copied_files(paths: &[String], mode: ClipMode) -> String {
    let mut out = String::from(mode.as_str());
    out.push('\n');
    for path in paths {
        out.push_str(&file_uri(path));
        out.push('\n');
    }
    out
}

/// Percent-encoded `file://` URI for an absolute path.
#[cfg(any(test, target_os = "macos", target_os = "linux"))]
fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for byte in path.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> Vec<String> {
        vec!["/Users/me/Notes.txt".to_string(), "/Users/me/My Dir".to_string()]
    }

    #[test]
    fn hdrop_starts_with_the_wide_header_and_ends_double_nulled() {
        let bytes = windows_hdrop(&paths());
        assert_eq!(&bytes[0..4], &20u32.to_le_bytes(), "pFiles points past the header");
        assert_eq!(&bytes[16..20], &1i32.to_le_bytes(), "fWide selects UTF-16LE");
        let list = &bytes[DROPFILES_HEADER_SIZE as usize..];
        assert!(list.ends_with(&[0, 0, 0, 0]), "path list ends with a double null");
        // First path survives as UTF-16LE.
        let mut expected = Vec::new();
        for unit in "/Users/me/Notes.txt".encode_utf16() {
            expected.extend_from_slice(&unit.to_le_bytes());
        }
        assert!(list.starts_with(&expected));
    }

    #[test]
    fn hdrop_encodes_a_lone_path_with_two_terminators() {
        let bytes = windows_hdrop(&["C:\\a.txt".to_string()]);
        let expected = DROPFILES_HEADER_SIZE as usize + ("C:\\a.txt".chars().count() + 1) * 2 + 2;
        assert_eq!(bytes.len(), expected);
        assert!(bytes.ends_with(&[0, 0, 0, 0]));
    }

    #[test]
    fn drop_effect_distinguishes_copy_from_cut() {
        assert_eq!(windows_preferred_drop_effect(ClipMode::Copy), 1u32.to_le_bytes());
        assert_eq!(windows_preferred_drop_effect(ClipMode::Cut), 2u32.to_le_bytes());
    }

    #[test]
    fn macos_plist_lists_every_path_and_escapes_xml() {
        let plist = macos_nsfilenames_plist(&["/a&b".to_string(), "/c<d".to_string()]);
        assert!(plist.contains("<string>/a&amp;b</string>"));
        assert!(plist.contains("<string>/c&lt;d</string>"));
        assert!(plist.starts_with("<?xml"));
        assert!(plist.contains("<array>") && plist.ends_with("</array></plist>\n"));
    }

    #[test]
    fn macos_file_url_percent_encodes_spaces() {
        assert_eq!(macos_file_url("/Users/me/My Dir/Notes.txt"), "file:///Users/me/My%20Dir/Notes.txt");
    }

    #[test]
    fn linux_uri_list_is_crlf_terminated() {
        let list = linux_uri_list(&["/home/me/a b".to_string(), "/home/me/c".to_string()]);
        assert_eq!(list, "file:///home/me/a%20b\r\nfile:///home/me/c\r\n");
    }

    #[test]
    fn gnome_copied_files_leads_with_the_operation() {
        assert_eq!(
            linux_gnome_copied_files(&["/home/me/a".to_string()], ClipMode::Cut),
            "cut\nfile:///home/me/a\n"
        );
        assert!(linux_gnome_copied_files(&["/home/me/a".to_string()], ClipMode::Copy).starts_with("copy\n"));
    }

    #[test]
    fn clip_mode_parses_case_insensitively() {
        assert_eq!(ClipMode::from_str("CUT"), ClipMode::Cut);
        assert_eq!(ClipMode::from_str("copy"), ClipMode::Copy);
        assert_eq!(ClipMode::from_str("anything-else"), ClipMode::Copy);
    }
}
