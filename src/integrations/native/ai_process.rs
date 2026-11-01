// Own the CLI's descendants so inherited pipes cannot outlive the deadline.
#[cfg(windows)]
use std::{ffi::c_void, os::windows::io::AsRawHandle};

pub(crate) struct ProcessTree {
    #[cfg(windows)]
    job: *mut c_void,
    #[cfg(unix)]
    pid: u32,
}

// A job handle may be used and closed from any thread.
unsafe impl Send for ProcessTree {}
unsafe impl Sync for ProcessTree {}

#[cfg(windows)]
#[repr(C)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    min_working_set: usize,
    max_working_set: usize,
    active_processes: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[cfg(windows)]
#[repr(C)]
struct ExtendedLimits {
    basic: BasicLimits,
    io: [u64; 6],
    process_memory: usize,
    job_memory: usize,
    peak_process_memory: usize,
    peak_job_memory: usize,
}
#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
    fn SetInformationJobObject(job: *mut c_void, class: i32, info: *const c_void, size: u32)
        -> i32;
    fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
    fn CloseHandle(handle: *mut c_void) -> i32;
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> *mut c_void;
    fn Thread32First(snapshot: *mut c_void, entry: *mut ThreadEntry) -> i32;
    fn Thread32Next(snapshot: *mut c_void, entry: *mut ThreadEntry) -> i32;
    fn OpenThread(access: u32, inherit: i32, id: u32) -> *mut c_void;
    fn ResumeThread(thread: *mut c_void) -> u32;
}
#[cfg(windows)]
#[repr(C)]
struct ThreadEntry {
    size: u32,
    usage: u32,
    id: u32,
    owner: u32,
    base_priority: i32,
    delta_priority: i32,
    flags: u32,
}

#[cfg(windows)]
fn resume(pid: u32) -> bool {
    // std::process closes the primary thread handle; find it while still suspended.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(4, 0); // TH32CS_SNAPTHREAD
        if snapshot as isize == -1 {
            return false;
        }
        let mut entry: ThreadEntry = std::mem::zeroed();
        entry.size = std::mem::size_of::<ThreadEntry>() as u32;
        let mut found = Thread32First(snapshot, &mut entry) != 0;
        let mut resumed = false;
        while found {
            if entry.owner == pid {
                let thread = OpenThread(2, 0, entry.id); // THREAD_SUSPEND_RESUME
                if !thread.is_null() {
                    resumed = ResumeThread(thread) != u32::MAX;
                    CloseHandle(thread);
                }
                break;
            }
            found = Thread32Next(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        resumed
    }
}

impl ProcessTree {
    pub(crate) fn watch(child: &std::process::Child) -> Result<Self, String> {
        #[cfg(windows)]
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("Could not isolate the CLI process.".into());
            }
            let mut limits: ExtendedLimits = std::mem::zeroed();
            limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if SetInformationJobObject(
                job,
                9,
                &limits as *const _ as *const c_void,
                std::mem::size_of::<ExtendedLimits>() as u32,
            ) == 0
                || AssignProcessToJobObject(job, child.as_raw_handle()) == 0
            {
                CloseHandle(job);
                return Err("Could not isolate the CLI process.".into());
            }
            if !resume(child.id()) {
                CloseHandle(job);
                return Err("Could not resume the isolated CLI process.".into());
            }
            Ok(Self { job })
        }
        #[cfg(unix)]
        {
            Ok(Self { pid: child.id() })
        }
    }
}

impl Drop for ProcessTree {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            CloseHandle(self.job);
        }
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", "--", &format!("-{}", self.pid)])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
}
