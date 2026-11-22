/** Warframe wiki search link for an item. */
export function wikiUrl(name: string): string {
  return `https://wiki.warframe.com/w/Special:Search?search=${encodeURIComponent(name)}`;
}
