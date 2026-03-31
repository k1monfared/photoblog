#!/usr/bin/env python3
"""Photo processing pipeline: resize, strip EXIF, generate posts from originals.

Filename convention for original_photos/:
    YYYY_MM_DD_title_words_NN.ext
    - First 3 parts: date (YYYY, MM, DD)
    - Last part before extension: sequence number (01, 02, ...)
    - Middle parts: title words (joined with spaces, title-cased)
    - Files not matching this pattern are skipped

Photos sharing the same prefix (everything except _NN) are grouped into one post.
Metadata JSON is the single source of truth. Markdown is always generated from it.
"""

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ExifTags

BLOG_DIR = Path(__file__).parent.parent
ORIGINAL_DIR = BLOG_DIR / "original_photos"
WEB_DIR = BLOG_DIR / "files" / "photoblog"
THUMB_DIR = BLOG_DIR / "files" / "thumbs"
METADATA_DIR = BLOG_DIR / "metadata"
POSTS_DIR = BLOG_DIR / "posts"

MAX_WIDTH = 1200
MAX_HEIGHT = 1600
JPEG_QUALITY = 85

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}

# Filename pattern: YYYY_MM_DD_title_words_NN.ext
FILENAME_RE = re.compile(
    r"^(\d{4})_(\d{2})_(\d{2})_(.+)_(\d+)\.[a-zA-Z]+$"
)


def resize_image(src, dst):
    """Resize image to fit within bounding box, strip EXIF, save as JPEG."""
    with Image.open(src) as img:
        try:
            exif = img.getexif()
            orientation = exif.get(274)
            if orientation == 3:
                img = img.rotate(180, expand=True)
            elif orientation == 6:
                img = img.rotate(270, expand=True)
            elif orientation == 8:
                img = img.rotate(90, expand=True)
        except Exception:
            pass

        w, h = img.size
        if w > MAX_WIDTH or h > MAX_HEIGHT:
            ratio = min(MAX_WIDTH / w, MAX_HEIGHT / h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        if img.mode != "RGB":
            img = img.convert("RGB")

        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst, "JPEG", quality=JPEG_QUALITY, optimize=True)


def read_exif(src):
    """Extract useful EXIF data from an image file."""
    exif_data = {}
    try:
        with Image.open(src) as img:
            raw_exif = img.getexif()
            if not raw_exif:
                return exif_data

            tag_names = {v: k for k, v in ExifTags.TAGS.items()}

            date_taken = raw_exif.get(tag_names.get("DateTimeOriginal", 36867))
            if not date_taken:
                date_taken = raw_exif.get(tag_names.get("DateTime", 306))
            if date_taken:
                exif_data["date_taken"] = str(date_taken)

            model = raw_exif.get(tag_names.get("Model", 272))
            if model:
                exif_data["camera"] = str(model).strip()

            try:
                ifd = raw_exif.get_ifd(0x8769)
                if ifd:
                    if 33437 in ifd:
                        exif_data["aperture"] = f"f/{float(ifd[33437]):.1f}"
                    if 33434 in ifd:
                        et = ifd[33434]
                        if hasattr(et, "numerator") and et.numerator and et.denominator:
                            if et.numerator == 1:
                                exif_data["shutter_speed"] = f"1/{et.denominator}s"
                            else:
                                exif_data["shutter_speed"] = f"{float(et):.4f}s"
                        else:
                            exif_data["shutter_speed"] = f"{float(et)}s"
                    if 34855 in ifd:
                        exif_data["iso"] = int(ifd[34855])
                    if 37386 in ifd:
                        exif_data["focal_length"] = f"{float(ifd[37386]):.0f}mm"
                    if 42036 in ifd:
                        exif_data["lens"] = str(ifd[42036]).strip()
            except Exception:
                pass
    except Exception:
        pass
    return exif_data


def parse_original_filename(filename):
    """Parse YYYY_MM_DD_title_words_NN.ext into components.

    Returns (date_str, slug_parts, seq_num) or None if invalid.
    date_str: "YYYYMMDD"
    slug_parts: "title_words" (the middle parts joined)
    seq_num: "01", "02", etc.
    """
    m = FILENAME_RE.match(filename)
    if not m:
        return None
    year, month, day, title_slug, seq = m.groups()
    date_str = f"{year}{month}{day}"
    return date_str, title_slug, seq


def group_key(filename):
    """Extract the grouping key (everything except sequence number) from filename."""
    parsed = parse_original_filename(filename)
    if not parsed:
        return None
    date_str, title_slug, _ = parsed
    return f"{date_str}_{title_slug}"


def generate_markdown_from_json(json_path):
    """Generate a markdown post file from a metadata JSON file."""
    data = json.loads(json_path.read_text(encoding="utf-8"))
    title = data.get("title", data.get("date", "Untitled"))
    tags = ", ".join(data.get("tags", ["photoblog"]))
    photos = data.get("photos", [])
    if not photos:
        return None

    thumbnail = photos[0].get("web", "")
    post_caption = data.get("caption", "")

    lines = [
        "---",
        f"tags: {tags}",
        f"thumbnail: {thumbnail}",
        "---",
        "",
        f"# {title}",
        "",
    ]

    if post_caption:
        lines.append(post_caption)
        lines.append("")

    for photo in photos:
        web = photo.get("web", "")
        alt = photo.get("alt", title)
        caption = photo.get("caption", "")
        exif = photo.get("exif", {})

        lines.append(f"![{alt}]({web})")
        lines.append("")

        # Caption rendering: short = italic, long = paragraph
        if caption:
            if "\n" not in caption and len(caption) < 120:
                lines.append(f"*{caption}*")
            else:
                lines.append(caption)
            lines.append("")

        # EXIF info
        if exif:
            parts = []
            if "camera" in exif:
                parts.append(f"**Camera:** {exif['camera']}")
            if "lens" in exif:
                parts.append(f"**Lens:** {exif['lens']}")
            settings = []
            if "focal_length" in exif:
                settings.append(exif["focal_length"])
            if "aperture" in exif:
                settings.append(exif["aperture"])
            if "shutter_speed" in exif:
                settings.append(exif["shutter_speed"])
            if "iso" in exif:
                settings.append(f"ISO {exif['iso']}")
            if settings:
                parts.append(f"**Settings:** {' | '.join(settings)}")
            if parts:
                lines.extend(parts)
                lines.append("")

    return "\n".join(lines) + "\n"


def process_new():
    """Scan original_photos/ for new images, group by prefix, create/update posts.

    Also detects deleted originals and cleans up metadata/posts.
    Also regenerates markdown for any JSON that was edited.
    """
    if not ORIGINAL_DIR.exists():
        print("No original_photos/ directory found. Place images there and re-run.")
        return

    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    # --- Phase 1: Detect and remove deleted originals ---
    removed = 0
    for jf in sorted(METADATA_DIR.glob("*.json")):
        data = json.loads(jf.read_text(encoding="utf-8"))
        photos = data.get("photos", [])
        remaining = []
        for photo in photos:
            orig = photo.get("original", "")
            if orig and not (ORIGINAL_DIR / orig).exists():
                # Original is gone, clean up
                web_path = BLOG_DIR / photo.get("web", "")
                if web_path.exists():
                    web_path.unlink()
                thumb_stem = Path(photo.get("web", "")).stem
                thumb_path = THUMB_DIR / f"{thumb_stem}.png"
                if thumb_path.exists():
                    thumb_path.unlink()
                removed += 1
            else:
                remaining.append(photo)

        if not remaining:
            # No photos left, remove the post entirely
            slug = data.get("slug", jf.stem)
            md_path = POSTS_DIR / f"{slug}.md"
            if md_path.exists():
                md_path.unlink()
            jf.unlink()
        elif len(remaining) != len(photos):
            # Some photos removed, update JSON and regenerate markdown
            data["photos"] = remaining
            if remaining:
                data["thumbnail"] = remaining[0].get("web", "")
            jf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                          encoding="utf-8")
            slug = data.get("slug", jf.stem)
            md_path = POSTS_DIR / f"{slug}.md"
            md_content = generate_markdown_from_json(jf)
            if md_content:
                md_path.write_text(md_content, encoding="utf-8")

    if removed:
        print(f"Removed {removed} deleted photo(s) from posts")

    # --- Phase 2: Collect already-tracked originals ---
    tracked = set()
    for jf in METADATA_DIR.glob("*.json"):
        data = json.loads(jf.read_text(encoding="utf-8"))
        for photo in data.get("photos", []):
            tracked.add(photo.get("original", ""))

    # --- Phase 3: Find and group new images ---
    new_by_group = {}
    skipped = []
    for f in sorted(ORIGINAL_DIR.iterdir()):
        if f.suffix.lower() not in IMAGE_EXTS:
            continue
        if f.name in tracked:
            continue
        parsed = parse_original_filename(f.name)
        if not parsed:
            skipped.append(f.name)
            continue
        key = group_key(f.name)
        new_by_group.setdefault(key, []).append(f)

    if skipped:
        print(f"Skipped {len(skipped)} file(s) not matching naming convention:")
        for s in skipped[:5]:
            print(f"  {s}")
        if len(skipped) > 5:
            print(f"  ... and {len(skipped) - 5} more")

    # --- Phase 4: Process new images, create/update posts ---
    processed = 0
    for key, images in sorted(new_by_group.items()):
        # Parse the group key to get date and slug
        parsed = parse_original_filename(images[0].name)
        if not parsed:
            continue
        date_str, title_slug, _ = parsed
        slug = f"{date_str}_{title_slug}"
        date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        title_words = title_slug.replace("_", " ").title()

        json_path = METADATA_DIR / f"{slug}.json"

        # Load existing metadata or create new
        if json_path.exists():
            data = json.loads(json_path.read_text(encoding="utf-8"))
        else:
            data = {
                "title": title_words,
                "date": date_formatted,
                "slug": slug,
                "caption": "",
                "tags": ["photoblog"],
                "photos": [],
            }

        # Sort images by sequence number
        images.sort(key=lambda f: parse_original_filename(f.name)[2])

        for img_path in images:
            p = parse_original_filename(img_path.name)
            if not p:
                continue
            _, _, seq = p
            web_name = f"{date_formatted}_{title_slug}_{seq}.jpg"
            web_rel = f"files/photoblog/{web_name}"

            # Resize
            dst = BLOG_DIR / web_rel
            if not dst.exists():
                resize_image(img_path, dst)

            # Read EXIF
            exif = read_exif(img_path)

            # Add to photos array
            data["photos"].append({
                "web": web_rel,
                "original": img_path.name,
                "alt": data["title"],
                "caption": "",
                "status": "jpeg",
                "exif": exif,
            })
            processed += 1

        # Ensure thumbnail points to first photo
        if data["photos"]:
            data["photos"].sort(
                key=lambda ph: ph.get("original", "")
            )
            data["thumbnail"] = data["photos"][0].get("web", "")

        # Write metadata
        json_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8"
        )

        # Generate markdown
        md_content = generate_markdown_from_json(json_path)
        if md_content:
            md_path = POSTS_DIR / f"{slug}.md"
            md_path.write_text(md_content, encoding="utf-8")

    if processed:
        print(f"Processed {processed} new photo(s), {len(tracked)} already tracked")
    elif not removed:
        print(f"No new photos found. {len(tracked)} already tracked.")

    # --- Phase 5: Regenerate markdown for edited JSON files ---
    regenerated = 0
    for jf in sorted(METADATA_DIR.glob("*.json")):
        data = json.loads(jf.read_text(encoding="utf-8"))
        slug = data.get("slug", jf.stem)
        md_path = POSTS_DIR / f"{slug}.md"

        # Regenerate if JSON is newer than markdown
        if md_path.exists() and jf.stat().st_mtime > md_path.stat().st_mtime:
            md_content = generate_markdown_from_json(jf)
            if md_content:
                md_path.write_text(md_content, encoding="utf-8")
                regenerated += 1

    if regenerated:
        print(f"Regenerated {regenerated} post(s) from edited metadata")


def from_migration():
    """Resize images from original_photos/ using metadata JSON paths."""
    if not METADATA_DIR.exists():
        print("No metadata/ directory found. Run migrate_existing.py first.")
        return

    json_files = sorted(METADATA_DIR.glob("*.json"))
    processed = 0
    skipped = 0
    missing = 0

    for jf in json_files:
        data = json.loads(jf.read_text(encoding="utf-8"))
        for photo in data.get("photos", []):
            status = photo.get("status", "")
            if status not in ("jpeg",):
                continue

            original_name = photo.get("original", "")
            web_path_rel = photo.get("web", "")
            if not original_name or not web_path_rel:
                continue

            src = ORIGINAL_DIR / original_name
            dst = BLOG_DIR / web_path_rel

            if not src.exists():
                missing += 1
                continue

            if dst.exists():
                if dst.stat().st_mtime >= src.stat().st_mtime:
                    skipped += 1
                    continue

            resize_image(src, dst)
            processed += 1

            if not photo.get("exif"):
                exif = read_exif(src)
                if exif:
                    photo["exif"] = exif
                    jf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                                  encoding="utf-8")

    print(f"From-migration: processed {processed}, skipped {skipped}, missing originals {missing}")


def regenerate():
    """Re-downsize from originals where original is newer than web version."""
    if not ORIGINAL_DIR.exists():
        print("No original_photos/ directory found.")
        return

    processed = 0
    skipped = 0

    for src in sorted(ORIGINAL_DIR.iterdir()):
        if src.suffix.lower() not in IMAGE_EXTS:
            continue
        # Find web destination from metadata
        for jf in METADATA_DIR.glob("*.json"):
            data = json.loads(jf.read_text(encoding="utf-8"))
            for photo in data.get("photos", []):
                if photo.get("original") == src.name:
                    dst = BLOG_DIR / photo["web"]
                    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
                        skipped += 1
                    else:
                        resize_image(src, dst)
                        processed += 1
                    break
            else:
                continue
            break

    print(f"Regenerate: processed {processed}, skipped {skipped}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Photo processing pipeline")
    parser.add_argument("--from-migration", action="store_true",
                        help="Resize originals using metadata JSON paths (after migration)")
    parser.add_argument("--regenerate", action="store_true",
                        help="Re-downsize from originals where original is newer")
    args = parser.parse_args()

    if args.from_migration:
        from_migration()
    elif args.regenerate:
        regenerate()
    else:
        process_new()
