import { computeHunks } from "@adcode/ai";
import type { AiCheckpointView } from "../shared/api.ts";
import type { EditCheckpoint } from "./aiCheckpoints.ts";

/** Expose the recorded change for review without sending the workspace root or binary bytes. */
export function checkpointView(checkpoint: EditCheckpoint): AiCheckpointView {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    files: checkpoint.files.map(file => {
      const hunks = file.encoding === "base64" ? undefined : computeHunks(file.before ?? "", file.after ?? "");
      return {
        path: file.path, created: file.before === null, deleted: file.after === null,
        ...(hunks === undefined ? {} : {
          added: hunks.reduce((sum, hunk) => sum + hunk.replacement.length, 0),
          removed: hunks.reduce((sum, hunk) => sum + hunk.original.length, 0),
          hunks,
        }),
      };
    }),
  };
}
