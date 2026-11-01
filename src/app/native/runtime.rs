#[cfg(windows)]
use crate::window_icon;
use crate::{
    agent_config, agent_config_cleanup, agent_env, ai_integrations, ai_native, ai_usage, crash,
    emit_safe, fs_cmds, fs_ops, git, git_actions, git_commit_details, git_history, git_ops,
    git_summary, performance, plugins, pty, scheduled_tasks, search, shells, skills, test_browser,
    test_preview, updates, watchdog,
};

pub fn run() {
    // Started by the uninstaller: clean other agents' configs and exit, with no window.
    if agent_config_cleanup::run_from_uninstaller() {
        return;
    }
    // `cairngorm --help` and `--version` in a terminal; other arguments are requests.
    if crate::launch_requests::print_info() {
        return;
    }
    crate::launch_requests::queue_startup();
    // Kill Fluent overlay scrollbars (they paint end-cap arrows that ignore
    // ::-webkit-scrollbar-button and scrollbar-width) — the minimalist CSS
    // scrollbar then renders through the classic webkit path. BEFORE WebView2 init.
    {
        let mut args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let flag = "--disable-features=msEdgeFluentOverlayScrollbar";
        if !args.contains(flag) {
            if !args.is_empty() {
                args.push(' ');
            }
            args.push_str(flag);
        }
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }

    #[cfg(debug_assertions)]
    if std::env::var("PANEL_REMOTE_DEBUGGING").as_deref() == Ok("1") {
        // CDP is deliberately opt-in. When enabled, bind it to loopback and
        // allow only the CrabNebula dashboard origin. Never expose a debug
        // endpoint on the host network by default.
        let mut args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        for flag in [
            "--remote-debugging-port=9222",
            "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=https://devtools.crabnebula.dev",
        ] {
            if !args.split_whitespace().any(|arg| arg == flag) {
                if !args.is_empty() {
                    args.push(' ');
                }
                args.push_str(flag);
            }
        }
        // Must be set BEFORE WebView2 initializes for CDP to work.
        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", args);
    }

    let migrations = crate::migrations::migrations();

    // DevTools dashboard (crabnebula): debug builds with the `devtools` feature, opt-in with
    // PANEL_DEVTOOLS=1 — its IPC/custom-protocol has been implicated in hangs when creating
    // the 2nd window.
    #[cfg(all(debug_assertions, feature = "devtools"))]
    let devtools = if std::env::var("PANEL_DEVTOOLS").as_deref() == Ok("1") {
        Some(tauri_plugin_devtools::init())
    } else {
        None
    };

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();
    // Registered first, as the plugin requires. Release only: development builds share the
    // identifier and must run beside the installed app.
    #[cfg(not(debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            crate::launch_requests::submit(app, args, &cwd);
            crate::app_background::reveal(app);
        }));
    }
    #[allow(unused_mut)]
    let mut builder = builder
        .setup(|app| {
            crate::emit_safe::init_main_app(app.handle());
            crash::init(&app.handle().clone());
            watchdog::init_watchdog(&app.handle().clone());
            crate::config::init(app.handle());
            plugins::init(app.handle());
            crate::documents::init(app.handle());
            scheduled_tasks::init(app.handle());
            // Refreshes the `cairngorm` link (macOS, AppImage) so it follows a moved app.
            #[cfg(not(debug_assertions))]
            std::thread::spawn(crate::launch_requests::command_dir);
            #[cfg(windows)]
            {
                use tauri::Manager;
                for w in app.webview_windows().values() {
                    window_icon::apply(&w.as_ref().window());
                }
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("test-frame", |_context, request, responder| {
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(test_browser::frame_response(request));
            });
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(crate::app_navigation::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(crate::migrations::checksum_repair_plugin())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:panel.db", migrations)
                .build(),
        )
        .invoke_handler(move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
            if plugins::from_view_origin(invoke.message.headers()) {
                invoke
                    .resolver
                    .reject("Application commands are unavailable in plugin views");
                return true;
            }
            test_preview::app_invoke(
                invoke,
                &tauri::generate_handler![
                    performance::is_debug,
                    crate::launch_requests::app_take_launch_requests,
                    crate::data_policy::get_data_policy,
                    performance::get_perf_stats,
                    emit_safe::emit_terminal_event,
                    shells::detect_shells,
                    crate::cli_catalog::detect_agent_clis,
                    crate::launch_profiles::resolve_terminal_profile,
                    shells::detect_home,
                    agent_env::resolve_agent_path,
                    agent_env::resolve_agent_runner,
                    agent_env::get_agent_env,
                    scheduled_tasks::scheduled_tasks_list,
                    scheduled_tasks::scheduled_tasks_save,
                    scheduled_tasks::scheduled_tasks_action,
                    scheduled_tasks::scheduled_tasks_delete_project,
                    agent_config::get_agent_config,
                    agent_config::save_agent_config,
                    agent_config::test_agent_connection,
                    ai_integrations::needs_ai_setup,
                    ai_integrations::detect_ai_services,
                    ai_integrations::connect_ai_service,
                    ai_integrations::finish_ai_setup,
                    ai_integrations::save_ai_runtime,
                    ai_usage::read_ai_usage,
                    ai_native::ai_summary_setup_required,
                    ai_native::get_codex_agent_env,
                    ai_native::get_gemini_agent_env,
                    crate::documents::document_providers_list,
                    crate::documents::document_provider_inspect,
                    crate::documents::document_provider_install,
                    crate::documents::document_provider_remove,
                    crate::documents::document_providers_bundled,
                    crate::documents::document_provider_install_bundled,
                    crate::documents::document_view_url,
                    crate::documents::document_read_snapshot,
                    crate::documents::document_ticket_read,
                    crate::documents::document_ticket_ack,
                    crate::documents::document_save,
                    crate::documents::document_request_complete,
                    fs_cmds::fs_list_dir,
                    fs_cmds::fs_read_file,
                    fs_cmds::fs_read_file_data_url,
                    fs_cmds::fs_write_file,
                    fs_cmds::fs_exists,
                    search::fs_search_files,
                    search::fs_search_cancel,
                    search::fs_refresh_search_index,
                    pty::pty_ensure,
                    pty::pty_write,
                    pty::pty_resize,
                    pty::pty_kill,
                    pty::agent_steer,
                    pty::pty_replay,
                    pty::pty_test_run,
                    pty::pty_snapshot_sessions,
                    pty::pty_busy_count,
                    crate::app_background::app_background_enter,
                    crate::app_background::app_background_quit_started,
                    test_preview::test_preview,
                    test_browser::test_browser_freeze,
                    plugins::plugins_state,
                    plugins::plugins_set_files_access,
                    plugins::plugin_file_consent_reply,
                    plugins::plugin_file_request_seen,
                    plugins::plugins_forget_app,
                    agent_config_cleanup::agent_configs_remove,
                    agent_config_cleanup::agent_configs_restore,
                    agent_config_cleanup::agent_configs_removed,
                    plugins::app_window_dock,
                    plugins::app_window_release,
                    plugins::apps_list,
                    crate::config::config_read,
                    crate::config::config_write,
                    plugins::app_window_open,
                    plugins::app_window_prepare_close,
                    plugins::app_window_cancel_close,
                    plugins::plugins_sync_workspace,
                    plugins::plugin_file_permission_reply,
                    plugins::plugins_set_enabled,
                    plugins::plugins_connect_agents,
                    plugins::plugins_add_client,
                    plugins::plugins_set_client_connected,
                    plugins::plugins_remove_client,
                    plugins::plugins_cancel_sign_in,
                    plugins::plugin_view_request,
                    plugins::plugin_prepare_reload,
                    plugins::plugin_view_event,
                    plugins::mcp_servers_list,
                    plugins::mcp_server_remove,
                    plugins::mcp_server_add,
                    skills::skills_list,
                    skills::skills_roots,
                    skills::skills_set_enabled,
                    skills::skills_create,
                    updates::update_check,
                    updates::update_install,
                    updates::update_restart,
                    crash::exit_app,
                    crash::test_panic,
                    git::git_status,
                    git::git_init,
                    git::git_stage,
                    git::git_unstage,
                    git::git_commit,
                    git::git_branch,
                    git::git_repo_root,
                    git_history::git_log,
                    git_history::git_file_details,
                    git_history::git_diff,
                    git_ops::git_discard,
                    git_ops::git_ignore,
                    git_ops::git_remote_status,
                    git_ops::git_sync,
                    git_ops::git_remotes,
                    git_actions::git_branches,
                    git_actions::git_switch,
                    git_actions::git_commit_action,
                    git_actions::git_pending_operation,
                    git_summary::git_summarize,
                    git_commit_details::git_commit_details,
                    git_commit_details::git_commit_diff,
                    fs_ops::fs_create_file,
                    fs_ops::fs_create_dir,
                    fs_ops::fs_rename,
                    fs_ops::fs_copy,
                    fs_ops::fs_delete,
                    fs_ops::fs_reveal,
                    fs_ops::fs_open_default,
                    watchdog::heartbeat,
                    watchdog::pong,
                ],
            )
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                    if let Err(error) = plugins::prepare_app_window_close() {
                        api.prevent_close();
                        eprintln!("[app-window] Close blocked: {error}");
                    }
                }
                tauri::WindowEvent::Destroyed if window.label() == "main" => {
                    // The frontend flushes SQLite before destroy; a prevented close must keep PTYs alive.
                    pty::pty_cleanup_all();
                    // A verified update waits for this moment: the app closed normally. End
                    // the process too (detached windows would keep it running); the
                    // installer starts from the exit event below.
                    if crate::updates::has_pending() {
                        tauri::Manager::app_handle(window).exit(0);
                    }
                    #[cfg(windows)]
                    window_icon::forget(window);
                }
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                    let paths: Vec<String> = paths
                        .iter()
                        .filter_map(|p| p.to_str().map(|s| s.to_owned()))
                        .collect();
                    if !paths.is_empty() {
                        let _ = crate::emit_safe::emit_bg(window, "os-file-drop", paths);
                    }
                }
                // However main came back (tray, taskbar, a detached window's focus request),
                // the background mode ends with it.
                tauri::WindowEvent::Focused(true) if window.label() == "main" => {
                    crate::app_background::returned(tauri::Manager::app_handle(window));
                    #[cfg(windows)]
                    window_icon::apply(window);
                }
                #[cfg(windows)]
                tauri::WindowEvent::Focused(true)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    window_icon::apply(window);
                }
                #[cfg(windows)]
                tauri::WindowEvent::Destroyed => window_icon::forget(window),
                _ => {}
            }
        });

    #[cfg(all(debug_assertions, feature = "devtools"))]
    {
        if let Some(devtools) = devtools {
            builder = builder.plugin(devtools);
        }
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // macOS: clicking the Dock icon brings a backgrounded app back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                crate::app_background::reveal(_app);
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                plugins::release_app_windows();
            }
            if let tauri::RunEvent::Exit = event {
                crate::updates::launch_pending();
            }
        });
}
