use std::collections::{BTreeSet, VecDeque};

const CAP: usize = 256 * 1024;
const INPUT_MODES: &[u16] = &[1, 9, 66, 1000, 1002, 1003, 1004, 1006, 1016, 2004];
const MOUSE_TRACKING: &[u16] = &[9, 1000, 1002, 1003];
const MOUSE_ENCODING: &[u16] = &[1006, 1016];

#[derive(Default)]
enum Parser {
    #[default]
    Ground,
    Escape,
    Csi(Vec<u8>),
    String {
        bell_terminates: bool,
    },
}

// Keep input modes outside the bounded output ring: a remounted xterm must
// retain mouse/key/paste behavior even when startup DECSET bytes are evicted.
#[derive(Default)]
pub struct PtyReplay {
    bytes: VecDeque<u8>,
    enabled: BTreeSet<u16>,
    parser: Parser,
}

impl PtyReplay {
    pub fn push(&mut self, data: &[u8]) {
        for &byte in data {
            self.parse(byte);
        }
        push_ring(&mut self.bytes, data, CAP);
    }

    pub fn replay(&self) -> Vec<u8> {
        if self.bytes.is_empty() {
            return Vec::new();
        }
        // Prefix state: retained toggles still reach the same final state, while
        // the raw suffix stays intact for frontend replay/live deduplication.
        let mut out = b"\x1b[?1;9;66;1000;1002;1003;1004;1006;1016;2004l".to_vec();
        for mode in &self.enabled {
            out.extend_from_slice(format!("\x1b[?{mode}h").as_bytes());
        }
        out.extend(self.bytes.iter().copied());
        out
    }

    fn set_mode(&mut self, mode: u16, enabled: bool) {
        if !INPUT_MODES.contains(&mode) {
            return;
        }
        // xterm has one protocol and one encoding: resetting any member resets
        // its whole family; enabling a member replaces the previous member.
        for family in [MOUSE_TRACKING, MOUSE_ENCODING] {
            if family.contains(&mode) {
                for sibling in family {
                    self.enabled.remove(sibling);
                }
            }
        }
        if enabled {
            self.enabled.insert(mode);
        } else {
            self.enabled.remove(&mode);
        }
    }

    fn parse(&mut self, byte: u8) {
        // ESC, CAN and SUB are global transitions, including inside strings.
        if byte == 0x1b {
            self.parser = Parser::Escape;
            return;
        }
        if matches!(byte, 0x18 | 0x1a) {
            self.parser = Parser::Ground;
            return;
        }
        self.parser = match std::mem::take(&mut self.parser) {
            Parser::Ground => {
                if byte == 0x1b {
                    Parser::Escape
                } else {
                    Parser::Ground
                }
            }
            Parser::Escape => match byte {
                b'[' => Parser::Csi(Vec::new()),
                b']' | b'P' | b'_' | b'^' | b'X' => Parser::String {
                    bell_terminates: byte == b']',
                },
                b'c' => {
                    self.enabled.clear();
                    Parser::Ground
                }
                b'=' | b'>' => {
                    self.set_mode(66, byte == b'=');
                    Parser::Ground
                }
                0x00..=0x1f | 0x7f => Parser::Escape,
                _ => Parser::Ground,
            },
            Parser::Csi(mut params) => {
                if (0x40..=0x7e).contains(&byte) {
                    // DECSTR resets CoreService's key/paste/focus modes, but
                    // leaves CoreMouseService's protocol and encoding alone.
                    if byte == b'p'
                        && params.last() == Some(&b'!')
                        && params[..params.len() - 1]
                            .iter()
                            .all(|b| b.is_ascii_digit() || matches!(b, b';' | b':'))
                    {
                        for mode in [1, 66, 1004, 2004] {
                            self.enabled.remove(&mode);
                        }
                    }
                    if matches!(byte, b'h' | b'l') && params.first() == Some(&b'?') {
                        if let Ok(text) = std::str::from_utf8(&params[1..]) {
                            for param in text.split(';') {
                                if let Ok(mode) = param.parse() {
                                    self.set_mode(mode, byte == b'h');
                                }
                            }
                        }
                    }
                    Parser::Ground
                } else if byte <= 0x1f || byte == 0x7f {
                    // Executable C0/DEL do not end CSI; CAN/SUB were handled above.
                    Parser::Csi(params)
                } else if (0x20..=0x3f).contains(&byte) && params.len() < 128 {
                    params.push(byte);
                    Parser::Csi(params)
                } else {
                    // ponytail: ignore CSI over 128 bytes; input-mode lists are tiny.
                    Parser::Ground
                }
            }
            Parser::String { bell_terminates } => {
                if byte == 0x07 && bell_terminates {
                    Parser::Ground
                } else {
                    Parser::String { bell_terminates }
                }
            }
        };
    }
}

pub fn push_ring(buf: &mut VecDeque<u8>, data: &[u8], cap: usize) {
    if data.len() >= cap {
        buf.clear();
        buf.extend(&data[data.len() - cap..]);
    } else {
        let excess = (buf.len() + data.len()).saturating_sub(cap);
        buf.drain(..excess);
        buf.extend(data);
    }
}

#[cfg(test)]
#[path = "../../../tests/native/pty-replay.rs"]
mod tests;
