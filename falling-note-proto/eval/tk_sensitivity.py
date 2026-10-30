"""Run Transkun with the decoder's 'no note' score lowered by delta (more, smaller notes). usage: tk_bias.py delta piece..."""
import sys, json
sys.path.insert(0, "../..")
delta = float(sys.argv[1]); names = sys.argv[2:]
import piano_worker as W
from transkun.CRF import NeuralSemiCRFInterval as C            # the package exports the class itself
orig = C.decode
def decode(self, forcedStartPos=None, forward=False):
    self.noiseScore = self.noiseScore - delta
    return orig(self, forcedStartPos=forcedStartPos, forward=forward)
C.decode = decode
import soundfile as sf, numpy as np
for nm in names:
    x, sr = sf.read(nm + ".deg.16k.wav", dtype="float32"); notes, pedal = W._transkun_notes(np.ascontiguousarray(x), sr)
    json.dump({"notes": notes, "pedal": pedal}, open("%s.deg.bias%g.json" % (nm, delta), "w")); print("done", nm, delta, len(notes), flush=True)
