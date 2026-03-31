# Photoblog

A static photo blog built with Python. Instagram-style grid and feed views with image carousels.

**Live site:** https://k1monfared.github.io/photoblog

## Project structure

```
posts/              Markdown posts (auto-generated from metadata JSON)
metadata/           Post metadata JSON (single source of truth)
files/photoblog/    Processed web images (max 1200x1600, JPEG)
files/thumbs/       Grid thumbnails (80px height, PNG)
original_photos/    Drop new photos here (see naming convention below)
templates/          HTML templates (base, post, index, tag)
static/             CSS and JavaScript
scripts/            Build and processing scripts
comments/           Comment data (YAML)
_site/              Generated HTML output (not committed)
docs/plans/         Design documents
```

## Adding new photos

### 1. Name your files

Files in `original_photos/` must follow this naming convention:

```
YYYY_MM_DD_title_words_NN.ext
```

- `YYYY_MM_DD` = date (e.g., `2024_02_24`)
- `title_words` = post title, underscore-separated (e.g., `beach_days`)
- `NN` = image order within post (e.g., `01`, `02`, `03`)
- `ext` = image format (`jpg`, `jpeg`, `png`, `tiff`, `webp`)

Photos sharing the same prefix (everything except `_NN`) are grouped into one post.

**Examples:**
- `2024_02_24_beach_days_01.jpg` + `_02.jpg` + `_03.jpg` = one post with 3 images
- `2024_02_24_sunset_01.jpg` = one post with 1 image
- Files not matching the pattern are skipped with a warning

### 2. Commit (auto-processing)

```bash
git commit -m "Add new photos"
```

The pre-commit hook runs `scripts/process_photos.py` which:
- Groups photos by filename prefix
- Resizes images to web size (max 1200x1600)
- Extracts EXIF data (camera, lens, settings)
- Creates metadata JSON with blank captions
- Generates markdown posts from JSON
- Stages all generated files
- Aborts the commit so you can review

### 3. Fill in captions

Edit the metadata JSON files in `metadata/`. Each file has:

```json
{
  "title": "Beach Days",
  "caption": "Post-level body text goes here.",
  "tags": ["photoblog"],
  "photos": [
    {
      "caption": "Per-image caption here",
      ...
    }
  ]
}
```

- `title`: Display title (editable without renaming files)
- `caption` (top level): Body text for the whole post
- `caption` (per photo): Figure caption for that image
- `tags`: Comma-separated tags

### 4. Commit again

```bash
git commit -m "Add new photos"
```

This time the hook detects no new photos, regenerates markdown from your edited JSON, and the commit succeeds. Push to deploy.

## Editing existing posts

Edit the metadata JSON file in `metadata/`. Change title, captions, or tags. On next commit, the markdown is automatically regenerated.

**Never edit markdown files directly.** They are always generated from JSON.

## Removing photos

Delete the original file from `original_photos/`. On next commit, the pre-commit hook detects the missing file and:
- Removes the photo from the post's JSON and markdown
- Deletes the web image and thumbnail
- If it was the last photo in the post, deletes the entire post

**Note:** This only works for photos added via the new pipeline (files matching the naming convention). Legacy photos from the original migration are not tracked in `original_photos/`.

## Building locally

```bash
pip install -r requirements.txt
python scripts/build.py --local --force
```

The site is generated in `_site/`. Open `_site/index.html` in a browser.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/build.py` | Build the static site from posts |
| `scripts/process_photos.py` | Process new photos, detect deletions, regenerate markdown |
| `scripts/migrate_existing.py` | One-time migration from old blog format (already run) |
