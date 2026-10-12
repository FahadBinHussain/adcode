/** Keep an in-progress file name mounted when filesystem events refresh its folder. */
export function reconcileTreeChildren(box: HTMLElement, rows: readonly Element[]): void {
  const editors = [...box.children].filter(row => row.classList.contains("tree-edit-row"));
  const next = [...editors, ...rows];
  const retained = new Set(next);
  for (const child of [...box.children]) if (!retained.has(child)) child.remove();
  let cursor = box.firstElementChild;
  for (const row of next) {
    if (row === cursor) cursor = cursor.nextElementSibling;
    else box.insertBefore(row, cursor);
  }
}
