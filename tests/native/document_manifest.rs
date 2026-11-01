// cargo test --manifest-path src-tauri/Cargo.toml --lib --no-default-features documents
use super::*;
use serde_json::json;

fn manifest(patch: serde_json::Value) -> Result<Manifest, String> {
    let mut value = json!({
        "protocol": PROTOCOL,
        "id": "com.example.sample",
        "name": "Sample viewer",
        "version": "1.0.0",
        "entry": "index.html",
        "fileTypes": [{ "label": "Sample document", "extensions": [".Sample"], "mimeTypes": ["text/x-sample"] }],
        "capabilities": ["view"]
    });
    for (key, field) in patch.as_object().unwrap() {
        if field.is_null() {
            value.as_object_mut().unwrap().remove(key);
        } else {
            value[key] = field.clone();
        }
    }
    parse(value.to_string().as_bytes())
}

#[test]
fn accepts_a_minimal_view_provider_and_normalizes_extensions() {
    let parsed = manifest(json!({})).unwrap();
    assert_eq!(parsed.id, "com.example.sample");
    assert_eq!(parsed.file_types[0].extensions, vec!["sample"]);
    assert_eq!(parsed.capabilities, vec!["view"]);
    assert_eq!(parsed.max_bytes, 16 * 1024 * 1024);
}

#[test]
fn refuses_unknown_versions_fields_and_capabilities() {
    let cases = [
        json!({ "protocol": "cairngorm.document-provider/2" }),
        json!({ "network": ["example.com"] }),
        json!({ "capabilities": ["view", "operate"] }),
        json!({ "capabilities": [] }),
        json!({ "permissions": ["network"] }),
        json!({ "maxBytes": 64 * 1024 * 1024 }),
        json!({ "maxBytes": 0 }),
        json!({ "version": "one" }),
    ];
    for case in cases {
        assert!(manifest(case.clone()).is_err(), "{case}");
    }
    assert!(manifest(json!({ "permissions": [] })).is_ok());
    let editable = manifest(json!({ "capabilities": ["edit", "view", "edit"] })).unwrap();
    assert_eq!(editable.capabilities, vec!["view", "edit"]);
}

#[test]
fn refuses_unsafe_identity_entry_and_file_types() {
    let cases = [
        json!({ "id": "Example" }),
        json!({ "id": "cairngorm.docx" }),
        json!({ "id": "../evil" }),
        json!({ "name": "" }),
        json!({ "name": "a\u{0007}b" }),
        json!({ "entry": "../index.html" }),
        json!({ "entry": "/index.html" }),
        json!({ "entry": "main.js" }),
        json!({ "entry": "a\\b.html" }),
        json!({ "fileTypes": [] }),
        json!({ "fileTypes": [{ "label": "x", "extensions": ["a/b"] }] }),
        json!({ "fileTypes": [{ "label": "x", "extensions": [] }] }),
        json!({ "fileTypes": [{ "label": "x", "extensions": ["one"], "mimeTypes": ["nope"] }] }),
        json!({ "fileTypes": [{ "label": "x", "extensions": ["one"] }, { "label": "y", "extensions": ["ONE"] }] }),
        json!({ "fileTypes": [{ "label": "x", "extensions": ["one"], "icon": "x.svg" }] }),
        json!({ "id": null }),
        json!({ "fileTypes": [{ "label": "Notes", "extensions": ["md"] }] }),
        json!({ "fileTypes": [{ "label": "Code", "extensions": [".TS"] }] }),
    ];
    for case in cases {
        assert!(manifest(case.clone()).is_err(), "{case}");
    }
}

#[test]
fn refuses_oversized_or_malformed_documents() {
    assert!(parse(b"not json").is_err());
    assert!(parse(b"[]").is_err());
    assert!(parse(&vec![b' '; 70 * 1024]).is_err());
}

#[test]
fn operations_are_named_described_and_typed() {
    let parsed = manifest(json!({ "operations": [
        { "name": "set-field", "description": "Change one field.", "inputSchema": { "type": "object", "properties": { "key": { "type": "string" } } } },
        { "name": "list-fields", "description": "List fields." }
    ] })).unwrap();
    assert_eq!(parsed.operations.len(), 2);
    assert_eq!(
        parsed.operations[1].input_schema,
        json!({ "type": "object" })
    );
    for bad in [
        json!({ "operations": [{ "name": "Run Shell", "description": "x" }] }),
        json!({ "operations": [{ "name": "ok", "description": "" }] }),
        json!({ "operations": [{ "name": "ok", "description": "x", "inputSchema": { "type": "string" } }] }),
        json!({ "operations": [{ "name": "ok", "description": "x", "command": "rm -rf" }] }),
        json!({ "operations": [{ "name": "ok", "description": "x" }, { "name": "ok", "description": "y" }] }),
        json!({ "operations": "all" }),
    ] {
        assert!(manifest(bad.clone()).is_err(), "{bad}");
    }
}
