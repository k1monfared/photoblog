# Local Editor Interface Design

## Problem

Editing post captions, merging posts, splitting photos, and deleting posts currently requires manual JSON editing and command-line rebuilds. Need a visual editing interface that runs locally alongside the existing photoblog.

## Architecture

**Same site + local API server.** The existing static site pages get editing controls injected when served through a local Python dev server. A small API handles mutations (saves to metadata JSON, regenerates markdown, triggers incremental rebuild).

**No new dependencies.** Uses Python's built-in `http.server`. Single command: `python scripts/editor.py`.

## Data Model Changes

Add `deleted` field to metadata JSON at both post and photo level:

```json
{
  "title": "...",
  "deleted": false,
  "photos": [
    { "web": "...", "deleted": false, ... }
  ]
}
```

- `deleted` defaults to `false`. Omitted means not deleted.
- `build.py` completely skips deleted posts/photos for the live site. No HTML, no copied assets.
- Local editor mode shows deleted posts greyed out with restore/purge controls.
- If all photos in a post are deleted, the post is treated as deleted.
- Permanent purge removes JSON, markdown, and web image files from disk.

## API Server (`scripts/editor.py`)

Serves `_site/` on `localhost:8000`. Intercepts HTML to inject `editor.js` + `editor.css` before `</body>`.

### Endpoints

| Route | Method | Body | Action |
|-------|--------|------|--------|
| `/api/caption` | POST | `{slug, caption, photo_index?}` | Update post or photo caption |
| `/api/merge` | POST | `{slugs[], date, slug, caption}` | Merge posts into one |
| `/api/split` | POST | `{source_slug, photo_indices[], date, slug, caption}` | Split photos to new post |
| `/api/delete` | POST | `{slugs[], photo_indices?}` | Soft-delete posts or photos |
| `/api/restore` | POST | `{slugs[], photo_indices?}` | Restore from trash |
| `/api/purge` | POST | `{slugs[]}` | Permanently delete files |
| `/api/trash` | GET | | List all deleted posts |

### After each mutation

1. Update metadata JSON(s)
2. Regenerate markdown via `generate_markdown_from_json()`
3. Run incremental build (`build.py --local`)
4. Return JSON response with updated post URL

### Merge operation

- Accepts list of post slugs, target date, target slug name, combined caption
- Creates new metadata JSON with all photos combined
- Renames web files (`files/photoblog/`) to match new slug pattern
- Soft-deletes original posts (`deleted: true`) for undo capability
- User can restore originals if merge was wrong, then purge once satisfied

### Split operation

- Accepts source slug, photo indices to extract, target date/slug/caption
- Creates new metadata JSON with selected photos
- Removes those photos from source post JSON
- Renames web files for the new post
- Regenerates both posts

## Editor UI

### Post detail pages

- Pencil icon next to post caption. Click opens inline textarea with save/cancel.
- Each photo gets a pencil icon for its individual caption.
- Photos get checkbox overlay (top-left) on hover. Selecting enables toolbar: "Split to new post", "Delete photos".

### Grid/feed pages

- Photos get checkbox overlay on hover (top-left corner).
- First selection activates "selection mode": all visible photos show persistent checkboxes.
- Floating bottom toolbar: "Merge selected", "Delete selected".
- Deleted posts appear greyed out with "Deleted" badge and restore button (editor mode only).
- "Show deleted" toggle controls visibility of trashed posts.

### Merge dialog (modal)

- Preview of photos being merged
- Date picker (pre-filled with earliest date)
- Slug text field (suggested slug)
- Caption textarea with both captions separated by `---`, editable
- Merge / Cancel buttons

### Split dialog (modal)

- Preview of photos being split out
- Date picker, slug field, caption textarea for new post
- Split / Cancel buttons

### Delete flow

- Confirmation dialog: "Delete N post(s)? They'll be moved to trash."
- Posts get `deleted: true`, rebuild runs, greyed out in editor

### Trash view

- "Trash" button in header nav (editor mode only)
- Grid of all deleted posts
- Each has "Restore" and "Permanently delete" buttons
- Permanent delete requires second confirmation

## Files to create/modify

### New files
- `scripts/editor.py`: API server (~300 lines)
- `static/editor.js`: Editor UI controls and API calls (~400 lines)
- `static/editor.css`: Editor-specific styles (~150 lines)

### Modified files
- `scripts/build.py`: Skip `deleted` posts/photos during build
- `scripts/process_photos.py`: Respect `deleted` flag in markdown generation

## Verification

1. Start editor: `python scripts/editor.py`
2. Browse to `localhost:8000`, verify pencil icons appear
3. Edit a caption, verify JSON updated and page rebuilds
4. Select posts in grid, merge them, verify new combined post
5. Delete a post, verify it's greyed out locally but absent from `python scripts/build.py` output
6. Restore from trash, verify it reappears
7. Permanently delete, verify files removed
8. Run `python scripts/build.py` (non-local), verify no deleted content in `_site/`
