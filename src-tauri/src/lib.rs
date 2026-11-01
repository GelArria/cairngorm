#[path = "../../src/integrations/native/agent_cleanup.rs"]
mod agent_cleanup;
#[path = "../../src/agent/native/agent_config.rs"]
mod agent_config;
#[path = "../../src/app/native/agent_config_cleanup.rs"]
mod agent_config_cleanup;
#[path = "../../src/agent/native/agent_env.rs"]
mod agent_env;
#[path = "../../src/integrations/native/agent_integrations.rs"]
mod agent_integrations;
#[cfg(test)]
#[path = "../../tests/native/agent-privacy.rs"]
mod agent_privacy_tests;
#[path = "../../src/integrations/native/ai_cli.rs"]
mod ai_cli;
#[cfg(test)]
#[path = "../../tests/native/ai-commit-routing.rs"]
mod ai_commit_routing_tests;
#[path = "../../src/integrations/native/ai_detection.rs"]
mod ai_detection;
#[path = "../../src/integrations/native/ai_gemini.rs"]
mod ai_gemini;
#[path = "../../src/integrations/native/ai_gemini_isolation.rs"]
mod ai_gemini_isolation;
#[cfg(test)]
#[path = "../../tests/native/ai-gemini.rs"]
mod ai_gemini_tests;
#[path = "../../src/integrations/native/ai_integrations.rs"]
mod ai_integrations;
#[cfg(test)]
#[path = "../../tests/native/ai-integrations.rs"]
mod ai_integrations_tests;
#[path = "../../src/agent/native/ai_native.rs"]
mod ai_native;
#[cfg(test)]
#[path = "../../tests/native/ai-native.rs"]
mod ai_native_tests;
#[path = "../../src/integrations/native/ai_process.rs"]
mod ai_process;
#[path = "../../src/integrations/native/ai_runtime.rs"]
mod ai_runtime;
#[cfg(test)]
#[path = "../../tests/native/ai-runtime.rs"]
mod ai_runtime_tests;
#[path = "../../src/integrations/native/ai_usage.rs"]
mod ai_usage;
#[path = "../../src/integrations/native/ai_usage_parse.rs"]
mod ai_usage_parse;
#[cfg(test)]
#[path = "../../tests/native/ai-usage.rs"]
mod ai_usage_tests;
#[path = "../../src/integrations/native/claude_api.rs"]
mod claude_api;
#[path = "../../src/integrations/native/claude_statusline.rs"]
mod claude_statusline;
#[cfg(test)]
#[path = "../../tests/native/claude-statusline.rs"]
mod claude_statusline_tests;
#[path = "../../src/integrations/native/cli_catalog.rs"]
mod cli_catalog;
#[path = "../../src/integrations/native/cli_paths.rs"]
mod cli_paths;
#[path = "../../src/config/native/config.rs"]
mod config;
#[path = "../../src/debug/native/crash.rs"]
mod crash;
#[path = "../../src/debug/native/data_policy.rs"]
mod data_policy;
#[path = "../../src/documents/native/documents.rs"]
mod documents;
#[path = "../../src/common/events/native/emit_safe.rs"]
mod emit_safe;
#[path = "../../src/common/filesystem/native/fs_cmds.rs"]
mod fs_cmds;
#[path = "../../src/common/filesystem/native/fs_ops.rs"]
mod fs_ops;
#[path = "../../src/git/native/git.rs"]
mod git;
#[path = "../../src/git/native/git_actions.rs"]
mod git_actions;
#[cfg(test)]
#[path = "../../tests/native/git-actions.rs"]
mod git_actions_tests;
#[path = "../../src/git/native/git_commit_details.rs"]
mod git_commit_details;
#[cfg(test)]
#[path = "../../tests/native/git-commit-details.rs"]
mod git_commit_details_tests;
#[cfg(test)]
#[path = "../../tests/native/git-commit-options.rs"]
mod git_commit_options;
#[path = "../../src/git/native/git_history.rs"]
mod git_history;
#[path = "../../src/git/native/git_ops.rs"]
mod git_ops;
#[path = "../../src/git/native/git_summary.rs"]
mod git_summary;
#[cfg(test)]
#[path = "../../tests/native/git-summary.rs"]
mod git_summary_tests;
#[cfg(test)]
#[path = "../../tests/native/git-ui-flows.rs"]
mod git_ui_flows_tests;
#[path = "../../src/common/network/native/http_transport.rs"]
mod http_transport;
#[path = "../../src/integrations/native/integration_config.rs"]
mod integration_config;
#[cfg(test)]
#[path = "../../tests/native/io-commands.rs"]
mod io_commands;
#[path = "../../src/terminal/native/launch_permissions.rs"]
mod launch_permissions;
#[path = "../../src/terminal/native/launch_profiles.rs"]
mod launch_profiles;
#[path = "../../src/plugins/native/plugins.rs"]
mod plugins;
#[path = "../../src/terminal/native/pty.rs"]
mod pty;
#[path = "../../src/calendar/native/scheduled_tasks.rs"]
mod scheduled_tasks;
#[path = "../../src/search/native/search.rs"]
mod search;
#[path = "../../src/search/native/search_filter.rs"]
mod search_filter;
#[path = "../../src/search/native/search_scan.rs"]
mod search_scan;
#[path = "../../src/search/native/search_walk.rs"]
mod search_walk;
#[path = "../../src/terminal/native/session_report.rs"]
mod session_report;
#[path = "../../src/terminal/native/session_resume.rs"]
mod session_resume;
#[path = "../../src/terminal/native/shells.rs"]
mod shells;
#[path = "../../src/skills/native/skills.rs"]
mod skills;
#[path = "../../src/testing/native/test_browser.rs"]
mod test_browser;
#[path = "../../src/testing/native/test_preview.rs"]
mod test_preview;
#[path = "../../src/updates/native/updates.rs"]
mod updates;
#[path = "../../src/debug/native/watchdog.rs"]
mod watchdog;
#[cfg(windows)]
#[path = "../../src/app/native/window_icon.rs"]
mod window_icon;

/// Run work that may wait on a lock (git hooks, a full walk) on the
/// blocking pool — never on the async workers every other command shares.
pub(crate) async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task failed: {e}"))
}

#[path = "../../src/app/native/background.rs"]
mod app_background;
#[path = "../../src/app/native/navigation.rs"]
mod app_navigation;
#[path = "../../src/app/native/runtime.rs"]
mod app_runtime;
#[path = "../../src/app/native/launch_requests.rs"]
mod launch_requests;
#[path = "../../src/common/storage/native/migrations.rs"]
mod migrations;
#[path = "../../src/debug/native/performance.rs"]
mod performance;

pub use app_runtime::run;
