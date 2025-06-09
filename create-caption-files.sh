#!/bin/bash
# Script to create empty caption files for all images that don't have them
# Run this after adding new photos to automatically create .txt files

GALLERY_DIR="./gallery"

echo "Creating caption files for new images..."

# Find all image files
find "$GALLERY_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" -o -iname "*.bmp" -o -iname "*.tiff" \) | while read -r image_file; do
    # Get the base filename without extension
    base_name="${image_file%.*}"
    caption_file="${base_name}.txt"
    
    # Create caption file if it doesn't exist
    if [ ! -f "$caption_file" ]; then
        touch "$caption_file"
        echo "Created: $(basename "$caption_file")"
    fi
done

echo "Caption file creation complete!"
echo "Edit the .txt files next to your images to add captions."