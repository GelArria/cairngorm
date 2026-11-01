#[test]
fn registrations_become_one_app_each_without_system_servers() {
    let row = |p: &str, e: &str, d: &str| (p.to_string(), e.to_string(), d.to_string());
    let apps = super::from_entries(vec![
        row(
            "Excel.Application.16",
            r"C:\Old\EXCEL.EXE",
            "Microsoft Excel",
        ),
        row("Zeta.application", r"D:\Zeta\zeta.exe", "Zeta Studio"),
        row(
            "Excel.Application",
            r"C:\Office\EXCEL.EXE",
            "Microsoft Excel",
        ),
        row("Photoshop.Application", r"D:\Adobe\Photoshop.exe", ""),
        row("MMC20.Application", r"D:\x\mmc.exe", "Console"),
        row("Shell.Application", r"C:\Windows\explorer.exe", ""),
    ]);
    let ids: Vec<&str> = apps.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, ["excel", "photoshop", "zeta"]);
    assert_eq!(apps[0].prog_id, "Excel.Application");
    assert_eq!(apps[0].executable, r"C:\Office\EXCEL.EXE");
    assert_eq!(apps[0].name, "Microsoft Excel");
    assert_eq!(apps[1].name, "Photoshop");
}
