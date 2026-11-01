// cargo test --manifest-path src-tauri/Cargo.toml --lib unrelated_session -- --nocapture
use super::replay::PtyReplay;
use super::test_output::TestOutput;
use super::*;
use portable_pty::{Child, ChildKiller, ExitStatus, NativePtySystem, PtySize, PtySystem};
use serde_json::Value;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn idle_session() -> PtySession {
    // A real PTY master but no subprocess or Tauri window is needed here.
    let pair = NativePtySystem::default()
        .openpty(PtySize::default())
        .unwrap();
    let mut replay = PtyReplay::default();
    replay.push(b"replay");
    PtySession {
        master: pair.master,
        writer: Arc::new(Mutex::new(Box::new(Cursor::new(Vec::<u8>::new())))),
        child: Mutex::new(None),
        cancel: Arc::new(AtomicBool::new(false)),
        reader_alive: Arc::new(AtomicBool::new(true)),
        parse_jsonl: false,
        output_log: Arc::new(Mutex::new(replay)),
        output: Arc::new(PtyOutput::default()),
        test_output: Arc::new(TestOutput::new("idle-test")),
        replay_seen: AtomicBool::new(false),
        pid: None,
        permissions_off: false,
    }
}

#[derive(Debug, Clone)]
struct BlockingKill {
    entered: mpsc::Sender<()>,
    release: Arc<Mutex<mpsc::Receiver<()>>>,
    finished: Arc<AtomicBool>,
}
impl ChildKiller for BlockingKill {
    fn kill(&mut self) -> std::io::Result<()> {
        let _ = self.entered.send(());
        self.release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .map_err(std::io::Error::other)?;
        self.finished.store(true, Ordering::Relaxed);
        Ok(())
    }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(self.clone())
    }
}
impl Child for BlockingKill {
    fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
        Ok(self
            .finished
            .load(Ordering::Relaxed)
            .then(|| ExitStatus::with_exit_code(0)))
    }
    fn wait(&mut self) -> std::io::Result<ExitStatus> {
        Err(std::io::ErrorKind::Unsupported.into())
    }
    fn process_id(&self) -> Option<u32> {
        None
    }
    fn as_raw_handle(&self) -> Option<std::os::windows::io::RawHandle> {
        None
    }
}

#[test]
fn slow_kill_keeps_its_slot_reserved_without_blocking_another_terminal() {
    let a = format!("kill-a-{}", uuid::Uuid::new_v4());
    let b = format!("kill-b-{}", uuid::Uuid::new_v4());
    let (entered, entry) = mpsc::channel();
    let (release, held) = mpsc::channel();
    let sa = idle_session();
    *sa.child.lock().unwrap() = Some(Box::new(BlockingKill {
        entered,
        release: Arc::new(Mutex::new(held)),
        finished: Arc::new(AtomicBool::new(false)),
    }));
    let slot = Arc::new(Mutex::new(Some(sa)));
    {
        let mut registry = PTY_REGISTRY.lock().unwrap();
        registry.insert(a.clone(), slot.clone());
        registry.insert(b.clone(), Arc::new(Mutex::new(Some(idle_session()))));
    }
    let a_id = a.clone();
    let killing = std::thread::spawn(move || tauri::async_runtime::block_on(pty_kill(a_id)));
    let entered = entry.recv_timeout(Duration::from_secs(5));
    let (tx, rx) = mpsc::channel();
    let a_id = a.clone();
    let b_id = b.clone();
    let other = std::thread::spawn(move || {
        let reserved = session_slot(&a_id);
        let same_slot = Arc::ptr_eq(&reserved, &slot) && reserved.try_lock().is_err();
        let result = tauri::async_runtime::block_on(pty_resize(b_id, 80, 24));
        tx.send((same_slot, result)).unwrap();
    });
    let responsive = rx.recv_timeout(Duration::from_millis(500));
    let _ = release.send(());
    killing.join().unwrap().unwrap();
    other.join().unwrap();
    tauri::async_runtime::block_on(pty_kill(b)).unwrap();
    assert!(entered.is_ok(), "kill never entered the child");
    let (same_slot, result) = responsive.expect("slow kill held the PTY registry");
    result.unwrap();
    assert!(
        same_slot,
        "ensure must wait on the dying child's slot, not create a second one"
    );
    assert!(find_session(&a).is_none());
}

#[test]
fn killing_a_terminal_wakes_its_backpressured_output_reader() {
    let id = format!("output-kill-{}", uuid::Uuid::new_v4());
    let session = idle_session();
    let output = session.output.clone();
    output.push(&vec![b'x'; OUTPUT_CAP]).unwrap();
    PTY_REGISTRY
        .lock()
        .unwrap()
        .insert(id.clone(), Arc::new(Mutex::new(Some(session))));
    let (done, completion) = mpsc::channel();
    let reader_output = output.clone();
    let reader = std::thread::spawn(move || {
        done.send(reader_output.push(b"late")).unwrap();
    });
    tauri::async_runtime::block_on(pty_kill(id.clone())).unwrap();
    assert_eq!(
        completion.recv_timeout(Duration::from_secs(5)).unwrap(),
        None
    );
    reader.join().unwrap();
    assert!(find_session(&id).is_none());
    assert_eq!(
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, output.take())
            .unwrap()
            .len(),
        OUTPUT_CAP
    );
}

#[test]
fn jsonl_extraction_borrows_and_preserves_escaped_nested_objects() {
    let line = br#"prefix {"type":"tool_execution_end","result":{"content":[{"text":"braces } { and \"quotes\""}]}} suffix"#;
    let bytes = extract_json_bytes(line).unwrap();
    let offset = line.iter().position(|&b| b == b'{').unwrap();
    assert_eq!(
        bytes.as_ptr(),
        line[offset..].as_ptr(),
        "JSON extraction must not allocate/copy the payload"
    );
    let value: Value = serde_json::from_slice(bytes).unwrap();
    assert_eq!(
        value["result"]["content"][0]["text"],
        "braces } { and \"quotes\""
    );
    let mut seen = std::collections::HashSet::new();
    seen.insert(bytes.to_vec());
    assert!(seen.contains(extract_json_bytes(line).unwrap()));
    assert!(extract_json_bytes(&bytes[..bytes.len() - 1]).is_none());
    // Wrapped ConPTY output is still reassembled after removing CSI sequences.
    let mut wrapped = b"{\"type\":\"message_update\",\r\n\x1b[2K\"assistantMessageEvent\":{\"delta\":\"hello\"}}\r\n".to_vec();
    let mut assembly = Vec::new();
    process_lines(&mut wrapped, |fragment| {
        assembly.extend_from_slice(&strip_ansi(fragment))
    });
    let value = try_parse_jsonl(&assembly).unwrap();
    assert_eq!(format_event_for_terminal(&value).unwrap(), "hello");
}

#[test]
fn concurrent_ensure_reservations_share_one_slot_and_empty_kill_cleans_up() {
    let id = format!("reservation-{}", uuid::Uuid::new_v4());
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let id = id.clone();
            std::thread::spawn(move || session_slot(&id))
        })
        .collect();
    let slots: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(slots.iter().all(|slot| Arc::ptr_eq(slot, &slots[0])));
    assert!(slots[0].lock().unwrap().is_none());
    kill_session(&id);
    assert!(find_session(&id).is_none());
}

#[test]
fn unrelated_session_stays_responsive_while_a_write_is_blocked() {
    let a = format!("test-a-{}", uuid::Uuid::new_v4());
    let b = format!("test-b-{}", uuid::Uuid::new_v4());
    let sa = idle_session();
    let writer = sa.writer.clone();
    let sa = Arc::new(Mutex::new(Some(sa)));
    let sb = Arc::new(Mutex::new(Some(idle_session())));
    {
        let mut registry = PTY_REGISTRY.lock().unwrap();
        registry.insert(a.clone(), sa.clone());
        registry.insert(b.clone(), sb);
    }
    let held_writer = writer.lock().unwrap();
    let a_id = a.clone();
    let blocked = std::thread::spawn(move || {
        tauri::async_runtime::block_on(pty_write(a_id, "blocked".into()))
    });
    let wait = Instant::now();
    // Wait for the actual command to hold A's session lock, not a sleep-based guess.
    while sa.try_lock().is_ok() && wait.elapsed() < Duration::from_secs(5) {
        std::thread::yield_now();
    }
    let entered = sa.try_lock().is_err();
    let (tx, rx) = mpsc::channel();
    let b_id = b.clone();
    let other = std::thread::spawn(move || {
        let start = Instant::now();
        let result = tauri::async_runtime::block_on(async {
            pty_write(b_id.clone(), "hello".into()).await?;
            pty_resize(b_id.clone(), 80, 24).await?;
            assert!(pty_replay(b_id.clone()).await?.is_some());
            agent_steer(b_id.clone(), "stop".into(), None).await?;
            pty_kill(b_id).await
        });
        tx.send((start.elapsed(), result)).unwrap();
    });
    let responsive = rx.recv_timeout(Duration::from_millis(500));
    // Always unblock and clean up before asserting, including the old-code failure.
    drop(held_writer);
    blocked.join().unwrap().unwrap();
    other.join().unwrap();
    tauri::async_runtime::block_on(pty_kill(a.clone())).unwrap();
    tauri::async_runtime::block_on(pty_kill(b.clone())).unwrap();
    assert!(find_session(&a).is_none());
    assert!(find_session(&b).is_none());
    assert!(entered, "A's write never entered the session");
    let (elapsed, result) =
        responsive.expect("B waited for A: the PTY registry is held across blocking I/O");
    result.unwrap();
    println!(
        "5 commands on B finished in {:.3} ms while A's writer stayed locked",
        elapsed.as_secs_f64() * 1000.0
    );
}
