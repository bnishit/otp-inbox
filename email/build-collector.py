from pathlib import Path
root = Path(__file__).resolve().parent
(root / "collector.gs").write_text((root / "collector-main.gs").read_text() + "\n" + (root / "mail.js").read_text().replace("export function", "function"))
