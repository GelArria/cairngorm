use super::*;
#[allow(unused_imports)]
use std::time::Instant;

fn excel() -> App {
    App {
        id: "excel".into(),
        name: "Microsoft Excel".into(),
        prog_id: "Excel.Application".into(),
        executable: r"C:\Office\EXCEL.EXE".into(),
        mcp: None,
    }
}

#[test]
fn scripts_get_the_app_object_and_only_new_hidden_instances_are_closed() {
    let wrapped = wrap(
        &excel(),
        "$app.Workbooks.Count",
        Path::new(r"C:\Temp\a.pids"),
    );
    assert!(wrapped.contains("GetActiveObject('Excel.Application')"));
    assert!(wrapped.contains("New-Object -ComObject 'Excel.Application'"));
    assert!(wrapped.contains("$app.Workbooks.Count"));
    // "Started" means a new EXCEL process appeared, never a failed lookup.
    // COM apps only exist on Windows; elsewhere `\` is not a path separator.
    #[cfg(windows)]
    assert!(wrapped.contains("Get-Process -Name 'EXCEL'"));
    assert!(wrapped.contains("$started = $new.Count -gt 0"));
    assert!(wrapped.contains(r"Set-Content -LiteralPath 'C:\Temp\a.pids'"));
    assert!(wrapped.contains("Stop-Process -Id $id"));
    use super::super::app_run::{capped, MAX_OUTPUT_BYTES};
    let (text, cut) = capped(vec![b'a'; MAX_OUTPUT_BYTES + 10]);
    assert!(cut && text.len() == MAX_OUTPUT_BYTES);
}

#[test]
fn active_window_capture_is_out_of_band_and_precedes_com_release() {
    let wrapped = wrap(
        &excel(),
        "Write-Output 'agent output'",
        Path::new(r"C:\Temp\run.pids"),
    );
    let capture = wrapped.find("$windowHwnd = 0").unwrap();
    assert!(capture > wrapped.find("Write-Output 'agent output'").unwrap());
    assert!(capture < wrapped.find("FinalReleaseComObject").unwrap());
    assert!(wrapped.contains("$app.ActiveWindow.Hwnd"));
    assert!(wrapped.contains("$app.Hwnd"));
    assert!(wrapped.contains("$windowHwnd += 4294967296"));
    assert!(wrapped.contains("[IO.File]::WriteAllText("));
    assert!(wrapped.contains(".window'"));
    assert!(!wrapped.contains("Write-Output $windowHwnd"));
}

#[test]
fn each_application_runs_one_script_at_a_time() {
    let first = lock_for("excel");
    let again = lock_for("excel");
    let other = lock_for("word");
    assert!(Arc::ptr_eq(&first, &again));
    assert!(!Arc::ptr_eq(&first, &other));
    let _held = first.lock().unwrap();
    assert!(again.try_lock().is_err());
    assert!(other.try_lock().is_ok());
}

#[cfg(windows)]
#[test]
#[ignore = "runs Windows PowerShell"]
fn a_plain_script_reports_output_and_exit_code() {
    let shell = App {
        id: "shell".into(),
        name: "Shell".into(),
        prog_id: "Shell.Application".into(),
        executable: r"C:\Windows\explorer.exe".into(),
        mcp: None,
    };
    let result = run(
        &shell,
        "Write-Output ('ok ' + [bool]$app); exit 3",
        &std::env::temp_dir(),
        DEFAULT_TIMEOUT,
        Instant::now(),
    )
    .unwrap();
    assert_eq!(result["exitCode"], 3);
    assert!(result["stopped"].is_null());
    assert!(result["stdout"].as_str().unwrap().contains("ok True"));
}

#[cfg(windows)]
#[test]
#[ignore = "runs Windows PowerShell"]
fn a_script_that_runs_too_long_is_stopped_at_its_limit() {
    let shell = App {
        id: "shell-limit".into(),
        name: "Shell".into(),
        prog_id: "Shell.Application".into(),
        executable: r"C:\Windows\explorer.exe".into(),
        mcp: None,
    };
    let started = Instant::now();
    let result = run(
        &shell,
        "Start-Sleep 60",
        &std::env::temp_dir(),
        Duration::from_secs(5),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(result["stopped"], "timed-out");
    assert_eq!(result["timedOut"], true);
    assert!(result["message"].as_str().unwrap().contains("5 s"));
    assert!(started.elapsed() < Duration::from_secs(15));
    assert!(super::super::app_busy::suspect("shell-limit"));
}

/// A script whose application shows a modal message box is stopped within seconds, and the
/// agent gets the dialog's text. Here the "application" is PowerShell itself.
#[cfg(windows)]
#[test]
#[ignore = "runs Windows PowerShell and shows a message box"]
fn a_dialog_in_the_application_stops_the_request_with_its_text() {
    let powershell = App {
        id: "dialog-test".into(),
        name: "Dialog test".into(),
        prog_id: "Shell.Application".into(),
        executable: r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe".into(),
        mcp: None,
    };
    let started = Instant::now();
    let result = run(
        &powershell,
        "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('Replace the existing file?', 'Cairngorm dialog test', 'YesNo')",
        &std::env::temp_dir(),
        Duration::from_secs(60),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(result["stopped"], "app-dialog", "{result}");
    let message = result["message"].as_str().unwrap();
    assert!(
        message.contains("Replace the existing file?") && message.contains("[Yes]"),
        "{message}"
    );
    assert!(started.elapsed() < Duration::from_secs(20));
}

#[test]
fn every_single_quote_powershell_knows_is_doubled() {
    assert_eq!(quoted("O’Brien's ‘x‚y‛"), "O’’Brien''s ‘‘x‚‚y‛‛");
    let wrapped = wrap(&excel(), "", Path::new(r"C:\Users\O’Brien\a.pids"));
    assert!(wrapped.contains(r"'C:\Users\O’’Brien\a.pids'"));
}
