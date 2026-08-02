export function editorSoundAllowed(
  soundEnabled: boolean,
  transportPlaying: boolean,
  soundWhilePlaying: boolean,
): boolean {
  return soundEnabled && (!transportPlaying || soundWhilePlaying);
}
