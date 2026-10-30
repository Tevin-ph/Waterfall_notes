# Measuring the key-release guess

How well does the piano helper guess when a finger let go of a key? The truth comes from the MAESTRO dataset
(CC BY-NC-SA 4.0, non-commercial): real piano performances whose MIDI has the actual key-off times.

1. `python -I fetch_maestro.py <folder>` pulls three held-out test pieces (about 50 MB) out of the 108 GB zip with range requests.
   Rename them schubert / debussy / scarlatti (.wav and .midi), and keep the folder out of git (`falling-note-proto/_test/` is ignored).
2. Run the helper on each wav: `python ../piano_worker.py schubert.wav schubert.pred.json` (the piano venv's python).
3. `python eval_release.py 5 0.15 grid` compares the guesses (and searches the settings) against the true releases.
   For the helper's own output, save it as `<name>.new.json` and run `eval_shipped.py` (it reads kd).

Result for the shipped rule (4290 matched notes, three classical pieces): 88.5% of notes land within 150 ms of the real release,
against 49.2% for the model's own note length; the average bar goes from 0.41 s to 0.16 s. Real holds over 0.8 s are about 1% of notes
and the rule gets almost none of them right. Three classical pieces with pedal are a small sample, so casual or pop playing may differ.

## Other experiments (see ../../repo-research.md for the results)
* `learn_hold.py`: learned key-hold models against the rule (leave-one-piece-out). The rule won.
* `degrade.py`, `f1_degraded.py`, `noisiness.py`: make phone-style copies of the test pieces, then score precision/recall/F1 of the transcription on clean, degraded and denoised audio, and the noisiness gauge the helper uses.
* `ghost.py`, `ghost2.py`: how many false notes appear on degraded audio and whether any rule or classifier removes more false notes than real ones (none did).
* `tempo_test.mjs`, `tempo_steadiness.mjs` (run with node): tempo detector on made-up songs with a known tempo; fit score for steady, loose and random timing.
