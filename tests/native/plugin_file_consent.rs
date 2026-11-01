use super::*;

fn pending_in(
    consent: &mut Consent,
    id: &str,
    epoch: &str,
    subject: &str,
    project: &str,
) -> mpsc::Receiver<bool> {
    let (reply, receiver) = mpsc::channel();
    consent.pending.insert(
        id.into(),
        Pending {
            epoch: epoch.into(),
            subject: subject.into(),
            project: project.into(),
            seen: false,
            created: Instant::now(),
            reply,
        },
    );
    receiver
}

fn pending(consent: &mut Consent, id: &str, epoch: &str, subject: &str) -> mpsc::Receiver<bool> {
    pending_in(consent, id, epoch, subject, "p1")
}

#[test]
fn grants_cover_matching_questions_and_deny_covers_nothing() {
    let mut consent = Consent::default();
    let a = pending(&mut consent, "a", "e1", FILES);
    let b = pending(&mut consent, "b", "e1", FILES);
    let c = pending(&mut consent, "c", "e2", FILES);
    assert_eq!(
        consent
            .reply("a", ConsentDecision::Session)
            .unwrap()
            .subject,
        FILES
    );
    assert_eq!((a.recv().unwrap(), b.recv().unwrap()), (true, true));
    assert!(c.try_recv().is_err());
    assert!(consent.sessions.contains("e1|files") && !consent.always);
    consent.reply("c", ConsentDecision::Deny).unwrap();
    assert!(!c.recv().unwrap());
    assert!(consent.denied.contains_key("e2|files"));
    let d = pending(&mut consent, "d", "e3", FILES);
    consent.grant_all();
    assert!(d.recv().unwrap() && consent.always && consent.pending.is_empty());
    assert!(consent.reply("c", ConsentDecision::Always).is_err());
    let epochs: HashSet<String> = ["e2".to_string()].into();
    consent.retain(&epochs);
    assert!(consent.sessions.is_empty());
}

#[test]
fn each_application_is_allowed_separately_from_files_and_other_apps() {
    let mut consent = Consent::default();
    let excel = pending(&mut consent, "x", "e1", "app:excel");
    let word = pending(&mut consent, "w", "e1", "app:word");
    let files = pending(&mut consent, "f", "e1", FILES);
    let answered = consent.reply("x", ConsentDecision::Always).unwrap();
    assert_eq!(
        (answered.subject.as_str(), answered.project.as_str()),
        ("app:excel", "p1")
    );
    assert!(excel.recv().unwrap());
    assert!(word.try_recv().is_err() && files.try_recv().is_err());
    assert!(consent.always_apps.contains(&grant("excel", "p1")) && !consent.always);
    consent.grant_all();
    assert!(files.recv().unwrap());
    assert!(
        word.try_recv().is_err(),
        "a files grant never answers an app question"
    );
    consent.clear_sessions();
    assert!(consent.pending.contains_key("w"));
}

#[test]
fn always_allowing_an_application_covers_only_its_project() {
    let mut consent = Consent::default();
    let here = pending_in(&mut consent, "a", "e1", "app:excel", "p1");
    let same_project = pending_in(&mut consent, "b", "e2", "app:excel", "p1");
    let other_project = pending_in(&mut consent, "c", "e3", "app:excel", "p2");
    consent.reply("a", ConsentDecision::Always).unwrap();
    assert!(here.recv().unwrap() && same_project.recv().unwrap());
    assert!(
        other_project.try_recv().is_err(),
        "another project's question stays open"
    );
    assert!(consent.always_apps.contains(&grant("excel", "p1")));
    assert!(!consent.always_apps.contains(&grant("excel", "p2")));
    assert!(consent.always_for("app:excel", "p1"));
    assert!(!consent.always_for("app:excel", "p2"));
}
