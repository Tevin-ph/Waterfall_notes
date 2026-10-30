// notes -> MusicXML (musicxml.js) for a few real scores, written out so a python script can read them back and compare
import fs from "node:fs"; import { buildScore } from "../musicxml.js";
const bpmOf = JSON.parse(fs.readFileSync("_test/asap_tempo.json", "utf8"));
fs.mkdirSync("_test/xml_out", { recursive: true });
for (const f of fs.readdirSync("_test/asap_json").filter(f => f.endsWith(".json"))) {
  const notes = JSON.parse(fs.readFileSync("_test/asap_json/" + f, "utf8")); const t0 = Date.now();
  const sc = buildScore(notes, { bpm: bpmOf[f], off: 0, beats: 4, title: f });
  fs.writeFileSync("_test/xml_out/" + f.replace(".json", ".musicxml"), sc.xml()); console.log(f.padEnd(52), "bars", sc.measures, "key fifths", sc.key.fifths, sc.key.minor ? "minor" : "major", (Date.now() - t0) + " ms");
}
