export type FocusPointerEvent = {
  metaKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

export function focusWindowPointerDown(
  event: FocusPointerEvent,
  bringToFront: () => void,
): void {
  bringToFront();
  if (event.metaKey) {
    event.preventDefault();
    event.stopPropagation();
  }
}
