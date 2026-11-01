use super::*;

fn run(text: &str) -> TestUpdate {
    let mut observer = TestObserver::new("pty-1");
    observer.push(text.as_bytes());
    observer
        .take_update()
        .expect("test output must produce a run")
}

#[test]
fn recognizes_all_supported_runners_and_final_counts() {
    for (text, runner, status, passed, failed) in [
        (" RUN v4.0.0 /repo\n ✓ utf8-λ.test.ts > passes\n Tests 2 passed (2)\n", "Vitest", "passed", 2, 0),
        ("Running 3 tests using 1 worker\n ✓ 1 signs in (1s)\n ✘ 2 rejects (1s)\n 1 failed\n 2 passed (3s)\n", "Playwright", "failed", 2, 1),
        (" RUNS login.test.ts\nPASS login.test.ts\nTests: 3 passed, 3 total\n", "Jest", "passed", 3, 0),
        ("==== test session starts ====\ntests/test_auth.py::login PASSED [50%]\ntests/test_auth.py::bad FAILED [100%]\n==== 1 failed, 1 passed in 0.3s ====\n", "pytest", "failed", 1, 1),
        ("running 2 tests\ntest login ... ok\ntest bad ... FAILED\ntest result: FAILED. 1 passed; 1 failed; 0 ignored;\n", "Cargo", "failed", 1, 1),
        ("bun test v1.3.0\n(pass) login [1ms]\n2 pass\n0 fail\nRan 2 tests across 1 file. [2ms]\n", "Bun", "passed", 2, 0),
        ("=== RUN TestLogin\n--- PASS: TestLogin (0.00s)\nok app/auth 0.01s\n", "Go", "passed", 1, 0),
        ("TAP version 13\nok 1 - login\nnot ok 2 - password\n# tests 2\n# pass 1\n# fail 1\n# duration_ms 20\n", "Node", "failed", 1, 1),
    ] {
        let update = run(text);
        assert!(update.started);
        assert_eq!(update.run.runner, runner);
        assert_eq!(update.run.status, status);
        assert_eq!((update.run.passed, update.run.failed), (passed, failed));
    }
}

#[test]
fn fragmented_unicode_ansi_and_redraws_preserve_one_execution() {
    let mut observer = TestObserver::new("pty-1");
    for byte in
        "\x1b[32m RUN v4.0.0 /repo\x1b[0m\r\n ✓ utf8-λ🦀.test.ts > passes\r\n Tests 2 passed (2)\n"
            .as_bytes()
    {
        observer.push(&[*byte]);
    }
    let first = observer.take_update().unwrap();
    observer.push(
        "\x1b[?2026h\x1b[2J\x1b[H RUN v4.0.0 /repo\n Tests 2 passed (2)\n\x1b[?2026l".as_bytes(),
    );
    assert!(observer.take_update().is_none());
    assert_eq!(first.run.id, 1);
    assert!(first.run.results[0].name.contains("utf8-λ🦀"));
    assert!(first.run.output.iter().all(|s| !s.contains('\x1b')));
    observer.push(b" RUN v4.0.0 /repo\n");
    assert_eq!(observer.take_update().unwrap().run.id, 2);
}

#[test]
fn cargo_suites_and_verbose_go_packages_accumulate() {
    let cargo = run("Finished `test` profile target(s) in 0.1s\nRunning unittests src/lib.rs (target/debug/deps/lib)\nrunning 2 tests\ntest auth ... ok\ntest logout ... ok\ntest result: ok. 2 passed; 0 failed; 0 ignored;\nDoc-tests app\nrunning 0 tests\ntest result: ok. 0 passed; 0 failed; 0 ignored;\n");
    assert_eq!((cargo.run.passed, cargo.run.total), (2, Some(2)));
    let go = run("=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/auth 0.012s\n=== RUN TestShared\n--- PASS: TestShared (0.00s)\nok app/config 0.010s\n");
    assert_eq!(go.run.passed, 2);
    assert!(go
        .run
        .results
        .iter()
        .any(|row| row.name == "app/auth › TestShared"));
    assert!(go
        .run
        .results
        .iter()
        .any(|row| row.name == "app/config › TestShared"));
}

#[test]
fn watch_restart_clears_failures_and_teardown_preserves_summaries() {
    let mut observer = TestObserver::new("pty-1");
    observer.push(
        b" DEV v4.0.0 /repo\n Tests 1 failed (1)\n RERUN auth.test.ts x1\n Tests 1 passed (1)\n",
    );
    observer.finish();
    let update = observer.take_update().unwrap();
    assert_eq!(
        (update.run.id, update.run.passed, update.run.failed),
        (2, 1, 0)
    );
    assert_eq!(update.run.status, "passed");
}

#[test]
fn ordinary_output_has_no_snapshots_and_active_memory_is_bounded() {
    let mut observer = TestObserver::new("pty-1");
    observer.push(
        b"We should run npx vitest next.\n$ npx playwright test\n\xe2\x9c\x93 built in 20ms\n",
    );
    assert!(observer.take_update().is_none());
    observer.push(b"Running 2000 tests using 1 worker\n");
    for i in 0..2000 {
        observer.push(format!("✓ case {i}\n").as_bytes());
    }
    let update = observer.take_update().unwrap();
    assert_eq!(update.run.output.len(), 600);
    assert_eq!(update.run.results.len(), 500);
    observer.finish();
    assert_eq!(observer.take_update().unwrap().run.status, "interrupted");
}

#[test]
fn recreating_an_observer_restarts_revisions_in_a_new_generation() {
    let mut old = TestObserver::new("same-id");
    old.push("Running 2 tests using 1 worker\n✓ first\n✓ second\n2 passed\n".as_bytes());
    let first = old.take_update().unwrap();
    let mut next = TestObserver::new("same-id");
    next.push(b"Running 1 test using 1 worker\n1 passed\n");
    let second = next.take_update().unwrap();
    assert!(second.generation > first.generation);
    assert!(second.revision < first.revision);
    assert_eq!(next.snapshot().unwrap().generation, second.generation);
}

#[test]
fn arbitrary_terminal_counts_cannot_overflow_the_reader() {
    let max = usize::MAX;
    let update = run(&format!(
        " RUN v4.0.0 /repo\n Tests {max} passed | {max} passed | {max} failed\n"
    ));
    assert_eq!(update.run.passed, max);
    assert_eq!(update.run.total, Some(max));
}

#[test]
#[ignore = "Invoked by tests/native/test-observer-parity.mjs"]
fn export_parser_parity() {
    let input = std::fs::read(std::env::var("TEST_OBSERVER_INPUT").unwrap()).unwrap();
    let corpus: serde_json::Value = serde_json::from_slice(&input).unwrap();
    let runs: Vec<_> = corpus
        .as_array()
        .unwrap()
        .iter()
        .map(|case| {
            let mut observer = TestObserver::new("parity");
            for chunk in case["text"]
                .as_str()
                .unwrap()
                .as_bytes()
                .chunks(case["size"].as_u64().unwrap() as usize)
            {
                observer.push(chunk);
            }
            observer.finish();
            observer.snapshot().map(|update| update.run)
        })
        .collect();
    std::fs::write(
        std::env::var("TEST_OBSERVER_OUTPUT").unwrap(),
        serde_json::to_vec(&runs).unwrap(),
    )
    .unwrap();
}

#[test]
fn snapshot_wire_keys_match_frontend_contract() {
    let update = run("Running 1 test using 1 worker\n1 passed\n");
    let value = serde_json::to_value(update).unwrap();
    assert_eq!(value["run"]["sessionId"], "pty-1");
    assert!(value["run"]["startedAt"].is_number());
    assert!(value["run"]["endedAt"].is_number());
    assert_eq!(value["run"]["status"], "passed");
}
