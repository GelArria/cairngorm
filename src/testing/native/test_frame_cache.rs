use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::http::{Request, Response};
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_FRAMES: usize = 128;
struct Frame {
    id: String,
    owner: String,
    page: String,
    bytes: Arc<Vec<u8>>,
}
#[derive(Default)]
struct Cache {
    frames: VecDeque<Frame>,
    bytes: usize,
}
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
impl Cache {
    fn remove(&mut self, position: usize) {
        if let Some(frame) = self.frames.remove(position) {
            self.bytes -= frame.bytes.len();
        }
    }
    fn store(&mut self, owner: &str, page: &str, bytes: Vec<u8>) -> Option<String> {
        if bytes.len() > 1_350_000
            || !bytes.starts_with(&[0xff, 0xd8])
            || !bytes.ends_with(&[0xff, 0xd9])
        {
            return None;
        }
        // A stable page capability serves its newest JPEG even if renderer delivery stalls.
        let id = if let Some(position) = self
            .frames
            .iter()
            .position(|f| f.owner == owner && f.page == page)
        {
            let id = self.frames[position].id.clone();
            self.remove(position);
            id
        } else {
            uuid::Uuid::new_v4().to_string()
        };
        self.bytes += bytes.len();
        self.frames.push_back(Frame {
            id: id.clone(),
            owner: owner.into(),
            page: page.into(),
            bytes: Arc::new(bytes),
        });
        while self.frames.len() > MAX_FRAMES || self.bytes > MAX_BYTES {
            self.remove(0);
        }
        Some(id)
    }
    fn snapshot(&mut self, id: &str) -> Option<String> {
        let frame = self.frames.iter().find(|frame| frame.id == id)?;
        let owner = frame.owner.clone();
        let bytes = frame.bytes.as_ref().clone();
        self.store(&owner, &format!("snapshot-{}", uuid::Uuid::new_v4()), bytes)
    }
}
pub fn snapshot(id: &str) -> Option<String> {
    CACHE.get()?.lock().ok()?.snapshot(id)
}
pub fn store(owner: &str, page: &str, bytes: Vec<u8>) -> Option<String> {
    CACHE
        .get_or_init(|| Mutex::new(Cache::default()))
        .lock()
        .ok()?
        .store(owner, page, bytes)
}
pub fn response(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let key = request.uri().path().trim_start_matches('/');
    let bytes = if request.method() == "GET" && uuid::Uuid::parse_str(key).is_ok() {
        CACHE.get().and_then(|cache| {
            cache
                .lock()
                .ok()?
                .frames
                .iter()
                .find(|f| f.id == key)
                .map(|f| f.bytes.clone())
        })
    } else {
        None
    };
    Response::builder()
        .status(if bytes.is_some() { 200 } else { 404 })
        .header("Content-Type", "image/jpeg")
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .body(bytes.map(|data| data.as_ref().clone()).unwrap_or_default())
        .unwrap()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paused_snapshot_does_not_change_when_live_page_updates() {
        let mut cache = Cache::default();
        let original = vec![0xff, 0xd8, 1, 0xff, 0xd9];
        let live = cache.store("terminal", "page", original.clone()).unwrap();
        let snapshot = cache.snapshot(&live).unwrap();
        assert_ne!(live, snapshot);
        cache.store("terminal", "page", vec![0xff, 0xd8, 2, 0xff, 0xd9]);
        assert_eq!(
            *cache
                .frames
                .iter()
                .find(|frame| frame.id == snapshot)
                .unwrap()
                .bytes,
            original
        );
        assert!(cache.snapshot("missing").is_none());
    }
    #[test]
    fn bounded_binary_cache_keeps_stable_page_capabilities_and_never_reads_paths() {
        let mut cache = Cache::default();
        let jpeg = vec![0xff, 0xd8, 0xff, 0xd9];
        let id = cache.store("terminal", "page", jpeg.clone()).unwrap();
        for _ in 0..100 {
            assert_eq!(cache.store("terminal", "page", jpeg.clone()).unwrap(), id);
        }
        assert_eq!(cache.frames.len(), 1);
        for n in 0..1000 {
            cache
                .store("terminal", &n.to_string(), jpeg.clone())
                .unwrap();
        }
        assert_eq!(cache.frames.len(), MAX_FRAMES);
        assert!(cache.bytes <= MAX_BYTES);
        assert!(cache
            .store("terminal", "page", vec![0; 1_350_001])
            .is_none());
        assert!(cache
            .store("terminal", "page", b"not JPEG".to_vec())
            .is_none());
        let mut large = vec![0; 1_350_000];
        large[..2].copy_from_slice(&[0xff, 0xd8]);
        large[1_349_998..].copy_from_slice(&[0xff, 0xd9]);
        for n in 0..100 {
            cache.store("large", &n.to_string(), large.clone()).unwrap();
        }
        assert!(cache.bytes <= MAX_BYTES);
        let id = store("response-test", "page", jpeg).unwrap();
        let ok = response(
            Request::get(format!("test-frame://localhost/{id}"))
                .body(vec![])
                .unwrap(),
        );
        assert_eq!(ok.status(), 200);
        assert_eq!(ok.headers()["Content-Type"], "image/jpeg");
        assert_eq!(
            response(
                Request::get("test-frame://localhost/../../secret")
                    .body(vec![])
                    .unwrap()
            )
            .status(),
            404
        );
    }
}
