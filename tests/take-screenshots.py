from pathlib import Path
from playwright.sync_api import sync_playwright

output = Path(__file__).resolve().parent.parent / "logs" / "e2e" / "screenshots"
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto("http://localhost:1420")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    page.screenshot(path=str(output / "screenshot-chat.png"))
    
    editor_btn = page.locator('[data-testid="mode-editor"]')
    if editor_btn.count() > 0:
        editor_btn.click()
        page.wait_for_timeout(1500)
        page.screenshot(path=str(output / "screenshot-editor.png"))
        print("Editor screenshot taken")
    else:
        print("Editor button not found")
    
    browser.close()
