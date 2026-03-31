# Local Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local editing interface to the photoblog that allows caption editing, post merging, photo splitting, soft-delete with trash, and permanent purge, all through the existing site UI served by a Python API server.

**Architecture:** A Python HTTP server (`scripts/editor.py`) serves `_site/` and injects `editor.js` + `editor.css` into HTML responses. The JS adds editing controls (pencil icons, checkboxes, toolbars, dialogs). Mutations hit `/api/*` endpoints that update metadata JSONs, regenerate markdown, and trigger incremental rebuilds. A `deleted` flag in metadata enables soft-delete.

**Tech Stack:** Python 3 `http.server` (no deps), vanilla JS, existing build pipeline (`build.py`, `process_photos.py`).

**Key file references:**
- Metadata schema: `metadata/20220321_photo_5.json` (example)
- Markdown generator: `scripts/process_photos.py:143-208` (`generate_markdown_from_json`)
- Build entry: `scripts/build.py:312-803` (`build()` function)
- Grid item HTML: `scripts/build.py:673-703` (`make_grid_items`)
- Feed item HTML: `scripts/build.py:705-730` (`make_feed_items`)
- Post template: `templates/post.html`
- Base template: `templates/base.html`
- Lightbox JS: `static/lightbox.js`

---

### Task 1: Add `deleted` flag support to build pipeline

**Files:**
- Modify: `scripts/build.py:312-327` (post collection loop)
- Modify: `scripts/process_photos.py:143-208` (`generate_markdown_from_json`)

**Step 1: Modify `generate_markdown_from_json` to skip deleted photos**

In `scripts/process_photos.py`, update the function to:
- Return `None` if the post-level `deleted` is `true`
- Skip individual photos where `deleted` is `true`
- If all non-deleted photos are empty, return `None`

```python
# At line 145, after loading data:
def generate_markdown_from_json(json_path):
    """Generate a markdown post file from a metadata JSON file."""
    data = json.loads(json_path.read_text(encoding="utf-8"))

    # Skip deleted posts
    if data.get("deleted"):
        return None

    title = data.get("title", data.get("date", "Untitled"))
    tags = ", ".join(data.get("tags", ["photoblog"]))
    photos = [p for p in data.get("photos", []) if not p.get("deleted")]
    if not photos:
        return None
```

**Step 2: Add `data-slug` attribute to grid items and feed cards**

The editor JS needs to know which metadata JSON a grid/feed item corresponds to. In `scripts/build.py`:

At `make_grid_items` (line 687), add `data-slug="{slug}"` to the grid item div. The `slug` value should be the underscore-format slug (matching the JSON filename). This requires passing `slug` through `posts_data`.

At the post collection loop (line 359), add `slug` to each `posts_data` entry. The `slug` variable is already available from `parse_filename`.

In `posts_data.append` (line 447), add `"slug": slug`.

In `make_grid_items` (line 687-701), add `data-slug` attribute:
```python
f' data-slug="{p["slug"]}"'
```

In `make_feed_items` (line 716-729), add `data-slug` attribute:
```python
f' data-slug="{p["slug"]}"'
```

**Step 3: Add `data-slug` to post detail pages**

In `templates/post.html`, add a data attribute to the article element:
```html
<article class="post-detail" data-slug="{{slug}}">
```

Update the `render_template` call for posts in `build.py` (line 432-436) to pass `slug`:
```python
post_html = render_template(
    post_tmpl, title=title, date=date_str_full, body=body_html,
    comments=comments_html, comment_endpoint=COMMENT_ENDPOINT,
    post_slug=url_slug, tag_chips=tag_chips_html, slug=slug,
)
```

**Step 4: Verify build still works**

Run: `python scripts/build.py --local --force`
Expected: Same output as before (709 posts).

**Step 5: Commit**

```
feat: add deleted flag support and data-slug attributes to build pipeline
```

---

### Task 2: Create the API server (`scripts/editor.py`)

**Files:**
- Create: `scripts/editor.py`

This is the core server. It:
- Serves `_site/` as static files
- Injects `<link>` and `<script>` tags for editor assets into HTML responses
- Routes `/api/*` requests to handler functions
- Calls build pipeline after mutations

**Step 1: Create the basic server with HTML injection**

```python
#!/usr/bin/env python3
"""Local editor server. Serves the static site with editing controls injected."""

import json
import os
import re
import shutil
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BLOG_DIR = Path(__file__).parent.parent
SITE_DIR = BLOG_DIR / "_site"
METADATA_DIR = BLOG_DIR / "metadata"
POSTS_DIR = BLOG_DIR / "posts"
PHOTOBLOG_DIR = BLOG_DIR / "files" / "photoblog"

# Import from sibling scripts
sys.path.insert(0, str(Path(__file__).parent))
from process_photos import generate_markdown_from_json


EDITOR_INJECT = """
<link rel="stylesheet" href="/static/editor.css">
<script src="/static/editor.js"></script>
"""


def rebuild():
    """Run incremental build in local mode."""
    subprocess.run(
        [sys.executable, str(BLOG_DIR / "scripts" / "build.py"), "--local"],
        cwd=str(BLOG_DIR),
        capture_output=True,
    )


def regenerate_post(slug):
    """Regenerate markdown for a single post from its metadata JSON."""
    json_path = METADATA_DIR / f"{slug}.json"
    if not json_path.exists():
        return False
    md_content = generate_markdown_from_json(json_path)
    md_path = POSTS_DIR / f"{slug}.md"
    if md_content:
        md_path.write_text(md_content, encoding="utf-8")
    elif md_path.exists():
        md_path.unlink()
    return True


def load_metadata(slug):
    """Load metadata JSON for a post."""
    path = METADATA_DIR / f"{slug}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_metadata(slug, data):
    """Save metadata JSON for a post."""
    path = METADATA_DIR / f"{slug}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/trash":
            self.handle_trash_list()
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        routes = {
            "/api/caption": self.handle_caption,
            "/api/merge": self.handle_merge,
            "/api/split": self.handle_split,
            "/api/delete": self.handle_delete,
            "/api/restore": self.handle_restore,
            "/api/purge": self.handle_purge,
        }
        handler = routes.get(parsed.path)
        if handler:
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError:
                self.send_json({"error": "Invalid JSON"}, 400)
                return
            handler(data)
        else:
            self.send_error(404)

    def end_headers(self):
        """Inject editor assets into HTML responses."""
        super().end_headers()

    def send_response_with_body(self, body, content_type="text/html"):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def copyfile(self, source, outputfile):
        """Override to inject editor assets into HTML pages."""
        # Check if this is an HTML response by peeking at content
        content = source.read()
        if b"</body>" in content:
            content = content.replace(
                b"</body>",
                EDITOR_INJECT.encode("utf-8") + b"</body>",
            )
        outputfile.write(content)

    # --- API handlers ---

    def handle_caption(self, data):
        slug = data.get("slug")
        caption = data.get("caption", "")
        photo_index = data.get("photo_index")  # None = post caption, int = photo caption

        meta = load_metadata(slug)
        if not meta:
            self.send_json({"error": "Post not found"}, 404)
            return

        if photo_index is not None:
            photos = [p for p in meta.get("photos", []) if not p.get("deleted")]
            if photo_index < 0 or photo_index >= len(photos):
                self.send_json({"error": "Photo index out of range"}, 400)
                return
            # Find the actual index in the full photos array
            actual_idx = 0
            count = 0
            for i, p in enumerate(meta["photos"]):
                if not p.get("deleted"):
                    if count == photo_index:
                        actual_idx = i
                        break
                    count += 1
            meta["photos"][actual_idx]["caption"] = caption
        else:
            meta["caption"] = caption

        save_metadata(slug, meta)
        regenerate_post(slug)
        rebuild()
        url_slug = slug.replace("_", "-")
        self.send_json({"ok": True, "url": f"/{url_slug}/"})

    def handle_merge(self, data):
        slugs = data.get("slugs", [])
        target_date = data.get("date")  # "YYYY-MM-DD"
        target_slug_name = data.get("slug_name", "")  # e.g. "merged_photos"
        caption = data.get("caption", "")

        if len(slugs) < 2:
            self.send_json({"error": "Need at least 2 posts to merge"}, 400)
            return

        # Load all source metadata
        sources = []
        for s in slugs:
            meta = load_metadata(s)
            if not meta:
                self.send_json({"error": f"Post not found: {s}"}, 404)
                return
            sources.append((s, meta))

        # Build new slug: YYYYMMDD_slug_name
        date_part = target_date.replace("-", "")[:8]
        new_slug = f"{date_part}_{target_slug_name}"

        # Collect all non-deleted photos from all sources, renaming web files
        new_photos = []
        seq = 1
        for old_slug, meta in sources:
            for photo in meta.get("photos", []):
                if photo.get("deleted"):
                    continue
                old_web = photo["web"]
                old_path = BLOG_DIR / old_web
                # New filename: YYYY-MM-DD_slug_name_NN.jpg
                new_fname = f"{target_date}_{target_slug_name}_{seq:02d}.jpg"
                new_web = f"files/photoblog/{new_fname}"
                new_path = BLOG_DIR / new_web
                if old_path.exists() and old_path != new_path:
                    shutil.copy2(old_path, new_path)
                new_photo = dict(photo)
                new_photo["web"] = new_web
                new_photos.append(new_photo)
                seq += 1

        if not new_photos:
            self.send_json({"error": "No photos to merge"}, 400)
            return

        # Create new metadata
        new_meta = {
            "title": sources[0][1].get("title", target_date),
            "date": target_date,
            "slug": new_slug,
            "caption": caption,
            "tags": sources[0][1].get("tags", ["photoblog"]),
            "photos": new_photos,
        }
        save_metadata(new_slug, new_meta)
        regenerate_post(new_slug)

        # Soft-delete originals
        for old_slug, meta in sources:
            meta["deleted"] = True
            save_metadata(old_slug, meta)
            regenerate_post(old_slug)

        rebuild()
        url_slug = new_slug.replace("_", "-")
        self.send_json({"ok": True, "url": f"/{url_slug}/"})

    def handle_split(self, data):
        source_slug = data.get("source_slug")
        photo_indices = data.get("photo_indices", [])  # indices of non-deleted photos
        target_date = data.get("date")
        target_slug_name = data.get("slug_name", "")
        caption = data.get("caption", "")

        meta = load_metadata(source_slug)
        if not meta:
            self.send_json({"error": "Post not found"}, 404)
            return

        # Get non-deleted photos
        active_photos = [(i, p) for i, p in enumerate(meta["photos"]) if not p.get("deleted")]
        if not photo_indices:
            self.send_json({"error": "No photos selected"}, 400)
            return

        # Map display indices to actual indices
        selected_actual = []
        for display_idx in photo_indices:
            if display_idx < 0 or display_idx >= len(active_photos):
                self.send_json({"error": f"Photo index out of range: {display_idx}"}, 400)
                return
            selected_actual.append(active_photos[display_idx][0])

        # Build new post
        date_part = target_date.replace("-", "")[:8]
        new_slug = f"{date_part}_{target_slug_name}"

        new_photos = []
        seq = 1
        for actual_idx in selected_actual:
            photo = meta["photos"][actual_idx]
            old_web = photo["web"]
            old_path = BLOG_DIR / old_web
            new_fname = f"{target_date}_{target_slug_name}_{seq:02d}.jpg"
            new_web = f"files/photoblog/{new_fname}"
            new_path = BLOG_DIR / new_web
            if old_path.exists() and old_path != new_path:
                shutil.copy2(old_path, new_path)
            new_photo = dict(photo)
            new_photo["web"] = new_web
            new_photos.append(new_photo)
            seq += 1

        new_meta = {
            "title": meta.get("title", target_date),
            "date": target_date,
            "slug": new_slug,
            "caption": caption,
            "tags": meta.get("tags", ["photoblog"]),
            "photos": new_photos,
        }
        save_metadata(new_slug, new_meta)
        regenerate_post(new_slug)

        # Mark split photos as deleted in source
        for actual_idx in selected_actual:
            meta["photos"][actual_idx]["deleted"] = True

        # If all photos deleted, mark post as deleted
        if all(p.get("deleted") for p in meta["photos"]):
            meta["deleted"] = True

        save_metadata(source_slug, meta)
        regenerate_post(source_slug)
        rebuild()

        url_slug = new_slug.replace("_", "-")
        self.send_json({"ok": True, "url": f"/{url_slug}/"})

    def handle_delete(self, data):
        slugs = data.get("slugs", [])
        photo_indices = data.get("photo_indices")  # None = delete whole posts

        for slug in slugs:
            meta = load_metadata(slug)
            if not meta:
                continue
            if photo_indices is not None:
                # Delete specific photos
                active = [(i, p) for i, p in enumerate(meta["photos"]) if not p.get("deleted")]
                for di in photo_indices:
                    if 0 <= di < len(active):
                        meta["photos"][active[di][0]]["deleted"] = True
                if all(p.get("deleted") for p in meta["photos"]):
                    meta["deleted"] = True
            else:
                meta["deleted"] = True
            save_metadata(slug, meta)
            regenerate_post(slug)

        rebuild()
        self.send_json({"ok": True})

    def handle_restore(self, data):
        slugs = data.get("slugs", [])
        photo_indices = data.get("photo_indices")

        for slug in slugs:
            meta = load_metadata(slug)
            if not meta:
                continue
            if photo_indices is not None:
                # Restore specific photos (by index in full array)
                deleted = [(i, p) for i, p in enumerate(meta["photos"]) if p.get("deleted")]
                for di in photo_indices:
                    if 0 <= di < len(deleted):
                        meta["photos"][deleted[di][0]].pop("deleted", None)
            else:
                meta.pop("deleted", None)
                # Also restore all photos
                for p in meta["photos"]:
                    p.pop("deleted", None)
            save_metadata(slug, meta)
            regenerate_post(slug)

        rebuild()
        self.send_json({"ok": True})

    def handle_purge(self, data):
        slugs = data.get("slugs", [])

        for slug in slugs:
            meta = load_metadata(slug)
            if not meta:
                continue
            # Delete web images
            for photo in meta.get("photos", []):
                web_path = BLOG_DIR / photo.get("web", "")
                if web_path.exists():
                    web_path.unlink()
                # Delete thumbnail
                thumb_path = BLOG_DIR / "files" / "thumbs" / (Path(photo.get("web", "")).stem + ".png")
                if thumb_path.exists():
                    thumb_path.unlink()
            # Delete metadata JSON
            json_path = METADATA_DIR / f"{slug}.json"
            if json_path.exists():
                json_path.unlink()
            # Delete markdown
            md_path = POSTS_DIR / f"{slug}.md"
            if md_path.exists():
                md_path.unlink()
            # Delete from _site
            url_slug = slug.replace("_", "-")
            site_post = SITE_DIR / url_slug
            if site_post.exists():
                shutil.rmtree(site_post)

        rebuild()
        self.send_json({"ok": True})

    def handle_trash_list(self):
        """Return all deleted posts."""
        trash = []
        for jf in sorted(METADATA_DIR.glob("*.json")):
            data = json.loads(jf.read_text(encoding="utf-8"))
            if data.get("deleted"):
                photos = data.get("photos", [])
                thumb = photos[0].get("web", "") if photos else ""
                trash.append({
                    "slug": data.get("slug", jf.stem),
                    "title": data.get("title", ""),
                    "date": data.get("date", ""),
                    "thumbnail": thumb,
                    "photo_count": len(photos),
                })
        self.send_json(trash)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Local editor server")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    # Build first
    print("Building site...")
    rebuild()

    server = HTTPServer(("", args.port), EditorHandler)
    print(f"Editor running at http://localhost:{args.port}")
    print("Press Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()


if __name__ == "__main__":
    main()
```

**Step 2: Verify server starts and serves pages**

Run: `python scripts/editor.py`
Expected: Server starts, pages load at `http://localhost:8000`, HTML contains injected editor CSS/JS tags.

**Step 3: Commit**

```
feat: add local editor API server with all endpoints
```

---

### Task 3: Create editor CSS (`static/editor.css`)

**Files:**
- Create: `static/editor.css`

**Step 1: Write the editor stylesheet**

Covers: edit buttons, checkboxes, selection mode, floating toolbar, dialogs, trash view, deleted post styling.

```css
/* --- Editor controls (only loaded in local editor mode) --- */

/* Edit (pencil) buttons */
.edit-btn {
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
  font-size: 16px;
  padding: 4px;
  color: var(--text-muted);
  vertical-align: middle;
}
.edit-btn:hover { color: var(--link); }
.post-meta:hover .edit-btn,
.post-body p:hover > .edit-btn,
.post-body > .edit-btn { opacity: 1; }
.edit-btn.visible { opacity: 1; }

/* Caption editor inline */
.caption-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0;
  width: 100%;
}
.caption-editor textarea {
  width: 100%;
  min-height: 80px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
}
.caption-editor .caption-actions {
  display: flex;
  gap: 8px;
}
.caption-editor button {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.caption-editor .save-btn {
  background: var(--link);
  color: #fff;
}
.caption-editor .cancel-btn {
  background: var(--border);
  color: var(--text);
}

/* Photo checkboxes */
.photo-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 24px;
  height: 24px;
  border: 2px solid #fff;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  z-index: 10;
  display: none;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}
.photo-checkbox::after {
  content: "\2713";
  color: #fff;
  font-size: 14px;
  display: none;
}
.photo-checkbox.checked {
  background: var(--link);
  border-color: var(--link);
}
.photo-checkbox.checked::after { display: block; }

/* Show checkboxes on hover or in selection mode */
.grid-item:hover .photo-checkbox,
.post-body .photo-wrapper:hover .photo-checkbox,
.selection-mode .photo-checkbox {
  display: flex;
}

/* Grid item: needs relative positioning for checkbox */
.grid-item { position: relative; }

/* Post body photo wrapper */
.photo-wrapper {
  position: relative;
  display: inline-block;
}

/* Selection mode floating toolbar */
.editor-toolbar {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 20px;
  display: none;
  align-items: center;
  gap: 12px;
  z-index: 200;
  box-shadow: 0 4px 20px var(--shadow);
}
.editor-toolbar.visible { display: flex; }
.editor-toolbar .toolbar-count {
  font-size: 14px;
  color: var(--text-muted);
  white-space: nowrap;
}
.editor-toolbar button {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}
.editor-toolbar .merge-btn { background: var(--link); color: #fff; }
.editor-toolbar .delete-btn { background: #e74c3c; color: #fff; }
.editor-toolbar .split-btn { background: var(--link); color: #fff; }
.editor-toolbar .cancel-sel-btn { background: var(--border); color: var(--text); }

/* Editor dialog (modal) */
.editor-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 1001;
  display: none;
  align-items: center;
  justify-content: center;
}
.editor-dialog-overlay.open { display: flex; }
.editor-dialog {
  background: var(--bg-card);
  border-radius: 12px;
  padding: 24px;
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}
.editor-dialog h2 {
  margin: 0 0 16px;
  font-size: 18px;
}
.editor-dialog label {
  display: block;
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.editor-dialog input[type="text"],
.editor-dialog input[type="date"],
.editor-dialog textarea {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  margin-bottom: 12px;
  box-sizing: border-box;
}
.editor-dialog textarea {
  min-height: 100px;
  resize: vertical;
}
.editor-dialog .dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
.editor-dialog .dialog-actions button {
  padding: 8px 20px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.editor-dialog .btn-primary { background: var(--link); color: #fff; }
.editor-dialog .btn-danger { background: #e74c3c; color: #fff; }
.editor-dialog .btn-cancel { background: var(--border); color: var(--text); }

/* Deleted posts in grid (editor mode) */
.grid-item.deleted {
  opacity: 0.35;
  filter: grayscale(0.8);
}
.grid-item.deleted .deleted-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 5;
}
.feed-card.deleted {
  opacity: 0.35;
  filter: grayscale(0.8);
}

/* Show/hide deleted toggle */
.editor-nav-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.editor-nav-controls button {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.editor-nav-controls button.active {
  background: var(--link);
  color: #fff;
  border-color: var(--link);
}

/* Trash view */
.trash-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
  margin-top: 16px;
}
.trash-item {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 4px;
}
.trash-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.trash-item-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: 4px;
  padding: 8px;
  background: linear-gradient(transparent, rgba(0,0,0,0.8));
}
.trash-item-actions button {
  flex: 1;
  padding: 6px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.trash-item-actions .restore-btn { background: var(--link); color: #fff; }
.trash-item-actions .purge-btn { background: #e74c3c; color: #fff; }

/* Post detail: edit mode photo wrapper */
.post-body img { position: relative; }
```

**Step 2: Commit**

```
feat: add editor CSS for editing controls and dialogs
```

---

### Task 4: Create editor JavaScript (`static/editor.js`)

**Files:**
- Create: `static/editor.js`

This is the largest piece. It handles:
- Caption editing (pencil icons, inline textareas)
- Selection mode (checkboxes on grid items and post photos)
- Floating toolbar with merge/delete/split actions
- Dialog modals for merge, split, delete confirmation
- Trash view
- Show/hide deleted toggle

**Step 1: Write editor.js**

```javascript
// Editor controls — injected only when served by the local editor server
(function () {
  'use strict';

  var selected = {};  // slug -> true (grid) or source_slug -> [photo_indices] (post)
  var selectionMode = false;
  var isPostPage = !!document.querySelector('.post-detail');
  var postSlug = '';
  if (isPostPage) {
    var article = document.querySelector('.post-detail');
    postSlug = article ? article.dataset.slug : '';
  }

  // --- Utility ---
  function api(method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (r) { return r.json(); });
  }

  function reloadPage(url) {
    if (url) window.location.href = url;
    else window.location.reload();
  }

  // --- Caption Editing ---
  function addCaptionEditors() {
    if (!isPostPage || !postSlug) return;

    // Post-level caption: add pencil after post-meta
    var postMeta = document.querySelector('.post-meta');
    if (postMeta) {
      var btn = document.createElement('button');
      btn.className = 'edit-btn visible';
      btn.textContent = '\u270F';
      btn.title = 'Edit post caption';
      btn.addEventListener('click', function () { openCaptionEditor(null); });
      postMeta.appendChild(btn);
    }

    // Photo-level captions: add pencil next to each photo
    var imgs = document.querySelectorAll('.post-body img');
    imgs.forEach(function (img, idx) {
      var wrapper = img.closest('p') || img.parentElement;
      var btn = document.createElement('button');
      btn.className = 'edit-btn';
      btn.textContent = '\u270F';
      btn.title = 'Edit photo caption';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openCaptionEditor(idx);
      });
      // Insert after the image paragraph
      if (wrapper.nextElementSibling) {
        wrapper.parentElement.insertBefore(btn, wrapper.nextElementSibling);
      } else {
        wrapper.parentElement.appendChild(btn);
      }
    });
  }

  function openCaptionEditor(photoIndex) {
    // Fetch current caption from metadata
    api('GET', '/api/trash').then(function () {
      // We actually need to get current caption, so just read from the page or fetch
      // For simplicity, create editor with current visible text
      var existingEditor = document.querySelector('.caption-editor');
      if (existingEditor) existingEditor.remove();

      var currentText = '';
      if (photoIndex === null) {
        // Post caption: text between title and first image
        var body = document.querySelector('.post-body');
        if (body) {
          var firstImg = body.querySelector('p > img');
          var firstP = body.querySelector('p');
          if (firstP && firstImg && firstP !== firstImg.parentElement) {
            currentText = firstP.textContent || '';
          }
        }
      } else {
        // Photo caption: italic text after the image
        var imgs = document.querySelectorAll('.post-body img');
        if (imgs[photoIndex]) {
          var imgP = imgs[photoIndex].closest('p');
          if (imgP) {
            var next = imgP.nextElementSibling;
            if (next && (next.tagName === 'P' && next.querySelector('em'))) {
              currentText = next.textContent || '';
            }
          }
        }
      }

      var container = document.createElement('div');
      container.className = 'caption-editor';
      container.innerHTML =
        '<textarea placeholder="Write a caption...">' + escapeHtml(currentText) + '</textarea>' +
        '<div class="caption-actions">' +
        '<button class="save-btn">Save</button>' +
        '<button class="cancel-btn">Cancel</button>' +
        '</div>';

      var target;
      if (photoIndex === null) {
        target = document.querySelector('.post-meta');
      } else {
        var imgs = document.querySelectorAll('.post-body img');
        target = imgs[photoIndex] ? imgs[photoIndex].closest('p') : null;
      }
      if (target) target.insertAdjacentElement('afterend', container);

      var ta = container.querySelector('textarea');
      ta.focus();

      container.querySelector('.save-btn').addEventListener('click', function () {
        api('POST', '/api/caption', {
          slug: postSlug,
          caption: ta.value,
          photo_index: photoIndex,
        }).then(function (res) { reloadPage(res.url); });
      });
      container.querySelector('.cancel-btn').addEventListener('click', function () {
        container.remove();
      });
    });
  }

  // --- Selection Mode (Grid) ---
  function addGridCheckboxes() {
    document.querySelectorAll('.grid-item').forEach(function (item) {
      var cb = document.createElement('div');
      cb.className = 'photo-checkbox';
      item.insertBefore(cb, item.firstChild);

      cb.addEventListener('click', function (e) {
        e.stopPropagation();
        var slug = item.dataset.slug;
        if (!slug) return;
        cb.classList.toggle('checked');
        if (cb.classList.contains('checked')) {
          selected[slug] = true;
          enterSelectionMode();
        } else {
          delete selected[slug];
          if (Object.keys(selected).length === 0) exitSelectionMode();
        }
        updateToolbar();
      });
    });
  }

  // --- Selection Mode (Post Page) ---
  function addPostPhotoCheckboxes() {
    if (!isPostPage || !postSlug) return;
    var imgs = document.querySelectorAll('.post-body img');
    imgs.forEach(function (img, idx) {
      var p = img.closest('p');
      if (!p) return;
      p.classList.add('photo-wrapper');
      p.style.position = 'relative';

      var cb = document.createElement('div');
      cb.className = 'photo-checkbox';
      p.insertBefore(cb, p.firstChild);

      cb.addEventListener('click', function (e) {
        e.stopPropagation();
        cb.classList.toggle('checked');
        if (!selected[postSlug]) selected[postSlug] = [];
        if (cb.classList.contains('checked')) {
          selected[postSlug].push(idx);
          enterSelectionMode();
        } else {
          selected[postSlug] = selected[postSlug].filter(function (i) { return i !== idx; });
          if (selected[postSlug].length === 0) {
            delete selected[postSlug];
            if (Object.keys(selected).length === 0) exitSelectionMode();
          }
        }
        updateToolbar();
      });
    });
  }

  function enterSelectionMode() {
    selectionMode = true;
    document.body.classList.add('selection-mode');
  }

  function exitSelectionMode() {
    selectionMode = false;
    document.body.classList.remove('selection-mode');
    selected = {};
    document.querySelectorAll('.photo-checkbox.checked').forEach(function (cb) {
      cb.classList.remove('checked');
    });
    updateToolbar();
  }

  // --- Floating Toolbar ---
  var toolbar;
  function createToolbar() {
    toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.innerHTML =
      '<span class="toolbar-count"></span>' +
      (isPostPage
        ? '<button class="split-btn">Split to new post</button><button class="delete-btn">Delete photos</button>'
        : '<button class="merge-btn">Merge selected</button><button class="delete-btn">Delete selected</button>'
      ) +
      '<button class="cancel-sel-btn">Cancel</button>';
    document.body.appendChild(toolbar);

    if (isPostPage) {
      toolbar.querySelector('.split-btn').addEventListener('click', openSplitDialog);
      toolbar.querySelector('.delete-btn').addEventListener('click', function () {
        var indices = selected[postSlug] || [];
        openDeleteDialog(null, indices);
      });
    } else {
      toolbar.querySelector('.merge-btn').addEventListener('click', openMergeDialog);
      toolbar.querySelector('.delete-btn').addEventListener('click', function () {
        openDeleteDialog(Object.keys(selected), null);
      });
    }
    toolbar.querySelector('.cancel-sel-btn').addEventListener('click', exitSelectionMode);
  }

  function updateToolbar() {
    if (!toolbar) return;
    var count;
    if (isPostPage) {
      count = (selected[postSlug] || []).length;
    } else {
      count = Object.keys(selected).length;
    }
    toolbar.querySelector('.toolbar-count').textContent = count + ' selected';
    toolbar.classList.toggle('visible', count > 0);
  }

  // --- Dialogs ---
  var dialogOverlay;
  function initDialogOverlay() {
    dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'editor-dialog-overlay';
    document.body.appendChild(dialogOverlay);
    dialogOverlay.addEventListener('click', function (e) {
      if (e.target === dialogOverlay) closeDialog();
    });
  }

  function openDialog(html) {
    dialogOverlay.innerHTML = '<div class="editor-dialog">' + html + '</div>';
    dialogOverlay.classList.add('open');
    return dialogOverlay.querySelector('.editor-dialog');
  }

  function closeDialog() {
    dialogOverlay.classList.remove('open');
    dialogOverlay.innerHTML = '';
  }

  function openMergeDialog() {
    var slugs = Object.keys(selected);
    if (slugs.length < 2) return;

    // Suggest date from first slug (YYYYMMDD prefix)
    var firstSlug = slugs.sort()[0];
    var dateMatch = firstSlug.match(/^(\d{4})(\d{2})(\d{2})/);
    var suggestedDate = dateMatch
      ? dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3]
      : new Date().toISOString().slice(0, 10);

    var dialog = openDialog(
      '<h2>Merge ' + slugs.length + ' posts</h2>' +
      '<label>Date</label>' +
      '<input type="date" id="merge-date" value="' + suggestedDate + '">' +
      '<label>Slug (letters, numbers, underscores)</label>' +
      '<input type="text" id="merge-slug" placeholder="merged_photos">' +
      '<label>Caption (edit before merging)</label>' +
      '<textarea id="merge-caption" placeholder="Combined caption..."></textarea>' +
      '<div class="dialog-actions">' +
      '<button class="btn-cancel">Cancel</button>' +
      '<button class="btn-primary">Merge</button>' +
      '</div>'
    );

    // Pre-fill caption: fetch all captions and combine with ---
    // For now use slug names as placeholder, actual captions loaded from page data
    var captionParts = [];
    slugs.forEach(function (s) {
      var item = document.querySelector('[data-slug="' + s + '"]');
      if (item && item.dataset.excerpt) captionParts.push(item.dataset.excerpt);
    });
    dialog.querySelector('#merge-caption').value = captionParts.filter(Boolean).join('\n\n---\n\n');

    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-primary').addEventListener('click', function () {
      var date = dialog.querySelector('#merge-date').value;
      var slugName = dialog.querySelector('#merge-slug').value.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
      var caption = dialog.querySelector('#merge-caption').value;
      if (!date || !slugName) { alert('Date and slug are required'); return; }
      api('POST', '/api/merge', {
        slugs: slugs, date: date, slug_name: slugName, caption: caption,
      }).then(function (res) {
        closeDialog();
        exitSelectionMode();
        reloadPage(res.url);
      });
    });
  }

  function openSplitDialog() {
    var indices = selected[postSlug] || [];
    if (indices.length === 0) return;

    var dateMatch = postSlug.match(/^(\d{4})(\d{2})(\d{2})/);
    var suggestedDate = dateMatch
      ? dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3]
      : new Date().toISOString().slice(0, 10);

    var dialog = openDialog(
      '<h2>Split ' + indices.length + ' photo(s) to new post</h2>' +
      '<label>Date</label>' +
      '<input type="date" id="split-date" value="' + suggestedDate + '">' +
      '<label>Slug (letters, numbers, underscores)</label>' +
      '<input type="text" id="split-slug" placeholder="new_post">' +
      '<label>Caption</label>' +
      '<textarea id="split-caption"></textarea>' +
      '<div class="dialog-actions">' +
      '<button class="btn-cancel">Cancel</button>' +
      '<button class="btn-primary">Split</button>' +
      '</div>'
    );

    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-primary').addEventListener('click', function () {
      var date = dialog.querySelector('#split-date').value;
      var slugName = dialog.querySelector('#split-slug').value.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
      var caption = dialog.querySelector('#split-caption').value;
      if (!date || !slugName) { alert('Date and slug are required'); return; }
      api('POST', '/api/split', {
        source_slug: postSlug, photo_indices: indices,
        date: date, slug_name: slugName, caption: caption,
      }).then(function (res) {
        closeDialog();
        exitSelectionMode();
        reloadPage(res.url);
      });
    });
  }

  function openDeleteDialog(slugs, photoIndices) {
    var count = slugs ? slugs.length : (photoIndices || []).length;
    var what = slugs ? 'post(s)' : 'photo(s)';

    var dialog = openDialog(
      '<h2>Delete ' + count + ' ' + what + '?</h2>' +
      '<p>They will be moved to trash. You can restore them later.</p>' +
      '<div class="dialog-actions">' +
      '<button class="btn-cancel">Cancel</button>' +
      '<button class="btn-danger">Delete</button>' +
      '</div>'
    );

    dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
    dialog.querySelector('.btn-danger').addEventListener('click', function () {
      var body = {};
      if (slugs) {
        body.slugs = slugs;
      } else {
        body.slugs = [postSlug];
        body.photo_indices = photoIndices;
      }
      api('POST', '/api/delete', body).then(function () {
        closeDialog();
        exitSelectionMode();
        reloadPage();
      });
    });
  }

  // --- Trash View ---
  function addTrashButton() {
    var nav = document.querySelector('header nav');
    if (!nav) return;

    var controls = document.createElement('span');
    controls.className = 'editor-nav-controls';

    // Show deleted toggle
    var showDelBtn = document.createElement('button');
    showDelBtn.textContent = 'Show deleted';
    showDelBtn.title = 'Toggle visibility of deleted posts';
    var showDel = false;
    showDelBtn.addEventListener('click', function () {
      showDel = !showDel;
      showDelBtn.classList.toggle('active', showDel);
      document.querySelectorAll('.grid-item.deleted, .feed-card.deleted').forEach(function (el) {
        el.style.display = showDel ? '' : 'none';
      });
    });
    controls.appendChild(showDelBtn);

    // Trash button
    var trashBtn = document.createElement('button');
    trashBtn.textContent = 'Trash';
    trashBtn.title = 'View deleted posts';
    trashBtn.addEventListener('click', openTrashView);
    controls.appendChild(trashBtn);

    nav.appendChild(controls);
  }

  function openTrashView() {
    api('GET', '/api/trash').then(function (items) {
      if (items.length === 0) {
        var dialog = openDialog(
          '<h2>Trash</h2><p>No deleted posts.</p>' +
          '<div class="dialog-actions"><button class="btn-cancel">Close</button></div>'
        );
        dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);
        return;
      }

      var gridHtml = items.map(function (item) {
        return '<div class="trash-item" data-slug="' + escapeAttr(item.slug) + '">' +
          '<img src="' + escapeAttr(item.thumbnail) + '" alt="' + escapeAttr(item.title) + '">' +
          '<div class="trash-item-actions">' +
          '<button class="restore-btn">Restore</button>' +
          '<button class="purge-btn">Purge</button>' +
          '</div></div>';
      }).join('');

      var dialog = openDialog(
        '<h2>Trash (' + items.length + ')</h2>' +
        '<div class="trash-grid">' + gridHtml + '</div>' +
        '<div class="dialog-actions"><button class="btn-cancel">Close</button></div>'
      );

      dialog.querySelector('.btn-cancel').addEventListener('click', closeDialog);

      dialog.querySelectorAll('.restore-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var slug = btn.closest('.trash-item').dataset.slug;
          api('POST', '/api/restore', { slugs: [slug] }).then(function () {
            closeDialog();
            reloadPage();
          });
        });
      });

      dialog.querySelectorAll('.purge-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var slug = btn.closest('.trash-item').dataset.slug;
          if (!confirm('Permanently delete this post? This cannot be undone.')) return;
          api('POST', '/api/purge', { slugs: [slug] }).then(function () {
            closeDialog();
            reloadPage();
          });
        });
      });
    });
  }

  // --- HTML escaping ---
  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  function escapeAttr(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // --- Initialize ---
  addCaptionEditors();
  addGridCheckboxes();
  addPostPhotoCheckboxes();
  createToolbar();
  initDialogOverlay();
  addTrashButton();

  // Hide deleted items by default
  document.querySelectorAll('.grid-item.deleted, .feed-card.deleted').forEach(function (el) {
    el.style.display = 'none';
  });
})();
```

**Step 2: Commit**

```
feat: add editor JavaScript for captions, merge, split, delete, trash
```

---

### Task 5: Update build.py to support deleted posts in editor mode

**Files:**
- Modify: `scripts/build.py:321-327` (post collection)
- Modify: `scripts/build.py:673-703` (grid items)
- Modify: `scripts/build.py:705-730` (feed items)

**Step 1: Add slug to posts_data and data-slug to grid/feed HTML**

In `build.py` at the `posts_data.append` block (line 447), add `"slug": slug`:

```python
posts_data.append({
    "title": title,
    "slug": slug,      # <-- add this
    "date": date,
    ...
})
```

In `make_grid_items` (line 687), add `data-slug` and deleted class:

```python
deleted_class = ' deleted' if p.get("deleted") else ''
deleted_badge = '<span class="deleted-badge">Deleted</span>' if p.get("deleted") else ''
# In the f-string:
f'  <div class="grid-item{deleted_class}{" hidden" if page_size and i >= page_size else ""}"'
f' data-slug="{p["slug"]}"'
# ... and include deleted_badge in the inner HTML
```

In `make_feed_items` (line 716), add `data-slug` and deleted class similarly.

**Step 2: Load deleted posts for editor, skip for production**

In `build.py`, the build function needs to include deleted posts when `--local` is passed (for the editor) but skip them otherwise.

After the post collection loop and before sorting (around line 327), add:

```python
# Load metadata to check deleted status
for i, (filename, date, slug, url_slug) in enumerate(posts):
    json_path = BLOG_DIR / "metadata" / f"{slug}.json"
    deleted = False
    if json_path.exists():
        try:
            meta = json.loads(json_path.read_text(encoding="utf-8"))
            deleted = meta.get("deleted", False)
        except (json.JSONDecodeError, OSError):
            pass
    posts[i] = (filename, date, slug, url_slug, deleted)

if not local:
    posts = [(f, d, s, u, dl) for f, d, s, u, dl in posts if not dl]
```

Pass `deleted` through to `posts_data` and the HTML generators so deleted items get the `deleted` CSS class.

**Step 3: Add `slug` template variable to post.html**

Update `templates/post.html` line 1:
```html
<article class="post-detail" data-slug="{{slug}}">
```

**Step 4: Verify**

Run: `python scripts/build.py --local --force`
Expected: Build succeeds, grid items include `data-slug` attributes.

**Step 5: Commit**

```
feat: add data-slug attributes and deleted post support to build output
```

---

### Task 6: Integration testing

**Step 1: Start the editor server**

Run: `python scripts/editor.py`
Verify: Server starts, pages load with editor controls.

**Step 2: Test caption editing**

Navigate to a post page. Click the pencil icon. Enter a caption. Click save. Verify the page reloads with the updated caption. Check the metadata JSON has the new caption.

**Step 3: Test post deletion**

On the grid page, hover over a post to see the checkbox. Click it. Click another post's checkbox. Click "Delete selected" in the toolbar. Confirm. Verify posts appear greyed out after enabling "Show deleted". Click "Trash" to see them. Restore one. Permanently delete the other.

**Step 4: Test merge**

Select 2+ posts in the grid. Click "Merge selected". Fill in date, slug, caption. Click Merge. Verify the new combined post exists. Check that original posts are in trash.

**Step 5: Test split**

Navigate to a multi-photo post (or the newly merged one). Click checkboxes on some photos. Click "Split to new post". Fill in fields. Click Split. Verify both the source and new post are correct.

**Step 6: Test production build excludes deleted**

Run: `python scripts/build.py --force`
Verify: Deleted posts do not appear in `_site/`.

**Step 7: Commit all integration fixes**

```
fix: integration fixes from editor testing
```

---

### Summary of files

| File | Action | Purpose |
|------|--------|---------|
| `scripts/editor.py` | Create | API server with all endpoints |
| `static/editor.js` | Create | Editor UI controls and API calls |
| `static/editor.css` | Create | Editor-specific styles |
| `scripts/build.py` | Modify | Add data-slug, deleted class, slug in posts_data |
| `scripts/process_photos.py` | Modify | Skip deleted posts/photos in markdown generation |
| `templates/post.html` | Modify | Add data-slug to article element |
