export type ObjectMarker = { key: string; anchor: string; x: number; y: number };
export function extractObjectMarkers(svg: string): ObjectMarker[] {
  const markers: ObjectMarker[] = [];
  for (const circle of svg.matchAll(/<circle\b([^>]*)\/?\s*>/gu)) {
    const attributes = new Map([...circle[1].matchAll(/([\w:-]+)\s*=\s*(['"])(.*?)\2/gu)].map((match) => [match[1], match[3]]));
    const id = /^tb-(\d+)-(center|north|south|east|west|south-west|north-east|basis[0xy]|point\d+)$/u.exec(attributes.get("id") ?? "");
    if (!id) continue;
    const x = Number(attributes.get("cx")); const y = Number(attributes.get("cy"));
    if (Number.isFinite(x) && Number.isFinite(y) && attributes.has("cx") && attributes.has("cy")) markers.push({ key: id[1], anchor: id[2], x, y });
  }
  return markers;
}
