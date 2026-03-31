#!/usr/bin/env python3
"""Local editor API server for the photoblog.

Serves the built site from _site/ with injected editor CSS/JS,
and provides API endpoints for editing metadata, merging/splitting
posts, deleting, restoring, and purging.
"""

import json
import os
import shutil
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs

BLOG_DIR = Path(__file__).resolve().parent.parent
SITE_DIR = BLOG_DIR / "_site"
METADATA_DIR = BLOG_DIR / "metadata"
POSTS_DIR = BLOG_DIR / "posts"
WEB_DIR = BLOG_DIR / "files" / "photoblog"
THUMB_DIR = BLOG_DIR / "files" / "thumbs"
STATIC_DIR = BLOG_DIR / "static"
BUILD_CMD = [sys.executable, str(BLOG_DIR / "scripts" / "build.py"), "--local"]

sys.path.insert(0, str(BLOG_DIR / "scripts"))
from process_photos import generate_markdown_from_json


def load_metadata(slug):
    """Load metadata JSON for a given meta slug."""
    path = METADATA_DIR / f"{slug}.json"
    if not path.exists():
        return None, path
    data = json.loads(path.read_text(encoding="utf-8"))
    return data, path


def save_metadata(data, path):
    """Write metadata JSON back to disk."""
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def regenerate_markdown(slug):
    """Regenerate the markdown post from the metadata JSON."""
    json_path = METADATA_DIR / f"{slug}.json"
    if not json_path.exists():
        return
    md_content = generate_markdown_from_json(json_path)
    md_path = POSTS_DIR / f"{slug}.md"
    if md_content:
        md_path.write_text(md_content, encoding="utf-8")
    elif md_path.exists():
        md_path.unlink()


def rebuild_site():
    """Run the site build command."""
    subprocess.run(BUILD_CMD, cwd=str(BLOG_DIR), check=False)


def non_deleted_to_actual_index(photos, non_deleted_index):
    """Map a non-deleted photo index to the actual array index.

    non_deleted_index counts only photos where deleted is not true.
    Returns the actual index into the photos array, or None if out of range.
    """
    count = 0
    for i, photo in enumerate(photos):
        if photo.get("deleted"):
            continue
        if count == non_deleted_index:
            return i
        count += 1
    return None


def get_non_deleted_photos(data):
    """Return list of (actual_index, photo) for non-deleted photos."""
    return [(i, p) for i, p in enumerate(data.get("photos", [])) if not p.get("deleted")]


INJECT_CSS = '<link rel="stylesheet" href="/static/editor.css">'
INJECT_JS = '<script src="/static/editor.js"></script>'
INJECT_TAG = f"{INJECT_CSS}\n{INJECT_JS}\n</body>"


class EditorHandler(SimpleHTTPRequestHandler):
    """HTTP handler that serves _site/, injects editor assets, and handles API calls."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_DIR), **kwargs)

    def translate_path(self, path):
        """Serve static editor assets from the project static/ dir when requested."""
        if path.startswith("/static/editor."):
            rel = path.lstrip("/")
            candidate = STATIC_DIR / rel.split("/", 1)[1]
            if candidate.exists():
                return str(candidate)
        return super().translate_path(path)

    def copyfile(self, source, outputfile):
        """Override copyfile to inject editor CSS/JS into HTML responses."""
        try:
            content = source.read()
        except Exception:
            super().copyfile(source, outputfile)
            return

        if b"</body>" in content:
            content = content.replace(b"</body>", INJECT_TAG.encode("utf-8"))

        outputfile.write(content)

    def do_POST(self):
        """Route POST requests to API handlers."""
        path = self.path.split("?")[0]
        handlers = {
            "/api/caption": self.handle_caption,
            "/api/merge": self.handle_merge,
            "/api/split": self.handle_split,
            "/api/delete": self.handle_delete,
            "/api/restore": self.handle_restore,
            "/api/purge": self.handle_purge,
        }
        handler = handlers.get(path)
        if handler:
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                result = handler(body)
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})
        else:
            self.send_json(404, {"error": "not found"})

    def do_GET(self):
        """Route GET requests: API endpoints or static files."""
        path = self.path.split("?")[0]
        if path == "/api/trash":
            try:
                result = self.handle_trash()
                self.send_json(200, result)
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return
        super().do_GET()

    def send_json(self, code, data):
        """Send a JSON response."""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # --- API handlers ---

    def handle_caption(self, body):
        """Update caption for a post or a specific photo."""
        slug = body["slug"]
        caption = body.get("caption", "")
        photo_index = body.get("photo_index")

        data, path = load_metadata(slug)
        if data is None:
            return {"error": f"metadata not found: {slug}"}

        if photo_index is not None:
            actual = non_deleted_to_actual_index(data.get("photos", []), photo_index)
            if actual is None:
                return {"error": f"photo index {photo_index} out of range"}
            data["photos"][actual]["caption"] = caption
        else:
            data["caption"] = caption

        save_metadata(data, path)
        regenerate_markdown(slug)
        rebuild_site()
        return {"ok": True, "slug": slug}

    def handle_merge(self, body):
        """Merge multiple posts into a new one."""
        slugs = body["slugs"]
        date = body["date"]
        slug_name = body["slug_name"]
        caption = body.get("caption", "")

        date_part = date.replace("-", "")
        new_slug = f"{date_part}_{slug_name}"

        # Collect all non-deleted photos from source posts
        all_photos = []
        first_tags = None
        for src_slug in slugs:
            src_data, src_path = load_metadata(src_slug)
            if src_data is None:
                continue
            if first_tags is None:
                first_tags = src_data.get("tags", ["photoblog"])
            for i, photo in enumerate(src_data.get("photos", [])):
                if not photo.get("deleted"):
                    all_photos.append((src_slug, i, photo))

        if not all_photos:
            return {"error": "no non-deleted photos found in source posts"}

        # Create new photos with copied web images
        new_photos = []
        for seq, (src_slug, orig_idx, photo) in enumerate(all_photos):
            nn = f"{seq + 1:02d}"
            new_web_name = f"{date}_{slug_name}_{nn}.jpg"
            new_web_rel = f"files/photoblog/{new_web_name}"

            # Copy the web image
            src_web = BLOG_DIR / photo["web"]
            dst_web = BLOG_DIR / new_web_rel
            if src_web.exists():
                dst_web.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src_web), str(dst_web))

            new_photo = dict(photo)
            new_photo["web"] = new_web_rel
            new_photos.append(new_photo)

        # Build new metadata
        title = slug_name.replace("_", " ").title()
        new_data = {
            "title": title,
            "date": date,
            "slug": new_slug,
            "caption": caption,
            "tags": first_tags or ["photoblog"],
            "photos": new_photos,
            "thumbnail": new_photos[0]["web"] if new_photos else "",
        }

        new_path = METADATA_DIR / f"{new_slug}.json"
        save_metadata(new_data, new_path)
        regenerate_markdown(new_slug)

        # Soft-delete all photos in source posts
        for src_slug in slugs:
            src_data, src_path = load_metadata(src_slug)
            if src_data is None:
                continue
            for photo in src_data.get("photos", []):
                photo["deleted"] = True
            # If all photos deleted, mark post deleted
            if all(p.get("deleted") for p in src_data.get("photos", [])):
                src_data["deleted"] = True
            save_metadata(src_data, src_path)
            regenerate_markdown(src_slug)

        rebuild_site()
        return {"ok": True, "slug": new_slug}

    def handle_split(self, body):
        """Split selected photos from a source post into a new post."""
        source_slug = body["source_slug"]
        photo_indices = body["photo_indices"]
        date = body["date"]
        slug_name = body["slug_name"]
        caption = body.get("caption", "")

        date_part = date.replace("-", "")
        new_slug = f"{date_part}_{slug_name}"

        src_data, src_path = load_metadata(source_slug)
        if src_data is None:
            return {"error": f"source metadata not found: {source_slug}"}

        # Map non-deleted indices to actual indices
        actual_indices = []
        for ni in photo_indices:
            actual = non_deleted_to_actual_index(src_data.get("photos", []), ni)
            if actual is not None:
                actual_indices.append(actual)

        if not actual_indices:
            return {"error": "no valid photo indices"}

        # Create new photos with copied web images
        new_photos = []
        for seq, actual_idx in enumerate(actual_indices):
            photo = src_data["photos"][actual_idx]
            nn = f"{seq + 1:02d}"
            new_web_name = f"{date}_{slug_name}_{nn}.jpg"
            new_web_rel = f"files/photoblog/{new_web_name}"

            src_web = BLOG_DIR / photo["web"]
            dst_web = BLOG_DIR / new_web_rel
            if src_web.exists():
                dst_web.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src_web), str(dst_web))

            new_photo = dict(photo)
            new_photo["web"] = new_web_rel
            new_photos.append(new_photo)

        # Build new metadata
        title = slug_name.replace("_", " ").title()
        new_data = {
            "title": title,
            "date": date,
            "slug": new_slug,
            "caption": caption,
            "tags": src_data.get("tags", ["photoblog"]),
            "photos": new_photos,
            "thumbnail": new_photos[0]["web"] if new_photos else "",
        }

        new_path = METADATA_DIR / f"{new_slug}.json"
        save_metadata(new_data, new_path)
        regenerate_markdown(new_slug)

        # Mark split photos as deleted in source
        for actual_idx in actual_indices:
            src_data["photos"][actual_idx]["deleted"] = True

        # If all photos in source are deleted, mark post deleted
        if all(p.get("deleted") for p in src_data.get("photos", [])):
            src_data["deleted"] = True

        save_metadata(src_data, src_path)
        regenerate_markdown(source_slug)

        rebuild_site()
        return {"ok": True, "slug": new_slug}

    def handle_delete(self, body):
        """Delete whole posts or specific photos."""
        slugs = body["slugs"]
        photo_indices = body.get("photo_indices")

        for slug in slugs:
            data, path = load_metadata(slug)
            if data is None:
                continue

            if photo_indices is None:
                # Delete entire post
                data["deleted"] = True
                for photo in data.get("photos", []):
                    photo["deleted"] = True
            else:
                # Delete specific photos by non-deleted index
                for ni in photo_indices:
                    actual = non_deleted_to_actual_index(data.get("photos", []), ni)
                    if actual is not None:
                        data["photos"][actual]["deleted"] = True
                # If all photos deleted, mark post deleted
                if all(p.get("deleted") for p in data.get("photos", [])):
                    data["deleted"] = True

            save_metadata(data, path)
            regenerate_markdown(slug)

        rebuild_site()
        return {"ok": True}

    def handle_restore(self, body):
        """Restore deleted posts or specific photos."""
        slugs = body["slugs"]
        photo_indices = body.get("photo_indices")

        for slug in slugs:
            data, path = load_metadata(slug)
            if data is None:
                continue

            if photo_indices is None:
                # Restore entire post and all its photos
                data.pop("deleted", None)
                for photo in data.get("photos", []):
                    photo.pop("deleted", None)
            else:
                # Restore specific photos by index into full array
                # (for restore, indices refer to the full array since
                # deleted photos are what we're targeting)
                for ni in photo_indices:
                    if 0 <= ni < len(data.get("photos", [])):
                        data["photos"][ni].pop("deleted", None)
                # If any photo is restored, restore the post too
                if any(not p.get("deleted") for p in data.get("photos", [])):
                    data.pop("deleted", None)

            save_metadata(data, path)
            regenerate_markdown(slug)

        rebuild_site()
        return {"ok": True}

    def handle_purge(self, body):
        """Permanently remove posts: web images, thumbnails, metadata, markdown, site dir."""
        slugs = body["slugs"]

        for slug in slugs:
            data, path = load_metadata(slug)

            if data is not None:
                # Remove web images and thumbnails
                for photo in data.get("photos", []):
                    web_rel = photo.get("web", "")
                    if web_rel:
                        web_path = BLOG_DIR / web_rel
                        if web_path.exists():
                            web_path.unlink()
                        # Thumbnail: same stem as web image, .png in thumbs dir
                        thumb_name = Path(web_rel).stem + ".png"
                        thumb_path = THUMB_DIR / thumb_name
                        if thumb_path.exists():
                            thumb_path.unlink()

                # Remove metadata JSON
                if path.exists():
                    path.unlink()

            # Remove markdown post
            md_path = POSTS_DIR / f"{slug}.md"
            if md_path.exists():
                md_path.unlink()

            # Remove _site directory for this post
            url_slug = slug[:8] + "-" + slug[9:].replace("_", "-")
            site_post_dir = SITE_DIR / url_slug
            if site_post_dir.exists():
                shutil.rmtree(str(site_post_dir))

        rebuild_site()
        return {"ok": True}

    def handle_trash(self):
        """Return all deleted posts."""
        deleted_posts = []
        for jf in sorted(METADATA_DIR.glob("*.json")):
            data = json.loads(jf.read_text(encoding="utf-8"))
            if not data.get("deleted"):
                continue
            non_deleted = [p for p in data.get("photos", []) if not p.get("deleted")]
            all_photos = data.get("photos", [])
            # Find a thumbnail: prefer first non-deleted, fallback to first photo
            thumb = ""
            if non_deleted:
                thumb = non_deleted[0].get("web", "")
            elif all_photos:
                thumb = all_photos[0].get("web", "")
            # Check for a .png thumbnail in thumbs dir
            if thumb:
                thumb_name = Path(thumb).stem + ".png"
                thumb_rel = f"files/thumbs/{thumb_name}"
                if (BLOG_DIR / thumb_rel).exists():
                    thumb = thumb_rel

            deleted_posts.append({
                "slug": data.get("slug", jf.stem),
                "title": data.get("title", "Untitled"),
                "date": data.get("date", ""),
                "thumbnail": thumb,
                "photo_count": len(all_photos),
            })
        return deleted_posts

    def log_message(self, format, *args):
        """Quieter logging: skip 200/304 for static assets."""
        if len(args) >= 2:
            code = str(args[1])
            if code in ("200", "304") and not str(args[0]).startswith("POST"):
                return
        super().log_message(format, *args)


def main():
    host = "localhost"
    port = 8000

    print(f"Building site first...")
    rebuild_site()

    print(f"Starting editor server at http://{host}:{port}")
    print(f"Serving from: {SITE_DIR}")
    print(f"Press Ctrl+C to stop.\n")

    server = HTTPServer((host, port), EditorHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
