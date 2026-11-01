//! Tool calls rendered in a view. The view runs the work in the user's canvas and reports
//! back with `ui/update-model-context`, which CLI agents only see inside a tool result.
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

/// A view that reports twice in quick succession is still settling.
const QUIET: Duration = Duration::from_millis(400);
/// Without an initialized view there is nothing to wait for.
const NO_VIEW: Duration = Duration::from_secs(10);
const DEADLINE: Duration = Duration::from_secs(20);
const MAX_CONTEXT_CHARS: usize = 30_000;
const MAX_CALLS: usize = 64;

#[derive(Default)]
struct State {
    opened: bool,
    input_sent: bool,
    context: Option<Value>,
    context_at: Option<Instant>,
    closed: bool,
    mounts: usize,
    referenced: bool,
    pending: bool,
    opening: bool,
}

pub struct Call {
    pub plugin: &'static str,
    pub terminal: Option<String>,
    /// Agent CLI that made the call (`plugin_callers` id), when known.
    pub agent: Option<&'static str>,
    pub tool: Value,
    pub canvas: Mutex<Option<String>>,
    pub prepared_view: Mutex<Option<Value>>,
    pub revoked: AtomicBool,
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Default)]
struct Registry {
    calls: HashMap<String, Arc<Call>>,
    order: VecDeque<String>,
    /// Context the user produced after the last delivered result, per plugin and terminal.
    pending: HashMap<(String, String), Value>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(Default::default)
}

fn key(call: &Call) -> (String, String) {
    (
        call.plugin.to_string(),
        call.terminal.clone().unwrap_or_default(),
    )
}

pub fn start(
    plugin: &'static str,
    terminal: Option<String>,
    agent: Option<&'static str>,
    tool: Value,
) -> (String, Arc<Call>) {
    let id = uuid::Uuid::new_v4().to_string();
    let call = Arc::new(Call {
        plugin,
        terminal,
        agent,
        tool,
        canvas: Mutex::default(),
        prepared_view: Mutex::default(),
        revoked: AtomicBool::new(false),
        state: Mutex::new(State {
            pending: true,
            opening: true,
            referenced: true,
            ..State::default()
        }),
        changed: Condvar::new(),
    });
    let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
    registry.calls.insert(id.clone(), call.clone());
    registry.order.push_back(id.clone());
    drop(registry);
    trim_closed();
    (id, call)
}

pub fn get(id: &str) -> Option<Arc<Call>> {
    let registry = registry().lock().unwrap_or_else(|e| e.into_inner());
    registry.calls.get(id).cloned()
}

/// Lifecycle reports from the frontend host: `opened`, `input`, `context`, `closed`.
pub fn view_event(call: &Call, event: &str, payload: Value) -> Result<(), String> {
    let mut state = call.state.lock().map_err(|e| e.to_string())?;
    if call.revoked.load(Ordering::Acquire) {
        return Err("The source terminal has closed.".into());
    }
    match event {
        "opened" => {
            state.opened = true;
            state.closed = false;
            state.mounts += 1;
        }
        "input" => state.input_sent = true,
        "closed" => {
            state.mounts = state.mounts.saturating_sub(1);
            state.closed = state.mounts == 0;
        }
        "retained" => state.referenced = true,
        "released" => {
            state.referenced = false;
            state.closed = state.mounts == 0;
        }
        // A view reports its restored state before it receives the input; that is not news.
        "context" if state.input_sent => {
            state.context = Some(payload.clone());
            state.context_at = Some(Instant::now());
            let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
            registry.pending.insert(key(call), payload);
        }
        "context" => {}
        _ => return Err("Unknown view event".into()),
    }
    call.changed.notify_all();
    drop(state);
    trim_closed();
    Ok(())
}

pub fn opening_call_running(call: &Call) -> bool {
    call.state.lock().unwrap_or_else(|e| e.into_inner()).opening
}

pub fn upstream_finished(call: &Call) {
    call.state.lock().unwrap_or_else(|e| e.into_inner()).opening = false;
}

pub fn has_empty_context(call: &Call) -> bool {
    call.state
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .context
        .as_ref()
        .and_then(|context| context["structuredContent"]["shapes"].as_array())
        .is_some_and(Vec::is_empty)
}

pub fn complete(call: &Call) {
    {
        let mut state = call.state.lock().unwrap_or_else(|e| e.into_inner());
        state.pending = false;
        state.opening = false;
    }
    trim_closed();
}

fn trim_closed() {
    let snapshot = {
        let registry = registry().lock().unwrap_or_else(|e| e.into_inner());
        registry
            .order
            .iter()
            .filter_map(|id| Some((id.clone(), registry.calls.get(id)?.clone())))
            .collect::<Vec<_>>()
    };
    let eligible = |state: &State| !state.pending && !state.referenced && state.mounts == 0;
    let closed = snapshot
        .iter()
        .filter(|(_, call)| eligible(&call.state.lock().unwrap_or_else(|e| e.into_inner())))
        .count();
    let mut remaining = closed.saturating_sub(MAX_CALLS);
    for (id, call) in snapshot {
        if remaining == 0 {
            break;
        }
        // State then registry is the same lock order used by context reporting/settlement.
        let state = call.state.lock().unwrap_or_else(|e| e.into_inner());
        if eligible(&state) {
            let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
            registry.calls.remove(&id);
            registry.order.retain(|key| key != &id);
            remaining -= 1;
        }
    }
}

pub fn release_terminal(terminal: &str) {
    let released = {
        let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
        let ids = registry
            .calls
            .iter()
            .filter(|(_, call)| call.terminal.as_deref() == Some(terminal))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let released = ids
            .iter()
            .filter_map(|id| registry.calls.remove(id))
            .collect::<Vec<_>>();
        registry.order.retain(|id| !ids.contains(id));
        registry.pending.retain(|(_, source), _| source != terminal);
        released
    };
    for call in released {
        call.revoked.store(true, Ordering::Release);
        call.state.lock().unwrap_or_else(|e| e.into_inner()).closed = true;
        call.changed.notify_all();
    }
    // A context report already holding its state lock may have raced the registry removal.
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .pending
        .retain(|(_, source), _| source != terminal);
}

pub struct Settled {
    pub context: Option<Value>,
    pub opened: bool,
}

/// Wait, after the server answered, until the view has reported its outcome.
pub fn settle(call: &Call) -> Settled {
    let started = Instant::now();
    let mut state = call.state.lock().unwrap_or_else(|e| e.into_inner());
    loop {
        let now = Instant::now();
        let quiet = state.context_at.is_some_and(|at| now - at >= QUIET);
        let abandoned = !state.opened && now - started >= NO_VIEW;
        if quiet || abandoned || state.closed || now - started >= DEADLINE {
            break;
        }
        let wait = state.context_at.map_or(Duration::from_millis(250), |at| {
            QUIET.saturating_sub(now - at)
        });
        state = call
            .changed
            .wait_timeout(state, wait.max(Duration::from_millis(20)))
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
    let context = state.context.clone();
    if context.is_some() {
        let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
        registry.pending.remove(&key(call));
    }
    Settled {
        context,
        opened: state.opened,
    }
}

/// Context the user produced in an earlier view since that call returned.
pub fn take_pending(plugin: &str, terminal: Option<&str>) -> Option<Value> {
    let mut registry = registry().lock().unwrap_or_else(|e| e.into_inner());
    registry
        .pending
        .remove(&(plugin.to_string(), terminal.unwrap_or_default().to_string()))
}

/// The server's result plus what the view reported, as text blocks every agent can read.
/// `declared_output`: the tool has an outputSchema, so its structuredContent must stay.
pub fn compose(
    mut result: Value,
    earlier: Option<Value>,
    settled: Option<Settled>,
    plugin: &str,
    declared_output: bool,
) -> Value {
    if !result["content"].is_array() {
        result["content"] = json!([]);
    }
    let blocks = result["content"].as_array_mut().expect("content array");
    let reports_from = blocks.len();
    if let Some(earlier) = earlier {
        blocks.push(text(format!(
            "Since your last {plugin} call, the view in Cairngorm reported:\n{}",
            render(&earlier)
        )));
    }
    match settled {
        Some(Settled {
            context: Some(context),
            ..
        }) => blocks.push(text(format!(
            "The {plugin} view in Cairngorm reported:\n{}",
            render(&context)
        ))),
        Some(Settled { opened: false, .. }) => blocks.push(text(format!(
            "The {plugin} view is not on screen in Cairngorm yet (its project may be in the background). It runs this call once the user opens it; until then this result may be incomplete."
        ))),
        _ => {}
    }
    let reported = blocks.len() > reports_from;
    // Some agents show the model structuredContent instead of content when both exist,
    // which would hide the reports; the server's text keeps the same facts.
    if reported && !declared_output {
        if let Some(object) = result.as_object_mut() {
            object.remove("structuredContent");
        }
    }
    result
}

fn text(text: String) -> Value {
    json!({ "type": "text", "text": text })
}

pub fn render(context: &Value) -> String {
    let mut out = context["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n");
    if let Some(structured) = context.get("structuredContent").filter(|v| !v.is_null()) {
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&structured.to_string());
    }
    if out.chars().count() > MAX_CONTEXT_CHARS {
        out = out.chars().take(MAX_CONTEXT_CHARS).collect();
        out.push_str("\n… (truncated)");
    }
    out
}
