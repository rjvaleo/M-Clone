export function variablePositionGesture(altKey: boolean, shiftKey: boolean) {
  return { activate: altKey, quantized: altKey && shiftKey };
}
