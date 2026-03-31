// Generate markdown from metadata JSON (matches Python generate_markdown_from_json)

export function generateMarkdown(post) {
  if (post.deleted) return null;

  const photos = (post.photos || []).filter(p => !p.deleted);
  if (photos.length === 0) return null;

  const title = post.title || post.date || 'Untitled';
  const tags = (post.tags || ['photoblog']).join(', ');
  const thumbnail = photos[0].web || '';

  const lines = [
    '---',
    `tags: ${tags}`,
    `thumbnail: ${thumbnail}`,
    '---',
    '',
    `# ${title}`,
    '',
  ];

  if (post.caption) {
    lines.push(post.caption);
    lines.push('');
  }

  for (const photo of photos) {
    const web = photo.web || '';
    const alt = photo.alt || title;
    const caption = photo.caption || '';
    const exif = photo.exif || {};

    lines.push(`![${alt}](${web})`);
    lines.push('');

    // Caption: short = italic, long = paragraph
    if (caption) {
      if (!caption.includes('\n') && caption.length < 120) {
        lines.push(`*${caption}*`);
      } else {
        lines.push(caption);
      }
      lines.push('');
    }

    // EXIF info
    const parts = [];
    if (exif.camera) parts.push(`**Camera:** ${exif.camera}`);
    if (exif.lens) parts.push(`**Lens:** ${exif.lens}`);

    const settings = [];
    if (exif.focal_length) settings.push(exif.focal_length);
    if (exif.aperture) settings.push(exif.aperture);
    if (exif.shutter_speed) settings.push(exif.shutter_speed);
    if (exif.iso) settings.push(`ISO ${exif.iso}`);

    if (settings.length > 0) {
      parts.push(`**Settings:** ${settings.join(' | ')}`);
    }

    if (parts.length > 0) {
      lines.push(parts.join('  \n'));
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}
