#!/bin/bash
# Script to process caption files and add them to photos before Thumbsup build
# Looks for .txt files next to images and adds their content as EXIF descriptions

GALLERY_DIR="./gallery"

echo "Processing captions..."

# Find all image files
find "$GALLERY_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" -o -iname "*.bmp" -o -iname "*.tiff" \) | while read -r image_file; do
    # Get the base filename without extension
    base_name="${image_file%.*}"
    caption_file="${base_name}.txt"

    # Check if caption file exists
    if [ -f "$caption_file" ]; then
        # Read caption content
        caption_content=$(cat "$caption_file")

        # Only process if caption is not empty
        if [ -n "$caption_content" ]; then
            echo "Adding caption to $(basename "$image_file"): $caption_content"

            # Add caption to EXIF Description field
            exiftool -overwrite_original -Description="$caption_content" "$image_file" 2>/dev/null
        fi
    fi
done

echo "Caption processing complete!"
