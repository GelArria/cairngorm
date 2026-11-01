use super::*;

fn digest(sql: &str) -> Vec<u8> {
    Sha384::digest(sql.as_bytes()).to_vec()
}

#[test]
fn migrations_are_embedded_with_lf_line_endings() {
    assert!(migrations().iter().all(|m| !m.sql.contains('\r')));
}

#[test]
fn checksums_recorded_from_either_line_ending_are_rewritten_to_lf() {
    let sources = sources();
    let lf = canonical(sources[0].sql);
    let crlf = lf.replace('\n', "\r\n");
    let stored = vec![
        (sources[0].version, digest(&crlf)),
        (sources[1].version, digest(&canonical(sources[1].sql))),
        (sources[2].version, vec![0; 48]),
        (999, digest("unknown")),
    ];
    // Only a pure line-ending difference is repaired; real edits and unknown versions stay rejected.
    assert_eq!(
        checksum_repairs(&stored),
        vec![(sources[0].version, digest(&lf))]
    );
}

#[test]
fn repair_lets_sqlx_accept_a_database_migrated_from_crlf_scripts() {
    let dir = std::env::temp_dir().join(format!("cairngorm-migrations-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("panel.db");
    tauri::async_runtime::block_on(async {
        use sqlx::{
            migrate::{Migration, MigrationType, Migrator},
            sqlite::SqliteConnectOptions,
            ConnectOptions, Connection,
        };
        let build = |crlf: bool| Migrator {
            migrations: sources()
                .iter()
                .map(|m| {
                    let sql = canonical(m.sql);
                    let sql = if crlf { sql.replace('\n', "\r\n") } else { sql };
                    Migration::new(
                        m.version,
                        m.description.into(),
                        MigrationType::Simple,
                        sql.into(),
                        false,
                    )
                })
                .collect::<Vec<_>>()
                .into(),
            ..Migrator::DEFAULT
        };
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let mut conn = options.connect().await.unwrap();
        build(true).run(&mut conn).await.unwrap();
        assert!(build(false).run(&mut conn).await.is_err());
        conn.close().await.unwrap();

        assert_eq!(repair(&path).await.unwrap(), sources().len());
        let mut conn = options.connect().await.unwrap();
        build(false).run(&mut conn).await.unwrap();
        conn.close().await.unwrap();
        assert_eq!(repair(&path).await.unwrap(), 0);
    });
    let _ = std::fs::remove_dir_all(dir);
}
