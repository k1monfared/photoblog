#!/usr/bin/env python3
"""One-time migration: parse 710 existing posts, create metadata JSON, rename posts and comments."""

import json
import os
import re
import shutil
from pathlib import Path

BLOG_DIR = Path(__file__).parent
METADATA_DIR = BLOG_DIR / "metadata"
PHOTOS_DIR = BLOG_DIR / "files" / "photoblog"
POSTS_DIR = BLOG_DIR / "posts"


def classify_image(path):
    """Return 'jpeg', 'html_with_url', 'dead', or 'missing'."""
    if not path.exists():
        return "missing", None
    with open(path, "rb") as f:
        header = f.read(20)
    if header[:2] == b"\xff\xd8":
        return "jpeg", None
    # HTML file: check for Google image URL
    try:
        text = path.read_text(errors="replace")
    except Exception:
        return "dead", None
    urls = re.findall(r"https://lh3\.googleusercontent\.com/[^\"\s]+", text)
    if urls:
        return "html_with_url", urls[0]
    return "dead", None


def parse_post(filepath):
    """Parse a photoblog post into structured data."""
    raw = filepath.read_text(encoding="utf-8")
    lines = raw.strip().splitlines()

    # Parse frontmatter
    meta = {}
    body_start = 0
    if lines and lines[0].strip() == "---":
        for i, line in enumerate(lines[1:], 1):
            if line.strip() == "---":
                body_start = i + 1
                break
            if ":" in line:
                key, val = line.split(":", 1)
                meta[key.strip().lower()] = val.strip()

    body_lines = lines[body_start:]

    # Extract title from first heading
    title = ""
    title_idx = None
    for i, line in enumerate(body_lines):
        m = re.match(r"^#\s+(.+)$", line.strip())
        if m:
            title = m.group(1).strip()
            title_idx = i
            break

    # Extract image references
    images = []
    image_line_indices = set()
    for i, line in enumerate(body_lines):
        for m in re.finditer(r"!\[([^\]]*)\]\((files/photoblog/[^)]+)\)", line):
            images.append({"alt": m.group(1), "path": m.group(2)})
            image_line_indices.add(i)

    # Extract body text (lines after title and images, excluding camera info)
    caption_lines = []
    camera = None
    lens = None
    settings = None
    for i, line in enumerate(body_lines):
        if i == title_idx:
            continue
        if i in image_line_indices:
            continue
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("**Camera:**"):
            camera = stripped.replace("**Camera:**", "").strip()
        elif stripped.startswith("**Lens:**"):
            lens = stripped.replace("**Lens:**", "").strip()
        elif stripped.startswith("**Settings:**"):
            settings = stripped.replace("**Settings:**", "").strip()
        else:
            caption_lines.append(stripped)

    caption = "\n".join(caption_lines).strip()

    # Parse settings string like "250mm | f/5.6 | 1/160s | ISO 800"
    exif_from_text = {}
    if settings:
        parts = [p.strip() for p in settings.split("|")]
        for p in parts:
            if p.endswith("mm"):
                exif_from_text["focal_length"] = p
            elif p.startswith("f/"):
                exif_from_text["aperture"] = p
            elif p.endswith("s"):
                exif_from_text["shutter_speed"] = p
            elif p.upper().startswith("ISO"):
                try:
                    exif_from_text["iso"] = int(p.split()[-1])
                except ValueError:
                    exif_from_text["iso"] = p
    if camera:
        exif_from_text["camera"] = camera
    if lens:
        exif_from_text["lens"] = lens

    return {
        "title": title,
        "tags": [t.strip().lower() for t in meta.get("tags", "").split(",") if t.strip()],
        "thumbnail": meta.get("thumbnail", ""),
        "images": images,
        "caption": caption,
        "exif_from_text": exif_from_text,
    }


def compute_new_slug(old_stem):
    """Remove _photo suffix from slug. E.g., 20090224_adav_photo -> 20090224_adav"""
    if old_stem.endswith("_photo"):
        return old_stem[:-6]
    return old_stem


def compute_new_image_name(old_image_path, new_slug):
    """Map old image filename to new naming based on post slug.

    Old: files/photoblog/2009-02-24_adav_01.jpg
    New slug: 20090224_adav
    New image: files/photoblog/2009-02-24_adav_01.jpg (same, images already match this pattern)
    """
    # Images already have good names, just return the basename
    return Path(old_image_path).name


def migrate():
    METADATA_DIR.mkdir(parents=True, exist_ok=True)

    md_files = sorted(POSTS_DIR.glob("*_photo.md"))
    print(f"Found {len(md_files)} posts to migrate")

    stats = {"posts": 0, "metadata": 0, "renamed_posts": 0, "renamed_comments": 0,
             "jpeg": 0, "html_with_url": 0, "dead": 0, "missing": 0}
    download_urls = []

    for filepath in md_files:
        old_stem = filepath.stem
        new_slug = compute_new_slug(old_stem)
        data = parse_post(filepath)

        # Clean title: remove " - photo" suffix
        clean_title = data["title"]
        if clean_title.endswith(" - photo"):
            clean_title = clean_title[:-8].strip()

        # Extract date from filename
        date_match = re.match(r"^(\d{4})(\d{2})(\d{2})_", old_stem)
        date_str = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}" if date_match else ""

        # Build photo entries
        photos = []
        for img in data["images"]:
            img_path = BLOG_DIR / img["path"]
            kind, url = classify_image(img_path)
            stats[kind] += 1

            photo_entry = {
                "web": img["path"],
                "original": Path(img["path"]).name,
                "alt": img["alt"],
                "status": kind,
            }
            if url:
                photo_entry["google_url"] = url
                download_urls.append({"file": img["path"], "url": url})
            if data["exif_from_text"]:
                photo_entry["exif"] = data["exif_from_text"]
            else:
                photo_entry["exif"] = {}

            photos.append(photo_entry)

        # Create metadata JSON
        metadata = {
            "title": clean_title,
            "date": date_str,
            "slug": new_slug,
            "caption": data["caption"],
            "tags": data["tags"],
            "photos": photos,
        }

        json_path = METADATA_DIR / f"{new_slug}.json"
        if not json_path.exists():
            json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
                                 encoding="utf-8")
            stats["metadata"] += 1

        # Rename post file (remove _photo suffix)
        new_md_path = POSTS_DIR / f"{new_slug}.md"
        if filepath != new_md_path:
            # Rewrite post content
            new_content = f"---\ntags: {', '.join(data['tags'])}\nthumbnail: {data['thumbnail']}\n---\n\n# {clean_title}\n\n"
            for img in data["images"]:
                new_content += f"![{img['alt']}]({img['path']})\n\n"
            if data["caption"]:
                new_content += data["caption"] + "\n"
            if data["exif_from_text"]:
                parts = []
                if "camera" in data["exif_from_text"]:
                    parts.append(f"**Camera:** {data['exif_from_text']['camera']}")
                if "lens" in data["exif_from_text"]:
                    parts.append(f"**Lens:** {data['exif_from_text']['lens']}")
                settings_parts = []
                for k in ["focal_length", "aperture", "shutter_speed"]:
                    if k in data["exif_from_text"]:
                        settings_parts.append(str(data["exif_from_text"][k]))
                if "iso" in data["exif_from_text"]:
                    settings_parts.append(f"ISO {data['exif_from_text']['iso']}")
                if settings_parts:
                    parts.append(f"**Settings:** {' | '.join(settings_parts)}")
                if parts:
                    new_content += "\n" + "\n\n".join(parts) + "\n"

            new_md_path.write_text(new_content.strip() + "\n", encoding="utf-8")
            filepath.unlink()
            stats["renamed_posts"] += 1

        # Rename comment directory
        old_slug_dashed = old_stem.replace("_", "-")
        new_slug_dashed = new_slug.replace("_", "-")
        old_comment_dir = BLOG_DIR / "comments" / old_slug_dashed
        new_comment_dir = BLOG_DIR / "comments" / new_slug_dashed
        if old_comment_dir.exists() and old_comment_dir != new_comment_dir:
            if not new_comment_dir.exists():
                old_comment_dir.rename(new_comment_dir)
                stats["renamed_comments"] += 1

        stats["posts"] += 1

    print(f"\nMigration complete:")
    print(f"  Posts processed: {stats['posts']}")
    print(f"  Metadata JSONs created: {stats['metadata']}")
    print(f"  Posts renamed: {stats['renamed_posts']}")
    print(f"  Comment dirs renamed: {stats['renamed_comments']}")
    print(f"\nImage status:")
    print(f"  Actual JPEGs: {stats['jpeg']}")
    print(f"  HTML with Google URL: {stats['html_with_url']}")
    print(f"  Dead/error pages: {stats['dead']}")
    print(f"  Missing files: {stats['missing']}")

    if download_urls:
        dl_path = BLOG_DIR / "download_urls.json"
        dl_path.write_text(json.dumps(download_urls, indent=2) + "\n", encoding="utf-8")
        print(f"\n  Saved {len(download_urls)} Google URLs to download_urls.json")
        print(f"  Run: python download_missing.py  (to attempt recovery)")


if __name__ == "__main__":
    migrate()
