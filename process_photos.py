#!/usr/bin/env python3
"""Photo processing pipeline: resize, strip EXIF, generate posts from originals."""

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ExifTags

BLOG_DIR = Path(__file__).parent
ORIGINAL_DIR = BLOG_DIR / "original_photos"
WEB_DIR = BLOG_DIR / "files" / "photoblog"
METADATA_DIR = BLOG_DIR / "metadata"

MAX_WIDTH = 1200
MAX_HEIGHT = 1600
JPEG_QUALITY = 85


def resize_image(src, dst):
    """Resize image to fit within bounding box, strip EXIF, save as JPEG."""
    with Image.open(src) as img:
        # Auto-rotate based on EXIF orientation before stripping
        try:
            exif = img.getexif()
            orientation = exif.get(274)  # 274 = Orientation tag
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
            new_w = int(w * ratio)
            new_h = int(h * ratio)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        # Convert to RGB (strip alpha, handle palette modes)
        if img.mode != "RGB":
            img = img.convert("RGB")

        dst.parent.mkdir(parents=True, exist_ok=True)
        # Save without EXIF (don't pass exif parameter)
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

            # IFD EXIF data (aperture, shutter speed, ISO, focal length, lens)
            try:
                ifd = raw_exif.get_ifd(0x8769)
                if ifd:
                    if 33437 in ifd:  # FNumber
                        fn = ifd[33437]
                        if hasattr(fn, "numerator"):
                            exif_data["aperture"] = f"f/{float(fn):.1f}"
                        else:
                            exif_data["aperture"] = f"f/{float(fn):.1f}"
                    if 33434 in ifd:  # ExposureTime
                        et = ifd[33434]
                        if hasattr(et, "numerator") and et.numerator and et.denominator:
                            if et.numerator == 1:
                                exif_data["shutter_speed"] = f"1/{et.denominator}s"
                            else:
                                exif_data["shutter_speed"] = f"{float(et):.4f}s"
                        else:
                            exif_data["shutter_speed"] = f"{float(et)}s"
                    if 34855 in ifd:  # ISOSpeedRatings
                        exif_data["iso"] = int(ifd[34855])
                    if 37386 in ifd:  # FocalLength
                        fl = ifd[37386]
                        exif_data["focal_length"] = f"{float(fl):.0f}mm"
                    if 42036 in ifd:  # LensModel
                        exif_data["lens"] = str(ifd[42036]).strip()
            except Exception:
                pass

    except Exception:
        pass
    return exif_data


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
                # Only overwrite if original is newer
                if dst.stat().st_mtime >= src.stat().st_mtime:
                    skipped += 1
                    continue

            resize_image(src, dst)
            processed += 1

            # Update EXIF in metadata if empty
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
        if not src.suffix.lower() in (".jpg", ".jpeg", ".png", ".tiff"):
            continue
        dst = WEB_DIR / src.name
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        resize_image(src, dst)
        processed += 1

    print(f"Regenerate: processed {processed}, skipped {skipped}")


def process_new():
    """Scan original_photos/ for images not yet in any metadata, create posts."""
    if not ORIGINAL_DIR.exists():
        print("No original_photos/ directory found. Place images there and re-run.")
        return

    METADATA_DIR.mkdir(parents=True, exist_ok=True)

    # Collect all originals already tracked
    tracked = set()
    for jf in METADATA_DIR.glob("*.json"):
        data = json.loads(jf.read_text(encoding="utf-8"))
        for photo in data.get("photos", []):
            tracked.add(photo.get("original", ""))

    # Find untracked images
    new_images = []
    for f in sorted(ORIGINAL_DIR.iterdir()):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png", ".tiff"):
            continue
        if f.name in tracked:
            continue
        new_images.append(f)

    if not new_images:
        print(f"No new photos found. {len(tracked)} already tracked.")
        return

    # Group by date
    date_groups = {}
    for img_path in new_images:
        exif = read_exif(img_path)
        date_str = None
        if "date_taken" in exif:
            try:
                dt = datetime.strptime(exif["date_taken"][:10], "%Y:%m:%d")
                date_str = dt.strftime("%Y%m%d")
            except ValueError:
                pass
        if not date_str:
            mtime = datetime.fromtimestamp(img_path.stat().st_mtime)
            date_str = mtime.strftime("%Y%m%d")

        date_groups.setdefault(date_str, []).append((img_path, exif))

    processed = 0
    for date_str, images in sorted(date_groups.items()):
        # Find existing sequence numbers for this date
        existing_seqs = set()
        for jf in METADATA_DIR.glob(f"{date_str}_*.json"):
            m = re.match(rf"^{date_str}_(\d+)$", jf.stem)
            if m:
                existing_seqs.add(int(m.group(1)))

        seq = max(existing_seqs, default=0) + 1

        for img_path, exif in images:
            slug = f"{date_str}_{seq:02d}"
            date_formatted = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
            web_name = f"{date_formatted}_{seq:02d}_01.jpg"
            web_rel = f"files/photoblog/{web_name}"

            # Resize
            dst = BLOG_DIR / web_rel
            resize_image(img_path, dst)

            # Create metadata
            metadata = {
                "title": date_formatted,
                "date": date_formatted,
                "slug": slug,
                "caption": "",
                "tags": ["photoblog"],
                "photos": [{
                    "web": web_rel,
                    "original": img_path.name,
                    "alt": date_formatted,
                    "status": "jpeg",
                    "exif": exif,
                }],
            }
            json_path = METADATA_DIR / f"{slug}.json"
            json_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
                                 encoding="utf-8")

            # Create post
            md_content = f"---\ntags: photoblog\nthumbnail: {web_rel}\n---\n\n# {date_formatted}\n\n![{date_formatted}]({web_rel})\n"
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
                    md_content += "\n" + "\n\n".join(parts) + "\n"

            md_path = BLOG_DIR / f"{slug}.md"
            if not md_path.exists():
                md_path.write_text(md_content, encoding="utf-8")

            seq += 1
            processed += 1

    print(f"Processed {processed} new photos, {len(tracked)} already tracked")


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
