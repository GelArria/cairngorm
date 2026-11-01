use super::*;
use std::{fs, io::BufRead, process::Stdio, sync::mpsc, time::Duration};
#[path = "plugin_file_scope_fixture.rs"]
mod fixture;

#[test]
fn a_direct_cli_pty_root_is_identified_before_stopping_the_process_walk() {
    let scratch = fixture::Scratch::new();
    let script = scratch
        .0
        .join("node_modules/@anthropic-ai/claude-code/cli.js");
    fs::create_dir_all(script.parent().unwrap()).unwrap();
    fs::write(&script, "const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)'], {stdio:'ignore'}); console.log(child.pid); setInterval(() => {}, 10000);").unwrap();
    let mut command = crate::ai_cli::command(&which::which("node").unwrap()).unwrap();
    let mut child = command
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let tree = crate::ai_process::ProcessTree::watch(&child).unwrap();
    let stdout = child.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut line = String::new();
        std::io::BufReader::new(stdout)
            .read_line(&mut line)
            .unwrap();
        let _ = send.send(line);
    });
    let bridge = receive
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let root = child.id();
    let found = walk_to(bridge, |pid| (pid == root).then(|| "direct-profile".into()));
    drop(tree);
    let _ = child.wait();
    reader.join().unwrap();
    assert_eq!(
        found,
        Found {
            terminal: Some("direct-profile".into()),
            agent_hint: Some("claude")
        }
    );
}

#[test]
fn file_tools_trust_the_walked_terminal_or_a_hosted_agent_with_a_live_terminal() {
    let walked = Found {
        terminal: Some("t1".into()),
        agent_hint: Some("claude"),
    };
    assert_eq!(walked.verified_agent(Some("t1")), Some("claude"));
    assert_eq!(walked.verified_agent(Some("t2")), None);
    let hosted = Found {
        terminal: None,
        agent_hint: Some("claude"),
    };
    assert_eq!(hosted.verified_agent(Some("t1")), Some("claude"));
    assert_eq!(hosted.verified_agent(None), None);
    assert_eq!(Found::default().verified_agent(Some("t1")), None);
}
