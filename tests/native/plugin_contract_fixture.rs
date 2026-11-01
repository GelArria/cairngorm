use super::super::{
    catalog::{Auth, PluginSpec},
    http,
    upstream::Upstream,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub struct Server {
    pub plugin: &'static PluginSpec,
    pub upstream: Arc<Upstream>,
    pub messages: Arc<Mutex<Vec<Value>>>,
    address: std::net::SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Server {
    pub fn new(id: &'static str) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let plugin = Box::leak(Box::new(PluginSpec {
            id,
            name: "Custom Canvas",
            description: "Create interactive project diagrams.",
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
        let messages = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (log, stopped) = (messages.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            let mut canvases = HashMap::<String, Value>::new();
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                let request = http::read_request(&mut stream).unwrap();
                let message: Value = serde_json::from_slice(&request.body).unwrap();
                log.lock().unwrap().push(message.clone());
                if message["id"].is_null() {
                    http::respond(&mut stream, "202 Accepted", &[], b"");
                    continue;
                }
                let session = request
                    .header("mcp-session-id")
                    .map(String::from)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                let result = match message["method"].as_str().unwrap() {
                    "initialize" => {
                        json!({"protocolVersion":"2025-06-18", "capabilities":{}, "instructions":"Use the canvas schema for this plugin only."})
                    }
                    "tools/list" => {
                        let mut tools = json!([
                            {"name":"draw", "title":"Draw", "description":"Draw a diagram.", "inputSchema":{"type":"object", "properties":{"label":{"type":"string"}}}, "_meta":{"ui":{"resourceUri":"ui://canvas/main"}}},
                            {"name":"lookup", "description":"Look up a shape.", "inputSchema":{"type":"object"}, "annotations":{"readOnlyHint":true}},
                            {"name":"app_only", "inputSchema":{"type":"object"}, "_meta":{"ui":{"visibility":["app"]}}}
                        ]);
                        if !canvases.is_empty() {
                            tools.as_array_mut().unwrap().push(json!({"name":"_exec_callback", "inputSchema":{"type":"object"}, "_meta":{"ui":{"visibility":["app"]}}}));
                        }
                        json!({"tools":tools})
                    }
                    "resources/read" => {
                        let failed_refresh = message["params"]["uri"]
                            == "ui://canvas/fail-after-first"
                            && log
                                .lock()
                                .unwrap()
                                .iter()
                                .filter(|item| item["method"] == "resources/read")
                                .count()
                                > 1;
                        if failed_refresh {
                            json!({"contents":[]})
                        } else {
                            let label = canvases
                                .get(&session)
                                .and_then(Value::as_str)
                                .unwrap_or("Canvas");
                            json!({"contents":[{"uri":message["params"]["uri"], "mimeType":"text/html;profile=mcp-app", "text":format!("<html><body>{label}</body></html>"), "_meta":{"ui":{}}}]})
                        }
                    }
                    "tools/call" => {
                        if message["params"]["name"] == "draw" {
                            canvases.insert(
                                session.clone(),
                                message["params"]["arguments"]["label"].clone(),
                            );
                        }
                        if message["params"]["name"] == "fail" {
                            json!({"isError":true, "content":[{"type":"text", "text":"Fixture failure"}]})
                        } else {
                            json!({"content":[{"type":"text", "text":"Rendered"}], "structuredContent":{"label":canvases.get(&session)}})
                        }
                    }
                    method => panic!("Unexpected method {method}"),
                };
                let reply = json!({"jsonrpc":"2.0", "id":message["id"], "result":result});
                http::respond(
                    &mut stream,
                    "200 OK",
                    &[
                        ("Content-Type", "application/json".into()),
                        ("Mcp-Session-Id", session),
                    ],
                    reply.to_string().as_bytes(),
                );
            }
        });
        Self {
            plugin,
            upstream: Arc::new(Upstream::new(plugin)),
            messages,
            address,
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
        self.thread.take().unwrap().join().unwrap();
    }
}
