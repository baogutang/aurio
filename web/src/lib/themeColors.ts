/** Read theme RGB triplet for Canvas / inline styles (Canvas cannot parse CSS vars). */
export function readThemeRgb(varName: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v || fallback;
}

export function themeRgba(varName: string, alpha: number, fallback: string): string {
  return `rgba(${readThemeRgb(varName, fallback)}, ${alpha})`;
}
