import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from "@spotify/basic-pitch";

// Transcribe 22.05 kHz mono Float32 audio into note events. onProgress gets 0..1.
export async function transcribe(audio22k, modelUrl, onProgress) {
  const frames = [], onsets = [], contours = [];
  const bp = new BasicPitch(modelUrl);
  await bp.evaluateModel(
    audio22k,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    p => onProgress && onProgress(p)
  );
  const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.5, 0.3, 5)));
  return notes.map(n => ({ m: n.pitchMidi, t: n.startTimeSeconds, d: n.durationSeconds, v: Math.min(1, Math.max(0.2, n.amplitude)) }));
}
