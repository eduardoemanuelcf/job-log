#!/usr/bin/env python3
"""Build Chrome or Firefox packages with extension runtime files and the license."""
import argparse
import json
from pathlib import Path
from shutil import copyfile, rmtree
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', choices=['chrome', 'firefox'], default='chrome')
browser = parser.parse_args().browser
manifest = json.loads((root / "manifest.json").read_text())
assert manifest["manifest_version"] == 3
assert 0 < len(manifest["description"]) <= 132
assert set(manifest["permissions"]) == {"activeTab", "scripting", "storage", "identity"}
assert not manifest.get("host_permissions")
manifest.pop("key", None)
if browser == 'firefox':
    manifest.pop('oauth2', None)
    manifest['browser_specific_settings'] = {'gecko': {
        'id': 'job-log@emanuelcabral.dev',
        'strict_min_version': '140.0',
        'data_collection_permissions': {'required': [
            'personallyIdentifyingInfo', 'authenticationInfo', 'browsingActivity', 'websiteContent'
        ]}
    }}
files = {"LICENSE", "popup.html", "popup.js", "popup-progress.js", "options.html", "options.js", "oauth-config.js", "google-auth.js", "extension.js", "theme.css", "progress.html", "progress.js"}
files.update(manifest["icons"].values())
files.update(manifest["action"]["default_icon"].values())
for name in files:
    assert (root / name).is_file(), f"Missing package file: {name}"

prefix = 'job-log-firefox' if browser == 'firefox' else 'job-log'
destination = root / "dist" / f"{prefix}-{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
staging = destination.parent / browser
if staging.exists():
    rmtree(staging)
staging.mkdir()
manifest_text = json.dumps(manifest, indent=2, ensure_ascii=False) + '\n'
(staging / 'manifest.json').write_text(manifest_text)
for name in files:
    target = staging / name
    target.parent.mkdir(parents=True, exist_ok=True)
    copyfile(root / name, target)
with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
    archive.writestr("manifest.json", manifest_text)
    for name in sorted(files):
        archive.write(root / name, name)
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == files | {"manifest.json"}
print(destination)
print(staging)
print('See README.md for setup and FIREFOX.md for Firefox installation.')
