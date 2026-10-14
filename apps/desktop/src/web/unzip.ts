/**
 * Opening a .zip in the browser, so only the files it holds travel to the sandbox.
 *
 * A small reader for the common case - stored and deflated entries, as every "Download ZIP"
 * button and every OS's "Compress" produces - using the browser's own `DecompressionStream`
 * rather than a dependency. ZIP64 and encrypted archives are refused with a sentence, not
 * half-read.
 */

export interface ZipFile {
  readonly path: string;
  readonly data: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes: Uint8Array): Promise<ZipFile[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const notZip = (): Error => new Error("That file isn't a .zip ADCode can open. Upload the folder instead.");

  // The end-of-directory record sits in the last 64 KiB + 22 bytes (it may carry a comment).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw notZip();

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new Error("That .zip is too large to open here. Upload the folder instead.");

  const files: ZipFile[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== DIRECTORY_ENTRY) throw notZip();
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) continue;
    if ((flags & 0x1) !== 0) throw new Error("That .zip is password-protected. Upload the folder instead.");
    if (method !== 0 && method !== 8) throw new Error("That .zip uses a compression ADCode can't open. Upload the folder instead.");
    if (localAt + 30 > bytes.length || view.getUint32(localAt, true) !== LOCAL_HEADER) throw notZip();

    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const body = bytes.subarray(start, start + compressed);
    files.push({ path, data: method === 0 ? body.slice() : await inflate(body) });
  }
  return files;
}
