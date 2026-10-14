/**
 * Streaming a sandbox's home archive into R2.
 *
 * An archive can be hundreds of megabytes (a Vite project's `node_modules`), far more than a
 * Durable Object may hold in memory, and its length is not known until tar finishes. R2's
 * multipart upload takes it in 10 MB parts as it streams; a failure aborts the upload, so no
 * half-written archive is ever left to be restored.
 */

const PART_BYTES = 10 * 1024 * 1024;

export async function putStream(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>): Promise<number> {
  const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/gzip" } });
  const parts: R2UploadedPart[] = [];
  const reader = body.getReader();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let total = 0;

  /*
   * R2 needs every part but the last to be exactly the same size, and tar's output arrives in
   * whatever chunks it likes - so parts are cut at exactly PART_BYTES and the rest carried over.
   */
  const take = (bytes: number): Uint8Array => {
    const chunk = new Uint8Array(bytes);
    let offset = 0;
    while (offset < bytes) {
      const piece = pending[0]!;
      const needed = bytes - offset;
      if (piece.length <= needed) {
        chunk.set(piece, offset);
        offset += piece.length;
        pending.shift();
      } else {
        chunk.set(piece.subarray(0, needed), offset);
        pending[0] = piece.subarray(needed);
        offset += needed;
      }
    }
    pendingBytes -= bytes;
    return chunk;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value);
      pendingBytes += value.length;
      total += value.length;
      while (pendingBytes >= PART_BYTES) parts.push(await upload.uploadPart(parts.length + 1, take(PART_BYTES)));
    }
    if (pendingBytes > 0) parts.push(await upload.uploadPart(parts.length + 1, take(pendingBytes)));
    if (parts.length === 0) throw new Error("The archive was empty");
    await upload.complete(parts);
    return total;
  } catch (error) {
    await upload.abort().catch(() => undefined);
    throw error;
  }
}
