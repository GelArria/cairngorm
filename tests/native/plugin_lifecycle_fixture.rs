use super::super::{
    catalog::{Auth, PluginSpec},
    http,
    upstream::Upstream,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

#[derive(Default)]
struct Session {
    callback: bool,
    snapshot: Option<Value>,
}
#[derive(Default)]
struct State {
    sessions: HashMap<String, Session>,
    messages: Vec<Value>,
    exec_started: bool,
    fail_save: bool,
}

pub struct Server {
    pub plugin: &'static PluginSpec,
    pub upstream: Arc<Upstream>,
    state: Arc<(Mutex<State>, Condvar)>,
    stop: Arc<AtomicBool>,
    address: std::net::SocketAddr,
    thread: Option<std::thread::JoinHandle<()>>,
    workers: Arc<Mutex<Vec<std::thread::JoinHandle<()>>>>,
}
impl Server {
    pub fn new() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let plugin = Box::leak(Box::new(PluginSpec {
            id: "tldraw",
            name: "tldraw fixture",
            description: "Checkpoint fixture",
            category: "Creativity",
            logo: "",
            server_url: Box::leak(format!("http://{address}/mcp").into_boxed_str()),
            homepage: "",
            terms: "",
            view_css: "",
            local_app: false,
            auth: Auth::None,
            document_provider: "",
            mcp: "",
        }));
        let state = Arc::new((Mutex::new(State::default()), Condvar::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let workers = Arc::new(Mutex::new(Vec::new()));
        let (shared, stopped, threads) = (state.clone(), stop.clone(), workers.clone());
        let thread = std::thread::spawn(move || {
            for stream in listener.incoming() {
                let stream = stream.unwrap();
                if stopped.load(Ordering::Acquire) {
                    break;
                }
                let shared = shared.clone();
                threads
                    .lock()
                    .unwrap()
                    .push(std::thread::spawn(move || Self::handle(stream, &shared)));
            }
        });
        Self {
            plugin,
            upstream: Arc::new(Upstream::new(plugin)),
            state,
            stop,
            address,
            thread: Some(thread),
            workers,
        }
    }
    pub fn wait_for_exec(&self) {
        Self::wait(&self.state);
    }
    fn wait(state: &Arc<(Mutex<State>, Condvar)>) {
        let (lock, changed) = &**state;
        let (guard, timeout) = changed
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(5), |s| {
                !s.exec_started
            })
            .unwrap();
        assert!(!timeout.timed_out() && guard.exec_started);
    }
    pub fn fail_save(&self) {
        self.state.0.lock().unwrap().fail_save = true;
    }
    pub fn messages(&self) -> Vec<Value> {
        self.state.0.lock().unwrap().messages.clone()
    }
    pub fn callback_worker(
        &self,
        call: Arc<super::super::calls::Call>,
    ) -> std::thread::JoinHandle<()> {
        let state = self.state.clone();
        let upstream = self.upstream.clone();
        std::thread::spawn(move || {
            Self::wait(&state);
            super::super::view_requests::request(
                &call,
                &upstream,
                "tools/call",
                json!({"name":"_exec_callback","arguments":{"success":true}}),
            )
            .unwrap();
        })
    }
    fn handle(mut stream: TcpStream, shared: &Arc<(Mutex<State>, Condvar)>) {
        let request = http::read_request(&mut stream).unwrap();
        let message: Value = serde_json::from_slice(&request.body).unwrap();
        let session = request
            .header("mcp-session-id")
            .map(String::from)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let (lock, changed) = &**shared;
        let mut state = lock.lock().unwrap();
        state.messages.push(message.clone());
        if message["id"].is_null() {
            drop(state);
            http::respond(&mut stream, "202 Accepted", &[], b"");
            return;
        }
        let result = match message["method"].as_str().unwrap() {
            "initialize" => json!({"protocolVersion":"2025-06-18","capabilities":{}}),
            "tools/list" => json!({"tools":[
                {"name":"exec","inputSchema":{"type":"object"},"_meta":{"ui":{"resourceUri":"ui://canvas/main","visibility":["model"]}}},
                {"name":"_exec_callback","inputSchema":{"type":"object"},"_meta":{"ui":{"visibility":["app"]}}},
                {"name":"save_checkpoint","inputSchema":{"type":"object"},"_meta":{"ui":{"visibility":["app"]}}},
                {"name":"read_checkpoint","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":true},"_meta":{"ui":{"visibility":["app"]}}}
            ]}),
            "resources/read" => {
                let snapshot = state
                    .sessions
                    .get(&session)
                    .and_then(|s| s.snapshot.clone())
                    .unwrap_or(json!({"checkpointId":"old","shapes":[],"assets":[],"bindings":[]}));
                let mut bootstrap = snapshot;
                bootstrap["sessionId"] = json!(format!("fresh-{session}"));
                bootstrap["mcpSessionId"] = json!(session);
                bootstrap["canvasId"] = json!("canvas-A");
                let html=format!("<html><script>window.__TLDRAW_BOOTSTRAP__=JSON.parse(atob(\"{}\"));</script></html>",STANDARD.encode(bootstrap.to_string()));
                json!({"contents":[{"uri":"ui://canvas/main","mimeType":"text/html;profile=mcp-app","text":html,"_meta":{"ui":{}}}]})
            }
            "tools/call" => match message["params"]["name"].as_str().unwrap() {
                "exec" => {
                    state.exec_started = true;
                    changed.notify_all();
                    let (next, timeout) = changed
                        .wait_timeout_while(state, Duration::from_secs(5), |s| {
                            !s.sessions.get(&session).is_some_and(|s| s.callback)
                        })
                        .unwrap();
                    state = next;
                    assert!(
                        !timeout.timed_out(),
                        "exec callback could not reach the concurrent fixture"
                    );
                    json!({"content":[],"structuredContent":{"canvasId":"canvas-A","checkpointId":"exec-is-not-a-save","tldrawRecords":[]}})
                }
                "_exec_callback" => {
                    state.sessions.entry(session.clone()).or_default().callback = true;
                    changed.notify_all();
                    json!({"content":[]})
                }
                "save_checkpoint" => {
                    if state.fail_save {
                        json!({"isError":true,"content":[{"type":"text","text":"Fixture save rejected"}]})
                    } else {
                        let args = &message["params"]["arguments"];
                        state.sessions.entry(session.clone()).or_default().snapshot = Some(
                            json!({"checkpointId":args["checkpointId"],"shapes":serde_json::from_str::<Value>(args["shapesJson"].as_str().unwrap()).unwrap(),"assets":[],"bindings":[]}),
                        );
                        json!({"content":[]})
                    }
                }
                "read_checkpoint" => {
                    json!({"structuredContent":state.sessions.get(&session).and_then(|s|s.snapshot.clone())})
                }
                other => panic!("Unexpected tool {other}"),
            },
            other => panic!("Unexpected method {other}"),
        };
        drop(state);
        let body = json!({"jsonrpc":"2.0","id":message["id"],"result":result}).to_string();
        http::respond(
            &mut stream,
            "200 OK",
            &[
                ("Content-Type", "application/json".into()),
                ("Mcp-Session-Id", session),
            ],
            body.as_bytes(),
        );
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        let _ = TcpStream::connect(self.address);
        self.thread.take().unwrap().join().unwrap();
        for worker in self.workers.lock().unwrap().drain(..) {
            worker.join().unwrap();
        }
    }
}
