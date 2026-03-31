# Design: Photo-to-Post Pipeline

## Context

The photoblog needs a streamlined workflow for adding new photos. Currently `process_photos.py` creates one post per photo with no grouping, no captions, and generic date-based titles. The user wants to drop photos in `original_photos/`, have them automatically grouped into posts (including multi-image posts), and be able to fill in captions before publishing. Deleting a photo should auto-update or remove its post.

## Filename Convention

The filename IS the structured data. Format: `YYYY_MM_DD_title_words_NN.ext`

Parsing (split by `_`):
- First 3 parts = date: `YYYY`, `MM`, `DD`
- Last part (before extension) = sequence number: `01`, `02`, etc.
- Middle parts = title words, joined with spaces and title-cased
- Files not matching this pattern are **skipped** with a warning

Grouping: files sharing the same `YYYY_MM_DD_title_words` prefix (everything except the sequence number) belong to the same post.

Examples:
- `2024_02_24_beach_days_01.jpeg` + `_02.jpeg` + `_03.jpeg` → one post, 3 images
- `2024_02_24_sunset_01.jpeg` → solo post

## Source of Truth

**Metadata JSON** is the single source of truth for all post content. Markdown is always auto-generated from JSON. Never hand-edit markdown.

## JSON Schema

```json
{
  "title": "Beach Days",
  "date": "2024-02-24",
  "slug": "20240224_beach_days",
  "caption": "Post-level body text goes here.",
  "tags": ["photoblog"],
  "photos": [
    {
      "web": "files/photoblog/2024-02-24_beach_days_01.jpg",
      "original": "2024_02_24_beach_days_01.jpeg",
      "alt": "Beach Days",
      "caption": "Per-image caption here",
      "status": "jpeg",
      "exif": { "date_taken": "...", "camera": "...", ... }
    }
  ]
}
```

Key points:
- `title` is editable in JSON without affecting filenames
- `slug` is permanent (derived from filename, never changes)
- `caption` at post level = body text for the whole post
- `caption` per photo = figure caption for that image
- `exif.date_taken` is informational only, not used for naming or ordering

## Title Independence from Filenames

- Filename slug (`beach_days`) is a permanent identifier used for file paths
- JSON `title` field is the display name, freely editable
- Changing title in JSON only regenerates the markdown. No files are renamed.

## Markdown Generation

Generated from JSON, never hand-edited. Format:

```markdown
---
tags: photoblog
thumbnail: files/photoblog/2024-02-24_beach_days_01.jpg
---

# Beach Days

Post-level body text goes here.

![Beach Days](files/photoblog/2024-02-24_beach_days_01.jpg)

*Per-image caption here*

**Camera:** Canon EOS M50
**Settings:** 50mm | f/5.6 | 1/320s | ISO 200

![Beach Days](files/photoblog/2024-02-24_beach_days_02.jpg)
```

Caption rendering:
- Short captions (one sentence, no newlines) → `*italic*` figure caption
- Longer captions (multiple sentences/paragraphs) → regular paragraph text
- Empty captions → nothing rendered

## Workflow

1. Drop photos in `original_photos/` following naming convention
2. `git commit` → pre-commit hook runs `process_photos.py`
3. Script: groups by prefix, resizes, extracts EXIF, creates JSON (blank captions), generates markdown
4. Hook stages files, aborts commit: "Review and re-commit"
5. Edit JSON files: fill in title, captions, tags
6. `git commit` again → hook detects no new photos, regenerates markdown from edited JSON, commit succeeds

## Deletion (auto-detected every run)

Every run of `process_photos.py`:
1. Scan all metadata JSON `photos[].original` entries
2. Check if each original still exists in `original_photos/`
3. If missing: remove that photo entry from JSON, delete web image and thumbnail
4. If JSON has no photos left: delete the JSON and the markdown post
5. If JSON still has photos: regenerate the markdown

## Markdown Regeneration

On every run, for each JSON file:
- If JSON mtime > markdown mtime, regenerate markdown from JSON
- This catches both new posts and caption edits

## Pre-commit Hook

```bash
#!/bin/bash
output=$(python process_photos.py 2>&1)
if echo "$output" | grep -qE "Processed [1-9]|Removed [1-9]|Regenerated [1-9]"; then
    echo "$output"
    git add metadata/ files/photoblog/ files/thumbs/ posts/*.md
    echo "Photos updated and staged. Review then re-commit."
    exit 1
fi
```

## Migration Script (one-time)

Rename existing originals (if present) to match the convention. Use metadata JSON to map:
- `original` field → current filename
- `date` + `slug` + photo index → new filename

This creates consistent naming: `original_photos/2024_02_24_beach_days_01.jpeg` → `files/photoblog/2024-02-24_beach_days_01.jpg` → `files/thumbs/2024-02-24_beach_days_01.png`

## Files to Modify

| File | Change |
|------|--------|
| `process_photos.py` | Rewrite `process_new()`: filename parsing, prefix grouping, per-image captions, deletion detection, markdown regeneration from JSON |
| `.githooks/pre-commit` | Update grep pattern to catch Removed/Regenerated messages, add thumbs staging |
| `build.py` | Update to read per-image captions from content (already works with current markdown format) |

## Backward Compatibility

- Existing 710 posts and metadata are untouched
- Missing `caption` field per photo defaults to `""`
- Markdown regeneration only runs when JSON is newer than markdown

## Verification

1. Drop test photos with naming convention in `original_photos/`
2. Run `python process_photos.py` and verify JSON + markdown creation
3. Edit JSON captions, run again, verify markdown updates
4. Delete a photo from `original_photos/`, run again, verify cleanup
5. Run `python build.py --local --force` and verify site builds correctly
6. Test pre-commit hook end-to-end
