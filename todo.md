# Photoblog TODOs

## Cleanup: Remove LFS artifacts
The `.git/lfs/` directory still contains ~22GB of LFS objects from before the migration.
These are no longer needed since images are now committed directly (downsized in `files/photoblog/`).
Full-size originals are in `original_photos/` (gitignored).

To clean up:
```bash
rm -rf .git/lfs
rm -f .lfs-assets-id
```

This will free ~22GB of disk space. The originals in `original_photos/` are the source of truth.

## Recovery: Download missing Google-hosted images
223 photos exist only as Google/Blogger URLs (the original files were HTML wrappers, not actual images).
75 photos are completely lost (dead Blogger landing pages).

URLs are saved in `download_urls.json` (gitignored). Each entry has:
- `file`: the expected path in `files/photoblog/`
- `url`: the `lh3.googleusercontent.com` URL

To attempt recovery:
```python
import json, urllib.request
urls = json.load(open("download_urls.json"))
for entry in urls:
    urllib.request.urlretrieve(entry["url"], entry["file"])
```

After downloading, move them to `original_photos/` and run:
```bash
python process_photos.py --from-migration
```

## Setup: Configure git hooks
To enable the pre-commit hook that auto-processes new photos:
```bash
git config core.hooksPath .githooks
```
