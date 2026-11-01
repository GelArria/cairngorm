use super::*;

#[test]
fn shares_the_frontend_jsonc_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../fixtures/config-jsonc.json")).unwrap();
    for case in cases {
        let result = parse(case["source"].as_str().unwrap());
        if case["expected"].is_null() {
            assert!(result.is_err(), "{}: {result:?}", case["name"]);
        } else {
            assert_eq!(result.unwrap(), case["expected"], "{}", case["name"]);
        }
    }
}

#[test]
fn comments_and_trailing_commas_are_accepted_but_strings_are_kept() {
    let text = r#"{
        // shells shown in the menu
        "shells": { "hide": ["Command Prompt",], /* inline */ },
        "url": "http://example.com/a//b",
        "quote": "say \"hi\" // not a comment",
        "list": [1, 2, ],
    }"#;
    let value = parse(text).unwrap();
    assert_eq!(value["shells"]["hide"][0], "Command Prompt");
    assert_eq!(value["url"], "http://example.com/a//b");
    assert_eq!(value["quote"], "say \"hi\" // not a comment");
    assert_eq!(value["list"].as_array().unwrap().len(), 2);
}

#[test]
fn invalid_or_non_object_files_are_refused() {
    assert!(parse("{ \"a\": }").is_err());
    assert!(parse("[1, 2]").is_err());
    assert!(parse("{}").is_ok());
}

#[test]
fn the_schema_ships_as_valid_json() {
    let schema: serde_json::Value = serde_json::from_str(SCHEMA).unwrap();
    assert!(schema["properties"]["applications"].is_object());
    assert!(
        schema["properties"].get("files").is_none(),
        "permissions never live here"
    );
}

#[test]
fn a_byte_order_mark_is_accepted_and_an_open_comment_is_an_error() {
    assert_eq!(parse("﻿{ \"a\": 1 }").unwrap()["a"], 1);
    assert!(parse("{ \"a\": 1 } /* never closed").is_err());
    assert!(parse("{ \"a\": tru/**/e }").is_err());
}
