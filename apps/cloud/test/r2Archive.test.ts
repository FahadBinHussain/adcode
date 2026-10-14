/*
 * Streaming a home archive into R2.
 *
 * An archive's length is unknown until tar finishes and can be far larger than a Durable Object
 * may hold, so it goes up in 10 MB parts. A failed upload is aborted, so R2 is never left with
 * a half-written archive that a later wake could restore.
 */
import { describe, expect, it } from "vitest";
import { putStream } from "../src/r2Archive.ts";

const MB = 1024 * 1024;

function fakeBucket(failOnPart?: number) {
  const parts: number[] = [];
  const log: string[] = [];
  const bucket = {
    createMultipartUpload: async (key: string) => {
      log.push(`create ${key}`);
      return {
        uploadPart: async (number: number, chunk: Uint8Array) => {
          if (number === failOnPart) throw new Error("network");
          parts.push(chunk.length);
          return { partNumber: number, etag: `e${number}` };
        },
        complete: async (uploaded: unknown[]) => { log.push(`complete ${uploaded.length}`); },
        abort: async () => { log.push("abort"); },
      };
    },
  } as unknown as R2Bucket;
  return { bucket, parts, log };
}

function stream(chunkBytes: number, count: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === count) return controller.close();
      sent += 1;
      controller.enqueue(new Uint8Array(chunkBytes));
    },
  });
}

describe("putStream", () => {
  it("uploads in 10 MB parts and completes", async () => {
    const { bucket, parts, log } = fakeBucket();
    const total = await putStream(bucket, "homes/u/1.tar.gz", stream(MB, 25));
    expect(total).toBe(25 * MB);
    expect(parts).toEqual([10 * MB, 10 * MB, 5 * MB]);
    expect(log).toEqual(["create homes/u/1.tar.gz", "complete 3"]);
  });

  it("cuts parts at exactly 10 MB whatever size the chunks arrive in, as R2 requires", async () => {
    const { bucket, parts } = fakeBucket();
    await putStream(bucket, "k", stream(3 * MB, 9));
    expect(parts).toEqual([10 * MB, 10 * MB, 7 * MB]);
  });

  it("aborts when a part fails, and says so", async () => {
    const { bucket, log } = fakeBucket(2);
    await expect(putStream(bucket, "k", stream(MB, 25))).rejects.toThrow("network");
    expect(log.at(-1)).toBe("abort");
  });

  it("refuses an empty archive", async () => {
    const { bucket, log } = fakeBucket();
    await expect(putStream(bucket, "k", stream(MB, 0))).rejects.toThrow("empty");
    expect(log.at(-1)).toBe("abort");
  });
});
