#[derive(Default)]
enum Mode {
    #[default]
    Text,
    Escape,
    Csi,
    Osc,
    OscEscape,
}

#[derive(Default)]
pub struct TerminalLines {
    utf8: Vec<u8>,
    line: String,
    length: usize,
    mode: Mode,
    csi: String,
    redraw: bool,
    synchronized: bool,
}
impl TerminalLines {
    pub fn push(&mut self, bytes: &[u8], mut emit: impl FnMut(String, bool)) {
        self.utf8.extend_from_slice(bytes);
        let mut text = String::new();
        let mut offset = 0;
        while offset < self.utf8.len() {
            match std::str::from_utf8(&self.utf8[offset..]) {
                Ok(valid) => {
                    text.push_str(valid);
                    offset = self.utf8.len();
                }
                Err(error) => {
                    let end = offset + error.valid_up_to();
                    text.push_str(std::str::from_utf8(&self.utf8[offset..end]).unwrap());
                    offset = end;
                    if let Some(len) = error.error_len() {
                        text.push('�');
                        offset += len;
                    } else {
                        break;
                    }
                }
            }
        }
        self.utf8.drain(..offset);
        for ch in text.chars() {
            match self.mode {
                Mode::Osc => {
                    if ch == '\x07' {
                        self.mode = Mode::Text;
                    } else if ch == '\x1b' {
                        self.mode = Mode::OscEscape;
                    }
                    continue;
                }
                Mode::OscEscape => {
                    self.mode = if ch == '\\' { Mode::Text } else { Mode::Osc };
                    continue;
                }
                Mode::Escape => {
                    self.mode = match ch {
                        '[' => Mode::Csi,
                        ']' => Mode::Osc,
                        _ => Mode::Text,
                    };
                    self.csi.clear();
                    continue;
                }
                Mode::Csi => {
                    if ('@'..='~').contains(&ch) {
                        self.mode = Mode::Text;
                        if ch == 'H' || ch == 'f' {
                            self.flush(&mut emit);
                        }
                        if (ch == 'H' && (self.csi.is_empty() || self.csi == "1;1"))
                            || (ch == 'J' && ["2", "3"].contains(&self.csi.as_str()))
                        {
                            self.redraw = true;
                        }
                        if self.csi == "?2026" {
                            self.synchronized = ch == 'h';
                            if !self.synchronized {
                                self.flush(&mut emit);
                                self.redraw = false;
                            }
                        }
                    } else {
                        self.csi.push(ch);
                        if self.csi.chars().count() > 32 {
                            let first = self.csi.chars().next().unwrap().len_utf8();
                            self.csi.drain(..first);
                        }
                    }
                    continue;
                }
                Mode::Text => {}
            }
            if ch == '\x1b' {
                self.mode = Mode::Escape;
                continue;
            }
            if ch == '\n' || ch == '\r' {
                self.flush(&mut emit);
                continue;
            }
            if ch == '\x08' {
                if let Some(removed) = self.line.pop() {
                    self.length -= removed.len_utf16();
                }
                continue;
            }
            if ch >= ' ' || ch == '\t' {
                self.line.push(ch);
                self.length += ch.len_utf16();
            }
            if self.length > 16384 {
                self.flush(&mut emit);
            }
        }
        if !self.synchronized {
            self.redraw = false;
        }
    }
    pub fn flush(&mut self, mut emit: impl FnMut(String, bool)) {
        let line = std::mem::take(&mut self.line);
        self.length = 0;
        if !line.trim().is_empty() {
            emit(line, self.redraw);
        }
    }
    pub fn finish(&mut self, mut emit: impl FnMut(String, bool)) {
        if !self.utf8.is_empty() {
            self.line.push('�');
            self.utf8.clear();
        }
        self.flush(&mut emit);
    }
}
