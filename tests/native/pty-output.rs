use super::*;
use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

fn take(output: &PtyOutput) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(output.take())
        .unwrap()
}

#[test]
fn burst_schedules_once_and_preserves_utf8_escape_and_image_bytes() {
    let output = PtyOutput::default();
    let bytes = "🦀\x1b[?2026h\x1bPqimage\x1b\\\x1b[?2026l".as_bytes();
    let mut scheduled = 0;
    for byte in bytes {
        scheduled += usize::from(output.push(&[*byte]).unwrap());
    }
    assert_eq!(scheduled, 1);
    assert_eq!(take(&output), bytes);
    assert_eq!(output.push(b"next"), Some(true));
    assert_eq!(take(&output), b"next");
    assert_eq!(output.push(b""), Some(false));
}

#[test]
fn a_full_queue_waits_without_dropping_data_or_blocking_another_session() {
    let output = Arc::new(PtyOutput::default());
    let first = vec![b'a'; OUTPUT_CAP];
    assert_eq!(output.push(&first), Some(true));
    let (entered, entry) = mpsc::channel();
    let (done, completion) = mpsc::channel();
    let writer = output.clone();
    let producer = std::thread::spawn(move || {
        entered.send(()).unwrap();
        done.send(writer.push(b"tail")).unwrap();
    });
    entry.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(completion.recv_timeout(Duration::from_millis(30)).is_err());
    assert_eq!(output.pending.lock().unwrap().len, OUTPUT_CAP);
    let other = PtyOutput::default();
    assert_eq!(other.push(b"interactive"), Some(true));
    assert_eq!(take(&other), b"interactive");
    assert_eq!(take(&output), first);
    assert_eq!(
        completion.recv_timeout(Duration::from_secs(5)).unwrap(),
        Some(true)
    );
    producer.join().unwrap();
    assert_eq!(take(&output), b"tail");
}

#[test]
fn shutdown_releases_a_blocked_reader_and_keeps_accepted_output() {
    let output = Arc::new(PtyOutput::default());
    output.push(&vec![b'x'; OUTPUT_CAP]).unwrap();
    let (done, completion) = mpsc::channel();
    let writer = output.clone();
    let producer = std::thread::spawn(move || {
        done.send(writer.push(b"late")).unwrap();
    });
    output.stop();
    assert_eq!(
        completion.recv_timeout(Duration::from_secs(5)).unwrap(),
        None
    );
    producer.join().unwrap();
    assert_eq!(take(&output), vec![b'x'; OUTPUT_CAP]);
    assert_eq!(output.push(b"after close"), None);
}

#[test]
fn concurrent_drains_preserve_every_byte_of_a_large_stream() {
    let output = Arc::new(PtyOutput::default());
    let expected: Vec<u8> = (0..2 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    let input = expected.clone();
    let writer = output.clone();
    let (done, completion) = mpsc::channel();
    let producer = std::thread::spawn(move || {
        for chunk in input.chunks(4096) {
            writer.push(chunk).unwrap();
        }
        done.send(()).unwrap();
    });
    let mut actual = Vec::new();
    loop {
        actual.extend(take(&output));
        if completion.try_recv().is_ok() {
            break;
        }
        std::thread::yield_now();
    }
    producer.join().unwrap();
    actual.extend(take(&output));
    assert_eq!(actual, expected);
}

#[test]
fn base64_carry_matches_one_shot_encoding_across_arbitrary_drains() {
    let output = PtyOutput::default();
    let mut expected = Vec::new();
    for n in 0..1000 {
        let bytes: Vec<u8> = (0..(n * 73 % 513)).map(|i| (i + n) as u8).collect();
        output.push(&bytes).unwrap();
        expected.extend(bytes);
        if n % 7 == 0 {
            let pending = output.pending.lock().unwrap();
            assert!(pending.tail.len() < 3);
            assert!(pending.data.len() <= OUTPUT_CAP.div_ceil(3) * 4);
            drop(pending);
            assert_eq!(take(&output), expected);
            expected.clear();
        }
    }
    assert_eq!(take(&output), expected);
}
