use std::{hint::black_box, path::Path, sync::atomic::AtomicBool, time::Instant};
use base64::Engine;

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

fn measure(mut f: impl FnMut(), repeats: usize) -> f64 {
    f(); // warm up
    median((0..7).map(|_| {
        let start = Instant::now();
        for _ in 0..repeats { f(); }
        start.elapsed().as_secs_f64() * 1000.0 / repeats as f64
    }).collect())
}

#[derive(serde::Serialize)]
struct Payload { data: String }

fn payload(bytes: &[u8]) -> String {
    serde_json::to_string(&Payload { data: base64::engine::general_purpose::STANDARD.encode(bytes) }).unwrap()
}

fn main() {
    let cancel = AtomicBool::new(false);
    let path = Path::new("fixture.txt");
    // Differential checks include CRLF, astral Unicode, anchors, multiple hits,
    // capped results, long snippets, zero-width regex and requested context.
    let texts = ["".into(), "before\r\n🦀 needle needle\r\nafter\r\n".into(),
        "needle\n".repeat(1000), format!("{}needle{}", "é".repeat(10_000), "z".repeat(10_000))];
    let mut checks = 0;
    for text in &texts {
        for query in ["needle", "^", "needle$", "🦀", "absent"] {
            for context in [0, 1, 3] {
                let re = after::build_regex(query, true, false, true).unwrap();
                let a = before::scan_file(path, text, &re, &cancel, context);
                let b = after::scan_file(path, text, &re, &cancel, context);
                assert_eq!(serde_json::to_value(a).unwrap(), serde_json::to_value(b).unwrap());
                checks += 1;
            }
        }
    }
    println!("Search differential correctness: {checks} cases passed");
    let re = after::build_regex("needle", true, false, false).unwrap();
    let fixtures = [("dense, early cap", "needle\n".repeat(290_000), 0),
        ("sparse, last line", format!("{}needle\n", "x\n".repeat(900_000)), 0),
        ("dense, context=3", "needle\n".repeat(290_000), 3)];
    for (name, text, context) in fixtures {
        let old = measure(|| { black_box(before::scan_file(path, black_box(&text), &re, &cancel, context)); }, 20);
        let new = measure(|| { black_box(after::scan_file(path, black_box(&text), &re, &cancel, context)); }, 20);
        println!("Search {name}: {old:.3} -> {new:.3} ms/call; {:.2}x", old / new);
    }

    let bytes = vec![42u8; 4096];
    let chunks = 80 * 1024 * 1024 / bytes.len();
    let queue = output::PtyOutput::default();
    let (mut callbacks, mut emitted) = (0usize, 0usize);
    for i in 0..chunks {
        callbacks += usize::from(queue.push(&bytes).unwrap());
        if (i + 1) % 16 == 0 { emitted += base64::engine::general_purpose::STANDARD.decode(queue.take()).unwrap().len(); }
    }
    emitted += base64::engine::general_purpose::STANDARD.decode(queue.take()).unwrap().len();
    queue.stop();
    assert_eq!(emitted, chunks * bytes.len());
    assert_eq!(callbacks, chunks / 16);
    println!("PTY simulated 16-read bursts, 80 MiB: {chunks} -> {callbacks} callbacks; all {emitted} bytes retained; pending <= {} bytes", output::OUTPUT_CAP);
    // Same 64 KiB: includes the actual queue, base64 carry and struct JSON.
    // Does NOT model WebView IPC, frame rate, input latency or OS scheduling.
    let queue = output::PtyOutput::default();
    let old = measure(|| { for _ in 0..16 { black_box(payload(black_box(&bytes))); } }, 100);
    let new = measure(|| {
        for _ in 0..16 { black_box(queue.push(black_box(&bytes)).unwrap()); }
        black_box(serde_json::to_string(&Payload { data: queue.take() }).unwrap());
    }, 100);
    println!("PTY queue+base64+JSON per 64 KiB: {old:.3} -> {new:.3} ms; {:.2}x (no WebView IPC)", old / new);
}
