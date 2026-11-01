use sha2::{Digest, Sha384};
use tauri::Manager;

/// SQLx stores a checksum of each applied script. Checkout line endings must not change it.
fn canonical(sql: &str) -> String {
    sql.replace("\r\n", "\n")
}

pub fn migrations() -> Vec<tauri_plugin_sql::Migration> {
    sources()
        .into_iter()
        .map(|migration| tauri_plugin_sql::Migration {
            // Built once per launch; the plugin requires 'static scripts.
            sql: Box::leak(canonical(migration.sql).into_boxed_str()),
            ..migration
        })
        .collect()
}

/// Checksums recorded from a CRLF or LF copy of the same script, rewritten to the canonical one.
/// Earlier builds embedded whichever line endings the checkout had, so SQLx rejected the
/// database as modified and every store silently fell back to WebView storage.
pub(crate) fn checksum_repairs(stored: &[(i64, Vec<u8>)]) -> Vec<(i64, Vec<u8>)> {
    let sources = sources();
    stored
        .iter()
        .filter_map(|(version, checksum)| {
            let sql = canonical(sources.iter().find(|m| m.version == *version)?.sql);
            let lf = Sha384::digest(sql.as_bytes()).to_vec();
            let crlf = Sha384::digest(sql.replace('\n', "\r\n").as_bytes()).to_vec();
            (*checksum != lf && *checksum == crlf).then_some((*version, lf))
        })
        .collect()
}

async fn repair(path: &std::path::Path) -> Result<usize, sqlx::Error> {
    use sqlx::{sqlite::SqliteConnectOptions, ConnectOptions, Connection};
    let mut conn = SqliteConnectOptions::new().filename(path).connect().await?;
    let table: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(&mut conn)
    .await?;
    let mut repaired = 0;
    if table.is_some() {
        let stored: Vec<(i64, Vec<u8>)> =
            sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations")
                .fetch_all(&mut conn)
                .await?;
        for (version, checksum) in checksum_repairs(&stored) {
            sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
                .bind(checksum)
                .bind(version)
                .execute(&mut conn)
                .await?;
            repaired += 1;
        }
    }
    conn.close().await?;
    Ok(repaired)
}

/// Registered before the SQL plugin: plugins initialize before any window can load the database.
pub fn checksum_repair_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("migration-checksums")
        .setup(|app, _| {
            // Same location tauri-plugin-sql resolves for "sqlite:panel.db".
            let Ok(path) = app.path().app_config_dir().map(|dir| dir.join("panel.db")) else {
                return Ok(());
            };
            if path.is_file() {
                match tauri::async_runtime::block_on(repair(&path)) {
                    Ok(0) => {}
                    Ok(count) => eprintln!("[storage] repaired {count} migration checksums"),
                    Err(error) => eprintln!("[storage] migration checksum repair failed: {error}"),
                }
            }
            Ok(())
        })
        .build()
}

fn sources() -> Vec<tauri_plugin_sql::Migration> {
    vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create initial tables",
            sql: include_str!("../../../../src-tauri/migrations/001_init.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "create tickets tables",
            sql: include_str!("../../../../src-tauri/migrations/002_tickets.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "create risk transitions table",
            sql: include_str!("../../../../src-tauri/migrations/003_risk_transitions.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "create plan mode contexts and failed attempts tables",
            sql: include_str!("../../../../src-tauri/migrations/004_plan_mode_context.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 5,
            description: "add scope column to kanban_columns",
            sql: include_str!("../../../../src-tauri/migrations/005_kanban_scope.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 6,
            description: "add assigned_to column to kanban_cards",
            sql: include_str!("../../../../src-tauri/migrations/006_kanban_assigned_to.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 7,
            description: "add ticket_id and end_date to calendar_events",
            sql: include_str!("../../../../src-tauri/migrations/007_calendar_ticket_end_date.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 8,
            description: "remove multi-tenant and user schema",
            sql: include_str!("../../../../src-tauri/migrations/008_remove_tenant_user.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 9,
            description: "remove tickets, risk, plan mode and kanban",
            sql: include_str!("../../../../src-tauri/migrations/009_remove_tickets_kanban.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 10,
            description: "projects + calendar project scope",
            sql: include_str!("../../../../src-tauri/migrations/010_projects.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 11,
            description: "project tile background",
            sql: include_str!("../../../../src-tauri/migrations/011_project_background.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 12,
            description: "project gem cut",
            sql: include_str!("../../../../src-tauri/migrations/012_project_gem_cut.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 13,
            description: "native terminal workspace and scrollback persistence",
            sql: include_str!("../../../../src-tauri/migrations/013_terminal_state.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
#[path = "../../../../tests/native/migration-checksums.rs"]
mod tests;
