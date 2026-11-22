/**
 * Minimal Mapbox Vector Tile (v2) decoder: layers, properties and geometry in
 * tile coordinates. Dependency-free on purpose (the team has not ratified new
 * packages). Only what decoration placement needs: no feature IDs beyond the
 * raw value, no lazy decoding.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 */

export type MvtValue = string | number | boolean;
export type MvtGeometryType = 1 | 2 | 3; // point, line, polygon

export interface MvtFeature {
  readonly type: MvtGeometryType;
  readonly properties: Readonly<Record<string, MvtValue>>;
  /** Point/line/ring lists in tile coordinates [x0, y0, x1, y1, …]. */
  readonly geometry: readonly Float64Array[];
}

export interface MvtLayer {
  readonly name: string;
  readonly extent: number;
  readonly features: readonly MvtFeature[];
}

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  private readonly view: DataView;
  constructor(buf: Uint8Array) { this.buf = buf; this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  varint(): number {
    let result = 0, shift = 1, byte: number;
    do {
      byte = this.buf[this.pos++]!;
      result += (byte & 0x7f) * shift;
      shift *= 128;
    } while (byte & 0x80 && shift < 2 ** 63);
    return result;
  }
  svarint() { const n = this.varint(); return n % 2 === 1 ? (n + 1) / -2 : n / 2; }
  bytes(): Uint8Array { const len = this.varint(); const start = this.pos; this.pos += len; return this.buf.subarray(start, start + len); }
  string(): string { return new TextDecoder().decode(this.bytes()); }
  float() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  double() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }
  packed(): number[] {
    const length = this.varint(), end = this.pos + length, out: number[] = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  }
}

function readValue(bytes: Uint8Array): MvtValue {
  const r = new Reader(bytes);
  let value: MvtValue = '';
  while (r.pos < bytes.length) {
    const tag = r.varint(), field = tag >> 3, wire = tag & 7;
    if (field === 1) value = r.string();
    else if (field === 2) value = r.float();
    else if (field === 3) value = r.double();
    else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) value = r.svarint();
    else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

function decodeGeometry(commands: readonly number[]): Float64Array[] {
  const parts: Float64Array[] = [];
  let current: number[] | null = null, x = 0, y = 0, i = 0;
  while (i < commands.length) {
    const header = commands[i++]!, cmd = header & 7, count = header >> 3;
    if (cmd === 1 || cmd === 2) {
      for (let k = 0; k < count; k++) {
        const dx = commands[i++]!, dy = commands[i++]!;
        x += (dx >>> 1) ^ -(dx & 1);
        y += (dy >>> 1) ^ -(dy & 1);
        if (cmd === 1) { if (current) parts.push(Float64Array.from(current)); current = []; }
        current!.push(x, y);
      }
    } else if (cmd === 7) {
      if (current && current.length >= 2) current.push(current[0]!, current[1]!);
    } else break;
  }
  if (current) parts.push(Float64Array.from(current));
  return parts;
}

/** Decode the layers named in `want` (all layers when omitted). */
export function decodeMvt(data: ArrayBuffer | Uint8Array, want?: ReadonlySet<string>): Map<string, MvtLayer> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const tile = new Reader(buf), layers = new Map<string, MvtLayer>();
  while (tile.pos < buf.length) {
    const tag = tile.varint();
    if (tag >> 3 !== 3 || (tag & 7) !== 2) { tile.skip(tag & 7); continue; }
    const bytes = tile.bytes(), r = new Reader(bytes);
    let name = '', extent = 4096;
    const keys: string[] = [], values: MvtValue[] = [], raw: Uint8Array[] = [];
    while (r.pos < bytes.length) {
      const t = r.varint(), field = t >> 3;
      if (field === 1) name = r.string();
      else if (field === 2) raw.push(r.bytes());
      else if (field === 3) keys.push(r.string());
      else if (field === 4) values.push(readValue(r.bytes()));
      else if (field === 5) extent = r.varint();
      else r.skip(t & 7);
    }
    if (want && !want.has(name)) continue;
    const features: MvtFeature[] = [];
    for (const fb of raw) {
      const f = new Reader(fb);
      let type = 0 as number, tags: number[] = [], geometry: number[] = [];
      while (f.pos < fb.length) {
        const t = f.varint(), field = t >> 3;
        if (field === 2) tags = f.packed();
        else if (field === 3) type = f.varint();
        else if (field === 4) geometry = f.packed();
        else f.skip(t & 7);
      }
      if (type < 1 || type > 3) continue;
      const properties: Record<string, MvtValue> = {};
      for (let k = 0; k + 1 < tags.length; k += 2) {
        const key = keys[tags[k]!], value = values[tags[k + 1]!];
        if (key !== undefined && value !== undefined) properties[key] = value;
      }
      features.push({ type: type as MvtGeometryType, properties, geometry: decodeGeometry(geometry) });
    }
    layers.set(name, { name, extent, features });
  }
  return layers;
}

/** Signed ring area in tile coordinates (y down): MVT exterior rings are positive. */
export function ringArea(ring: Float64Array): number {
  let sum = 0;
  for (let i = 0; i + 3 < ring.length; i += 2) sum += ring[i]! * ring[i + 3]! - ring[i + 2]! * ring[i + 1]!;
  return sum / 2;
}

/** Group polygon rings into [exterior, ...holes] per MVT winding rules. */
export function classifyRings(rings: readonly Float64Array[]): Float64Array[][] {
  const polygons: Float64Array[][] = [];
  let current: Float64Array[] | null = null, exteriorSign = 0;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area === 0) continue;
    const sign = Math.sign(area);
    if (!exteriorSign) exteriorSign = sign;
    if (sign === exteriorSign || !current) { current = [ring]; polygons.push(current); }
    else current.push(ring);
  }
  return polygons;
}
