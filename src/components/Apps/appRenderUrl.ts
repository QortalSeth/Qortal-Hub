/** Keep the literal path punctuation used by Core's injected router base and
 * master's render URLs. Encoding '+' as '%2B', for example, breaks existing
 * routers and Core's navigation reports. Delimiters and literal '%' still need
 * encoding so a name cannot introduce another path segment, query or fragment.
 *
 * '^' is deliberately absent from the list below. The WHATWG URL parser
 * percent-encodes it to '%5E' in every path it serialises, so decoding it here
 * only ever produced a root that disagreed with `new URL(root).pathname`; the
 * name reached the router as '%5E' regardless. Leaving it encoded keeps the
 * built URL byte-identical to what the parser round-trips.
 */
export function buildAppRenderRoot(
  baseUrl: string,
  service: string,
  name: string
): string {
  const encodedName = encodeURIComponent(name).replace(
    /%(24|26|2B|2C|3A|3B|3D|40|5B|5D|7C)/g,
    (escaped) => decodeURIComponent(escaped)
  );
  return `${baseUrl}/render/${encodeURIComponent(service)}/${encodedName}`;
}
