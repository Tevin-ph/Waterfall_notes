// Only the three.js pieces the scene uses, so the bundle stays small.
export {
  WebGLRenderer, Scene, PerspectiveCamera, Color, Fog, Group, Mesh, Sprite,
  BoxGeometry, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, SpriteMaterial,
  CanvasTexture, AmbientLight, DirectionalLight, Vector2, AdditiveBlending,
  ACESFilmicToneMapping, SRGBColorSpace, HalfFloatType,
} from "three";
export { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
export { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
