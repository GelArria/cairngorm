// ── Minidump via raw FFI ────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
pub(super) fn write_minidump(path: &str) -> bool {
    use std::ffi::CString;

    #[link(name = "dbghelp")]
    extern "system" {
        fn MiniDumpWriteDump(
            process: *mut std::ffi::c_void,
            pid: u32,
            file: *mut std::ffi::c_void,
            dump_type: u32,
            exception_param: *mut std::ffi::c_void,
            user_stream_param: *mut std::ffi::c_void,
            callback_param: *mut std::ffi::c_void,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileA(
            name: *const i8,
            access: u32,
            share: u32,
            sec: *mut std::ffi::c_void,
            creation: u32,
            flags: u32,
            templ: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void;
        fn CloseHandle(obj: *mut std::ffi::c_void) -> i32;
        fn GetCurrentProcess() -> *mut std::ffi::c_void;
    }

    unsafe {
        let path_c = CString::new(path).unwrap_or_default();
        // MiniDumpWithDataSegs | MiniDumpWithHandleData | MiniDumpWithFullMemoryInfo
        let dump_type: u32 = 0x1 | 0x4 | 0x800;

        let file = CreateFileA(
            path_c.as_ptr(),
            0x40000000,
            0,
            std::ptr::null_mut(),
            2,
            0x80,
            std::ptr::null_mut(),
        );
        if file.is_null() || file as usize == std::usize::MAX {
            return false;
        }

        let pid = std::process::id();
        let proc = GetCurrentProcess();
        let ok = MiniDumpWriteDump(
            proc,
            pid,
            file,
            dump_type,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
        CloseHandle(file);
        ok != 0
    }
}

#[cfg(not(target_os = "windows"))]
pub(super) fn write_minidump(_path: &str) -> bool {
    false
}

// ── Native dialog ───────────────────────────────────────────────────────────
