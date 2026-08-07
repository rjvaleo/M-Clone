// Single shared runtime instance, bound to the live store so the engine always
// reads current project state (that's what makes live tweaking work).

import { MRuntime } from "../engine/runtime";
import { useM } from "../state/store";
import { decodeMidiMessage, isChannelMessage, mapAssignedInputChannel } from "../engine/midiinput";

let runtime: MRuntime | null = null;

export function getRuntime(): MRuntime {
  if (!runtime) {
    runtime = new MRuntime(
      () => useM.getState().project,
      (notes) => useM.getState().recordMidiNotes(notes),
      {
        onCyclicReset: (voices) => useM.getState().signalCyclicReset(voices),
        onPlannedSteps: (steps) => useM.getState().followDrumMachine(steps),
        onMidiMessage: (event) => {
          if (!event.data) return;
          const message = decodeMidiMessage(event.data);
          if (!message) return;
          // Clock and transport carry no channel, so they are taken by the
          // runtime's follower and never reach the channel routing below.
          if (!isChannelMessage(message)) {
            getRuntime().ingestClockMessage(message, performance.now() / 1000);
            return;
          }
          const deviceId = (event.currentTarget as MIDIInput | null)?.id ?? null;
          const mappedChannel = mapAssignedInputChannel(
            useM.getState().project.midiAssignments.inputs, deviceId, message.channel,
          );
          if (mappedChannel === null) return;
          const mapped = { ...message, channel: mappedChannel };
          const responses = useM.getState().receiveMidi(mapped);
          for (const response of responses) {
            if (response.type === "start") {
              void runtime?.start().then(() => useM.getState().setPlaying(true));
              continue;
            }
            if (response.type === "stop") {
              runtime?.stop();
              useM.getState().setPlaying(false);
              continue;
            }
            if (response.type === "sync") {
              runtime?.sync();
              continue;
            }
            if ("voice" in response) {
              const voice = useM.getState().project.voices[response.voice];
              runtime?.audition([response.note], response.velocity,
                "channels" in response && response.channels
                  ? response.channels : voice.outputChannels, 0.25, response.voice);
            }
          }
        },
        getPerformanceSettings: () => {
          const state = useM.getState();
          return {
            useMetronome: state.options.useMetronome,
            sendClock: state.options.sendClock,
            syncRatio: state.syncRatio,
            externalClock: state.options.externalClock,
            syncRatioDirection: state.syncRatioDirection,
          };
        },
      },
    );
  }
  runtime.setSynthSettings(useM.getState().synthSettings);
  return runtime;
}
