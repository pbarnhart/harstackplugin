#!/usr/bin/env python3
"""Package the HARstack extension for distribution.

Produces one zip per browser in dist/, each containing only the runtime
files with the correct per-browser manifest renamed to manifest.json:

    dist/harstack-extension-chrome-v<version>.zip   -> Chrome Web Store upload
    dist/harstack-extension-firefox-v<version>.zip  -> addons.mozilla.org upload

Run the build first (or let this script do it): the packaged engine.js is
the generated artifact, never the stub.

Usage:
    cd build && python package.py
"""

import json
import subprocess
import sys
import zipfile
from pathlib import Path

BUILD_DIR = Path(__file__).resolve().parent
ROOT = BUILD_DIR.parent
EXT = ROOT / "extension"
DIST = ROOT / "dist"

# Runtime files only. No README, no tests, no site/, no manifest variants.
RUNTIME_FILES = [
    "devtools.html",
    "devtools.js",
    "panel.html",
    "panel.js",
    "engine.js",
    "report.css",
]
ICON_DIR = EXT / "icons"

TARGETS = {
    "chrome": EXT / "manifest.chrome.json",
    "firefox": EXT / "manifest.firefox.json",
}


def ensure_engine():
    """engine.js is generated; build it if missing and refuse to ship a stub."""
    engine = EXT / "engine.js"
    if not engine.exists():
        print("engine.js missing; running build.py first...")
        subprocess.run([sys.executable, str(BUILD_DIR / "build.py")], check=True, cwd=BUILD_DIR)
    text = engine.read_text(encoding="utf-8")
    if "__isStub: false" not in text:
        sys.exit("FATAL: extension/engine.js looks like a stub. Run build/build.py and retry.")


def package(target: str, manifest_path: Path) -> Path:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = manifest["version"]
    if manifest.get("permissions"):
        sys.exit(f"FATAL: {manifest_path.name} requests permissions {manifest['permissions']}. "
                 "The product promise is an empty permissions array.")

    DIST.mkdir(exist_ok=True)
    out = DIST / f"harstack-extension-{target}-v{version}.zip"
    if out.exists():
        out.unlink()

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        # The per-browser manifest ships as manifest.json at the zip root.
        z.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
        for name in RUNTIME_FILES:
            src = EXT / name
            if not src.exists():
                sys.exit(f"FATAL: missing runtime file {src}")
            z.write(src, name)
        for icon in sorted(ICON_DIR.glob("*.png")):
            z.write(icon, f"icons/{icon.name}")

    names = zipfile.ZipFile(out).namelist()
    print(f"{target.upper():8s} {out.relative_to(ROOT)}  ({out.stat().st_size:,} bytes, {len(names)} files)")
    return out


def main():
    ensure_engine()
    for target, manifest_path in TARGETS.items():
        package(target, manifest_path)
    print("\nChrome:  upload the chrome zip at https://chrome.google.com/webstore/devconsole")
    print("Firefox: upload the firefox zip at https://addons.mozilla.org/developers/")
    print("         (or sign for self-distribution: npx web-ext sign --channel unlisted)")


if __name__ == "__main__":
    main()
