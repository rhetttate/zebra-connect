// Inline SVG icons, 20px grid, stroke follows text color.
const paths = {
  labels: '<rect x="3" y="5" width="14" height="10" rx="1.5"/><path d="M6 8h5M6 11h8"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  gear: '<path d="M3 6h14M3 10h14M3 14h14"/><circle cx="12.5" cy="6" r="2.1"/><circle cx="7" cy="10" r="2.1"/><circle cx="13.5" cy="14" r="2.1"/>',
  print: '<path d="M6 7V3h8v4"/><rect x="4" y="7" width="12" height="6" rx="1"/><path d="M6 11h8v6H6z"/>',
  camera: '<path d="M4 6.5h3l1.2-2h3.6L13 6.5h3a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1z"/><circle cx="10" cy="11" r="2.8"/>',
  file: '<path d="M6 3h5.5L15 6.5V17H6z"/><path d="M11.5 3v3.5H15"/>',
  rotate: '<path d="M15.5 8.5A6 6 0 1 0 16 11"/><path d="M16 4.5v4h-4"/>',
  trash: '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5"/>',
  refresh: '<path d="M4.5 11.5A6 6 0 0 0 16 9.8M15.5 8.5A6 6 0 0 0 4 10.2"/><path d="M4 5.5v4h4M16 14.5v-4h-4"/>',
  search: '<circle cx="9" cy="9" r="4.5"/><path d="M12.5 12.5 16 16"/>',
  check: '<path d="M4 10.5l4 4L16 6"/>',
  back: '<path d="M12 4l-6 6 6 6"/>',
  target: '<circle cx="10" cy="10" r="5.5"/><path d="M10 2.5v3M10 14.5v3M2.5 10h3M14.5 10h3"/><circle cx="10" cy="10" r="1.1"/>',
};

export function icon(name) {
  return `<svg class="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
