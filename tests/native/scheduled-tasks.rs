use super::{
    runner::parse_result,
    store::Store,
    task::{now, Task, TaskInput},
};

fn input() -> TaskInput {
    TaskInput {
        id: Some("task-1".into()),
        title: "Review changes".into(),
        prompt: "Summarize risks without committing.".into(),
        project_id: "project-1".into(),
        project_name: "Project".into(),
        root_path: std::env::temp_dir().to_string_lossy().into_owned(),
        agent: "cairngorm".into(),
        next_at: now() + 3600,
        interval_minutes: None,
    }
}
fn task() -> Task {
    Task {
        input: input(),
        enabled: true,
        requested: false,
        status: "scheduled".into(),
        last_run: None,
        output: String::new(),
        changes: None,
    }
}
fn path() -> std::path::PathBuf {
    std::env::temp_dir()
        .join(format!("cairngorm-schedule-{}", uuid::Uuid::new_v4()))
        .join("tasks.json")
}

#[test]
fn validates_schedule_at_the_native_boundary() {
    assert!(input().validate().is_ok());
    let mut draft = input();
    draft.prompt.clear();
    assert!(draft.validate().is_err());
    draft = input();
    draft.agent = "shell".into();
    assert!(draft.validate().is_err());
    draft = input();
    draft.interval_minutes = Some(0);
    assert!(draft.validate().is_err());
    draft.interval_minutes = Some(u64::MAX);
    assert!(draft.validate().is_err());
    draft = input();
    draft.next_at = now() - 1;
    assert!(draft.validate().is_err());
    draft = input();
    draft.root_path = ".".into();
    assert!(draft.validate().is_err());
}

#[test]
fn one_time_claim_is_disabled_and_cannot_overlap() {
    let mut saved = task();
    saved.input.next_at = 10;
    assert!(saved.due(10));
    saved.claim(10);
    assert_eq!(saved.status, "running");
    assert_eq!(saved.last_run, Some(10));
    assert!(!saved.enabled);
    assert!(!saved.due(100));
    saved.status = "succeeded".into();
    assert!(!saved.due(100));
}

#[test]
fn interval_coalesces_missed_runs_and_manual_run_keeps_pause() {
    let mut saved = task();
    saved.input.next_at = 10;
    saved.input.interval_minutes = Some(5);
    saved.claim(10_000);
    assert_eq!(saved.input.next_at, 10_300);
    saved.status = "succeeded".into();
    saved.enabled = false;
    assert!(!saved.due(20_000));
    saved.requested = true;
    assert!(saved.due(20_000));
    saved.claim(20_000);
    assert!(!saved.enabled);
    assert!(!saved.requested);
}

#[test]
fn restart_pauses_uncertain_runs_without_losing_other_tasks() {
    let path = path();
    let mut store = Store::open(path.clone()).unwrap();
    let mut running = task();
    running.claim(now());
    let mut other = task();
    other.input.id = Some("other".into());
    store.commit(vec![running, other]).unwrap();
    drop(store);
    let restored = Store::open(path.clone()).unwrap();
    assert_eq!(restored.tasks.len(), 2);
    assert_eq!(restored.tasks[0].status, "interrupted");
    assert!(!restored.tasks[0].enabled);
    assert!(restored.tasks[1].enabled);
    drop(restored);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
#[ignore = "Child process used by killing_a_runner_pauses_its_durable_claim"]
fn interrupted_runner_child() {
    let path =
        std::path::PathBuf::from(std::env::var_os("CAIRNGORM_SCHEDULER_TEST_STORE").unwrap());
    let mut store = Store::open(path.clone()).unwrap();
    let mut due = task();
    due.input.next_at = now() - 5;
    due.input.interval_minutes = Some(1);
    store.commit(vec![due]).unwrap();
    let state = super::store::Scheduler(std::sync::Mutex::new(Ok(store)));
    super::tick(&state, |_| {
        std::fs::write(path.with_extension("started"), "one launch").unwrap();
        loop {
            std::thread::park();
        }
    });
}

#[test]
fn killing_a_runner_pauses_its_durable_claim() {
    struct Runner(std::process::Child);
    impl Drop for Runner {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let path = path();
    let mut runner = Runner(
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "scheduled_tasks::tests::interrupted_runner_child",
                "--ignored",
            ])
            .env("CAIRNGORM_SCHEDULER_TEST_STORE", &path)
            .spawn()
            .unwrap(),
    );
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !path.with_extension("started").exists() {
        assert!(
            runner.0.try_wait().unwrap().is_none(),
            "Runner exited before dispatch"
        );
        assert!(
            std::time::Instant::now() < deadline,
            "Runner did not dispatch"
        );
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let persisted: Vec<Task> = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(persisted[0].status, "running");
    assert!(
        Store::open(path.clone()).is_err(),
        "Live runner must own the lease"
    );
    runner.0.kill().unwrap();
    runner.0.wait().unwrap();
    for _ in 0..2 {
        let store = Store::open(path.clone()).unwrap();
        assert_eq!(store.tasks[0].status, "interrupted");
        assert!(!store.tasks[0].enabled);
        assert!(!store.tasks[0].requested);
        assert!(!store.tasks[0].due(now() + 3600));
        let state = super::store::Scheduler(std::sync::Mutex::new(Ok(store)));
        super::tick(&state, |_| {
            panic!("Interrupted tasks must never restart automatically")
        });
    }
    assert_eq!(
        std::fs::read_to_string(path.with_extension("started")).unwrap(),
        "one launch"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn failed_persistence_keeps_the_previous_in_memory_state() {
    let root = path();
    std::fs::create_dir_all(root.parent().unwrap()).unwrap();
    std::fs::write(&root, "not a directory").unwrap();
    let mut store = Store::open(root.with_extension("valid")).unwrap();
    store.tasks = vec![task()];
    store.path = root.join("tasks.json");
    assert!(store.commit(Vec::new()).is_err());
    assert_eq!(store.tasks.len(), 1);
    drop(store);
    std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
}

#[test]
fn only_one_app_instance_can_own_the_scheduler() {
    let path = path();
    let store = Store::open(path.clone()).unwrap();
    assert!(Store::open(path.clone()).is_err());
    drop(store);
    let reopened = Store::open(path.clone()).unwrap();
    drop(reopened);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn corrupt_store_is_not_silently_replaced() {
    let path = path();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, "broken json").unwrap();
    assert!(Store::open(path.clone()).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken json");
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn worker_claims_durably_before_dispatch_and_records_the_actual_result() {
    let path = path();
    let mut store = Store::open(path.clone()).unwrap();
    let mut due = task();
    due.input.next_at = now() - 5;
    store.commit(vec![due]).unwrap();
    let state = super::store::Scheduler(std::sync::Mutex::new(Ok(store)));
    super::tick(&state, |_| {
        let guard = state
            .0
            .try_lock()
            .expect("Agent runs outside the store lock");
        assert_eq!(guard.as_ref().unwrap().tasks[0].status, "running");
        let persisted: Vec<Task> =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(persisted[0].status, "running");
        Ok("Completed agent answer".into())
    });
    let guard = state.0.lock().unwrap();
    assert_eq!(guard.as_ref().unwrap().tasks[0].status, "succeeded");
    assert_eq!(
        guard.as_ref().unwrap().tasks[0].output,
        "Completed agent answer"
    );
    drop(guard);
    super::tick(&state, |_| {
        panic!("A one-time task must not dispatch twice")
    });
    drop(state);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn completion_requires_a_successful_agent_result_not_just_dispatch() {
    assert_eq!(
        parse_result(true, r#"{"success":true,"output":"Reviewed"}"#).unwrap(),
        "Reviewed"
    );
    assert!(parse_result(
        true,
        r#"{"success":false,"output":"Provider rejected the run"}"#
    )
    .is_err());
    assert!(parse_result(false, r#"{"success":true,"output":"Partial result"}"#).is_err());
    assert!(parse_result(true, r#"{"type":"sidecar_ready"}"#).is_err());
    assert!(parse_result(true, "").is_err());
}
