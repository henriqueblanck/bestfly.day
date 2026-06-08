/**
 * Generates Google Flights search URLs using the `tfs` protobuf parameter.
 *
 * Structure reverse-engineered from observed Google Flights URLs:
 *   field 1 (varint)      = 28  (hardcoded constant — seat/search mode flag)
 *   field 2 (varint)      = trip_type (1=one-way, 2=round-trip)
 *   field 3 (embedded)×N  = flight segments
 *     field 2  (string)   = date "YYYY-MM-DD"
 *     field 13 (embedded) = origin airport
 *     field 14 (embedded) = destination airport
 *       field 1 (varint)  = 1  (airport type: IATA code)
 *       field 2 (string)  = "BSB" | "CDG" | …
 *   field 8  (varint) = 1
 *   field 9  (varint) = 1
 *   field 14 (varint) = 1
 *   field 16 (embedded)   = stop filter (INT64_MAX = any stops)
 *   field 19 (varint) = 1
 */

function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function fieldVarint(num: number, val: number): number[] {
  return [(num << 3) | 0, ...varint(val)];
}

function fieldString(num: number, str: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(str));
  return [(num << 3) | 2, bytes.length, ...bytes];
}

function fieldEmbedded(num: number, content: number[]): number[] {
  return [(num << 3) | 2, content.length, ...content];
}

function airport(iata: string): number[] {
  return [...fieldVarint(1, 1), ...fieldString(2, iata)];
}

function segment(date: string, orig: string, dst: string): number[] {
  return [
    ...fieldString(2, date),
    ...fieldEmbedded(13, airport(orig)),
    ...fieldEmbedded(14, airport(dst)),
  ];
}

export function makeGoogleFlightsUrl(
  origin: string,
  dest: string,
  outboundDate: string,
  returnDate?: string,
  currency = "BRL",
): string {
  // One-way: simple ?q= format confirmed working
  if (!returnDate) {
    return `https://www.google.com/travel/flights?q=${origin}+to+${dest}+on+${outboundDate}&curr=${currency}`;
  }

  // Round-trip: tfs= protobuf (q= with "returning" doesn't work on Google Flights)
  const body: number[] = [
    ...fieldVarint(1, 28),
    ...fieldVarint(2, 2),
    ...fieldEmbedded(3, segment(outboundDate, origin, dest)),
    ...fieldEmbedded(3, segment(returnDate, dest, origin)),
  ];

  body.push(
    0x40, 0x01,
    0x48, 0x01,
    0x70, 0x01,
    0x82, 0x01, 0x0b,
    0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
    0x98, 0x01, 0x01,
  );

  const tfs = btoa(String.fromCharCode(...body))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `https://www.google.com/travel/flights/search?tfs=${tfs}&curr=${currency}`;
}
