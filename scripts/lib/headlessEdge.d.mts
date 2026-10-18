export function selectPageTarget<T extends { readonly type: string; readonly url: string }>(targets: readonly T[]): T | undefined;
