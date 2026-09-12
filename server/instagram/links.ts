export type InstagramLink = { url:string; shortcode:string; kind:'post'|'reel' };
export const MAX_LINK_MESSAGE_LENGTH = 4000;
export const MAX_LINK_CANDIDATES = 10;

/** Recognizes a deliberately narrow URL format; never contacts Instagram. */
export function normalizeInstagramLink(value:string):InstagramLink|null {
  if (value.length>2048 || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return null;
  // Inspect raw authority/path before a URL parser could normalize dot segments,
  // encoded hostnames, default ports, or other unexpected input into an accepted URL.
  const parts=/^https:\/\/([^/?#]+)(\/[^?#]*)(?:\?[^#]*)?(?:#.*)?$/i.exec(value);
  if (!parts || !['instagram.com','www.instagram.com'].includes(parts[1].toLowerCase())) return null;
  const path=/^\/(p|reel)\/([A-Za-z0-9_-]{1,64})\/?$/.exec(parts[2]);
  if (!path) return null;
  return {url:`https://www.instagram.com/${path[1]}/${path[2]}/`,shortcode:path[2],kind:path[1]==='p' ? 'post' : 'reel'};
}

/** Only complete explicit URLs are considered, including Discord/Markdown wrappers. */
export function findInstagramLinks(content:string):InstagramLink[] {
  // Reject oversize input instead of accepting a URL accidentally cut at the limit.
  if (content.length>MAX_LINK_MESSAGE_LENGTH) return [];
  const result:InstagramLink[]=[],seen=new Set<string>();
  // Consume whole URL tokens, including untrusted URLs containing a nested
  // Instagram URL. Do not scan that nested URL as a separate announcement target.
  const candidates=/(?:^|[\s(<\[{"'`])([a-z][a-z0-9+.-]*:\/\/[^\s<>"`{}]+)/gi;
  let examined=0;
  for (const match of content.matchAll(candidates)) {
    if (++examined>MAX_LINK_CANDIDATES) break;
    const link=normalizeInstagramLink(match[1].replace(/[)\],.!?:;]+$/g,''));
    if (!link || seen.has(link.shortcode)) continue;
    seen.add(link.shortcode);result.push(link);
  }
  return result;
}
