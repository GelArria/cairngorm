use super::*;

fn overflow(replay: &mut PtyReplay) {
    replay.push(&vec![b'x'; CAP + 100]);
}

#[test]
fn startup_input_modes_survive_ring_eviction_and_chunk_boundaries() {
    let mut replay = PtyReplay::default();
    for byte in b"\x1b[?1;1003;1006;1004;2004h" {
        replay.push(&[*byte]);
    }
    overflow(&mut replay);
    let output = replay.replay();
    assert_eq!(replay.bytes.len(), CAP);
    for mode in [1, 1003, 1006, 1004, 2004] {
        assert!(output
            .windows(format!("\x1b[?{mode}h").len())
            .any(|w| w == format!("\x1b[?{mode}h").as_bytes()));
    }
    assert!(output.ends_with(&vec![b'x'; CAP])); // preserves raw suffix for dedup
}

#[test]
fn resets_and_protocol_switches_match_xterm() {
    let mut replay = PtyReplay::default();
    replay.push(b"\x1b[?1003;1006h\x1b[?1000;1016h");
    assert_eq!(replay.enabled, BTreeSet::from([1000, 1016]));
    // xterm resets the entire family, even if this member is not current.
    replay.push(b"\x1b[?1002;1006l");
    overflow(&mut replay);
    assert!(replay.enabled.is_empty());
    assert!(!String::from_utf8(replay.replay())
        .unwrap()
        .contains("1003h"));
}

#[test]
fn reset_and_keypad_modes_survive_eviction() {
    let mut replay = PtyReplay::default();
    replay.push(b"\x1b[?1003;1006;2004h\x1bc\x1b=");
    overflow(&mut replay);
    assert_eq!(replay.enabled, BTreeSet::from([66]));
    replay.push(b"\x1b>");
    assert!(replay.enabled.is_empty());
}

#[test]
fn terminal_strings_and_non_private_csi_do_not_change_modes() {
    let mut replay = PtyReplay::default();
    replay.push(b"\x1b]title [?1003h\x07\x1bPqimage [?1006h\x1b\\\x1b[2004h");
    assert!(replay.enabled.is_empty());
    replay.push(b"\x1b[?1004");
    replay.push(b"\x18h\x1b[?2004h");
    assert_eq!(replay.enabled, BTreeSet::from([2004]));
}

#[test]
fn parser_is_bounded_and_recovers_from_malformed_sequences() {
    let mut replay = PtyReplay::default();
    replay.push(b"\x1b[?");
    replay.push(&vec![b'1'; 10_000]);
    replay.push(b"h\x1b[?1003;1006h");
    assert_eq!(replay.enabled, BTreeSet::from([1003, 1006]));
    replay.push(b"\x1b[?1006;0h\x1b[?1003l");
    assert_eq!(replay.enabled, BTreeSet::from([1006]));
}

#[test]
fn soft_reset_keeps_mouse_but_resets_key_paste_and_focus_modes() {
    for parameters in ["", "0", "1;2"] {
        let mut replay = PtyReplay::default();
        replay.push(b"\x1b[?1;66;1003;1006;1004;2004h");
        replay.push(format!("\x1b[{parameters}!p").as_bytes());
        overflow(&mut replay);
        assert_eq!(
            replay.enabled,
            BTreeSet::from([1003, 1006]),
            "DECSTR {parameters}"
        );
    }
}

#[test]
fn escape_terminates_strings_and_starts_the_following_csi() {
    for opener in [b"\x1b]0;title".as_slice(), b"\x1bPqimage", b"\x1b_payload"] {
        let mut replay = PtyReplay::default();
        replay.push(b"\x1b[?1003h");
        replay.push(opener);
        replay.push(b"\x1b[?1003l\x07");
        overflow(&mut replay);
        assert!(replay.enabled.is_empty(), "opener {opener:?}");
    }
}

#[test]
fn c0_and_del_preserve_csi_and_escape_but_can_sub_cancel() {
    for control in (0..=0x1f)
        .chain([0x7f])
        .filter(|b| ![0x18, 0x1a, 0x1b].contains(b))
    {
        let mut replay = PtyReplay::default();
        replay.push(b"\x1b[?1003h\x1b");
        replay.push(&[control]);
        replay.push(b"[?1003");
        replay.push(&[control]);
        replay.push(b"l");
        overflow(&mut replay);
        assert!(replay.enabled.is_empty(), "control {control}");
    }
    for cancel in [0x18, 0x1a] {
        let mut replay = PtyReplay::default();
        replay.push(b"\x1b[?1003h\x1b[?1003");
        replay.push(&[cancel]);
        replay.push(b"l");
        assert_eq!(replay.enabled, BTreeSet::from([1003]));
    }
}

#[test]
fn dcs_bell_does_not_terminate_payload() {
    let mut replay = PtyReplay::default();
    replay.push(b"\x1bPqimage\x07[?1003h\x1b\\");
    assert!(replay.enabled.is_empty());
}

#[test]
fn empty_replay_stays_empty() {
    assert!(PtyReplay::default().replay().is_empty());
}
