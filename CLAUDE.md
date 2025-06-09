# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a static photo gallery website built using [Thumbsup](https://thumbsup.github.io/), a Node.js photo gallery generator. The project is designed to be maintenance-free - photos are added to the `/gallery` directory and automatically built/deployed via GitHub Actions.

## Build System

**Primary Tool**: Thumbsup (containerized)
**Build Command**: `docker run -v "$(pwd):/work" ghcr.io/thumbsup/thumbsup /bin/sh -c "cd /work/ && thumbsup --config config.json"`
**Configuration**: `config.json` - controls gallery settings, theme, and output directory
**Output Directory**: `./build_output` (gitignored)

The build process is entirely containerized and runs automatically on GitHub Actions. There are no local dependencies to install.

## Key Configuration Files

- `config.json` - Main Thumbsup configuration (input/output paths, theme, CSS)
- `custom.css` - Theme customization styles
- `.github/workflows/gallery.yml` - Automated build and GitHub Pages deployment

## Development Workflow

1. **Adding Photos**: Place image files in `/gallery` directory
2. **Customizing Appearance**: Modify `custom.css` or adjust theme settings in `config.json`
3. **Testing Locally**: Run the Docker build command above to generate `./build_output`
4. **Deployment**: Push to master branch - GitHub Actions automatically builds and deploys to GitHub Pages

## Gallery Configuration

The `config.json` file controls:
- Input directory (`./gallery`)
- Gallery title and footer
- Theme selection (currently "cards", options: mosaic, cards, classic, flow)
- Photo sorting (by filename)
- Custom CSS inclusion