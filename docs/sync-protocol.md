# Editor Sync Protocol

Three interfaces exist for the photoblog. They share data and operations but have separate codebases.

## The Three Interfaces

### 1. Viewer (`_site/` via `build.py`)
The public website. Read-only. Generated HTML from markdown posts.

### 2. Local Editor (`scripts/editor.py` + `static/editor.js`)
Desktop editing. Python HTTP server serving the built site with injected JS/CSS controls.

### 3. Photo Editor PWA (`photo-editor/`)
Mobile editing. Standalone PWA that talks directly to the GitHub API.

## Shared Data Layer

All three interfaces read/write the same data:

```
metadata/*.json     -- Single source of truth for post content
posts/*.md          -- Generated from metadata JSON (never edit directly)
files/photoblog/    -- Web-optimized images (1200x1600 max, JPEG quality 85)
files/thumbs/       -- Grid thumbnails (80px height, PNG)
```

### Data flow

```
metadata JSON  -->  markdown post  -->  HTML page (viewer)
     ^                   ^
     |                   |
  editor.py          build.py
  photo-editor PWA
```

## Shared Operations

Both editors implement these operations identically:

| Operation | Input | Effect on Data |
|-----------|-------|----------------|
| Edit caption | slug, caption, photo_index? | Update JSON, regenerate markdown |
| Merge | slugs[], date, slug_name, caption | New JSON + images, soft-delete sources |
| Split | source_slug, indices[], date, slug_name, caption | New JSON + copied images, soft-delete in source |
| Delete | slugs[], photo_indices? | Set `deleted: true` in JSON, regenerate markdown |
| Restore | slugs[] | Remove `deleted` flag, regenerate markdown |
| Purge | slugs[] | Delete JSON, markdown, images, thumbnails |
| Add post | date, slug, title, caption, tags, images | Resize images, create JSON + markdown + thumbnails |

## Keeping Editors in Sync

### When changing an operation's logic

If you change how an operation works (e.g., merge behavior), update it in both places:

| Logic | Local Editor | PWA |
|-------|-------------|-----|
| Caption update | `editor.py:handle_caption` | `posts.js:updateCaption` |
| Merge | `editor.py:handle_merge` | `posts.js:mergePosts` |
| Split | `editor.py:handle_split` | `posts.js:splitPhotos` |
| Delete | `editor.py:handle_delete` | `posts.js:deletePosts` |
| Restore | `editor.py:handle_restore` | `posts.js:restorePosts` |
| Purge | `editor.py:handle_purge` | `posts.js:purgePosts` |
| Add post | `editor.py:handle_add` | `posts.js:addPost` |

### When changing metadata JSON format

If you add/remove/rename fields in the metadata JSON:

1. Update `process_photos.py` (creates JSON for new photos)
2. Update `editor.py` (reads/writes JSON)
3. Update `photo-editor/js/posts.js` (reads/writes JSON)
4. Update `photo-editor/js/markdown.js` (reads JSON to generate markdown)
5. Update `build.py` if the viewer needs the new field

### When changing markdown generation

The markdown is generated from JSON in two places:

| Generator | File |
|-----------|------|
| Python | `process_photos.py:generate_markdown_from_json` |
| JavaScript | `photo-editor/js/markdown.js:generateMarkdown` |

These must produce identical output. The format is:
- YAML frontmatter with `tags` and `thumbnail`
- `# Title` heading
- Post caption (if any)
- For each non-deleted photo: `![alt](web)`, caption (italic if short), EXIF block
- EXIF format: `**Camera:**`, `**Lens:**`, `**Settings:** focal | aperture | shutter | ISO`
- Lines joined with `  \n` (two spaces + newline for markdown line breaks)

### When changing image processing

Image specs must match across:

| Spec | Python (`process_photos.py`) | JS (`photo-editor/js/images.js`) |
|------|-----|-----|
| Max dimensions | 1200 x 1600 | 1200 x 1600 |
| JPEG quality | 85 | 0.85 |
| Thumbnail height | 80px | 80px |
| Thumbnail format | PNG | PNG |
| EXIF orientation | Applied before resize | Applied by createImageBitmap |

### When changing the viewer

Changes to templates, CSS, or build logic only affect `build.py` and `templates/`. Neither editor needs updating unless the change affects how metadata is read.

## Keeping Viewer and Editors in Sync

The viewer and editors share:

| Shared concern | Viewer | Local Editor | PWA |
|---------------|--------|-------------|-----|
| Post listing | `build.py` reads `posts/` | `editor.py` serves `_site/` | `posts.js` reads `metadata/` via API |
| Thumbnail display | `build.py` generates grid HTML | `editor.js` uses built grid | `app.js` loads from raw.githubusercontent.com |
| Tag filtering | `build.py` generates tag pages | `editor.js` uses built sidebar | `tags.js` reads from metadata |
| Deleted post handling | `build.py` excludes deleted | `editor.js` toggles display | `app.js` toggles display |

If you add a new viewer feature (e.g., new tag hierarchy, new page type), it only needs editor support if users should be able to create/edit that feature from the editor.

## Checklist for Changes

Before committing changes to any editor:

- [ ] Does the operation produce the same JSON output as the other editor?
- [ ] Does markdown generation match between Python and JavaScript?
- [ ] Are image processing specs (dimensions, quality, format) consistent?
- [ ] If a new metadata field was added, is it handled in both editors?
- [ ] Does `build.py` need to know about the change?
