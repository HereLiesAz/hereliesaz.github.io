import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

// World-height of every painting's central shell, and the depth of the
// shell from front to back. Each painting occupies a slab of 3D space
// `PAINTING_HEIGHT × aspect × SHELL_DEPTH` and the 30 layers sit on
// stacked planes inside that slab.
const PAINTING_HEIGHT = 10.0;
const SHELL_DEPTH     = 4.5;

// Bone-white from AESTHETIC §2 — what the painting hue mixes toward as the
// camera pulls away from the null.
const BONE_WHITE = new THREE.Color('#f4f0e6');

const N_DEPTH = 10;
const N_COLOR = 10;
const N_LUM   = 10;

// Distance envelope for accent gating (see useFrame below).
const COLOR_HOT  = 4.0;
const COLOR_GONE = 6.0;
const FADE_GONE  = 22.0;


// ---- module-level fetch caches ----------------------------------------------

const theaterMetaCache = new Map();
function fetchTheaterMeta(id) {
  if (!id) return Promise.resolve(null);
  const hit = theaterMetaCache.get(id);
  if (hit) return hit;
  const p = fetch(`/data/theater/${encodeURIComponent(id)}.theater.json`)
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null);
  theaterMetaCache.set(id, p);
  return p;
}


// ---- shaders ----------------------------------------------------------------

const layerVS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// Per-pixel: sample the painting and the layer-id mask. If this pixel does
// not belong to this plane's layer, discard. Each set (depth / colour /
// luminance) reads its assigned channel of the mask texture. The recovered
// band index is compared to the plane's uLayerIdx with a half-band
// tolerance, then alpha is multiplied by the camera-proximity envelope.
//
// Mask encoding (see scripts/theater_baker.py): values are 0..225 in steps
// of 25, so the band index = round(channel * 255 / 25).
const layerFS = /* glsl */ `
precision highp float;
uniform sampler2D uPainting;
uniform sampler2D uMasks;
uniform float uLayerIdx;
uniform float uChannel;     // 0=R (depth), 1=G (colour), 2=B (luminance)
uniform float uIntensity;
uniform float uColorBleed;
uniform vec3  uBoneWhite;
varying vec2 vUv;

float pickChannel(vec3 m, float c) {
  return c < 0.5 ? m.r : (c < 1.5 ? m.g : m.b);
}

void main() {
  vec3 painting = texture2D(uPainting, vUv).rgb;
  vec3 mask     = texture2D(uMasks,    vUv).rgb;

  float band = floor(pickChannel(mask, uChannel) * 255.0 / 25.0 + 0.5);
  if (abs(band - uLayerIdx) > 0.5) discard;

  vec3 hue = mix(uBoneWhite, painting, uColorBleed);
  gl_FragColor = vec4(hue, uIntensity);
}
`;


// ---- per-layer plane assembly -----------------------------------------------

function buildLayers(metadata) {
  const layers = [];
  const aspect = (metadata.src?.width || 1) / (metadata.src?.height || 1);
  const planeWidth  = PAINTING_HEIGHT * aspect;
  const planeHeight = PAINTING_HEIGHT;

  // Lay the 30 slabs out along the shell. Set order is fixed: depth at the
  // back (where the depth-band-0 — "farthest" pixels — really do live in
  // space), then colour bands across the middle, then luminance at the
  // front.
  const setOffsets = [
    { kind: 'depth', channel: 0, count: N_DEPTH, zStart: -SHELL_DEPTH,             zEnd: -SHELL_DEPTH * 2/3 },
    { kind: 'color', channel: 1, count: N_COLOR, zStart: -SHELL_DEPTH * 2/3,       zEnd: -SHELL_DEPTH * 1/3 },
    { kind: 'lum',   channel: 2, count: N_LUM,   zStart: -SHELL_DEPTH * 1/3,       zEnd: 0 },
  ];

  for (const set of setOffsets) {
    for (let i = 0; i < set.count; i++) {
      const tMid = (i + 0.5) / set.count;
      const z = THREE.MathUtils.lerp(set.zStart, set.zEnd, tMid);
      layers.push({
        kind:    set.kind,
        channel: set.channel,
        idx:     i,
        z,
        planeWidth,
        planeHeight,
      });
    }
  }
  return layers;
}


// ---- component --------------------------------------------------------------

export default function TheaterPainting({ id, position, rotation, mySegmentIndex }) {
  const [meta, setMeta] = useState(null);
  const { camera } = useThree();
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheaterMeta(id).then(json => { if (!cancelled) setMeta(json); });
    return () => { cancelled = true; };
  }, [id]);

  const rotEuler = useMemo(() => {
    const r = rotation || [0, 0, 0];
    return new THREE.Euler(
      THREE.MathUtils.degToRad(r[0] || 0),
      THREE.MathUtils.degToRad(r[1] || 0),
      THREE.MathUtils.degToRad(r[2] || 0),
    );
  }, [rotation]);

  const layers = useMemo(() => meta ? buildLayers(meta) : [], [meta]);

  // Shared material across all 30 planes of this painting. Per-plane data
  // (layer index, channel) goes through onBeforeCompile-free attribute
  // injection: we clone the material per plane below. Keeping it simple
  // for now — one material, uniforms set per draw via the mesh-level
  // material clone trick (see plane loop below).
  const baseMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader:   layerVS,
    fragmentShader: layerFS,
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.NormalBlending,
    uniforms: {
      uPainting:   { value: null },
      uMasks:      { value: null },
      uLayerIdx:   { value: 0 },
      uChannel:    { value: 0 },
      uIntensity:  { value: 0 },
      uColorBleed: { value: 0 },
      uBoneWhite:  { value: BONE_WHITE.clone() },
    },
  }), []);

  const planeGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // Per-plane materials cloned from the shared one so each plane can carry
  // its own layer index / channel uniform without affecting the others.
  // (Texture uniforms still point at the same shared painting/masks
  // textures, set when those load.)
  const planeMaterials = useMemo(() => layers.map(layer => {
    const m = baseMaterial.clone();
    m.uniforms.uLayerIdx.value = layer.idx;
    m.uniforms.uChannel.value  = layer.channel;
    return m;
  }), [layers, baseMaterial]);

  // Load painting + masks textures once meta is known. Pass them into
  // every plane's material.
  const [textures, setTextures] = useState(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const paintingUrl = `/data/theater/${encodeURIComponent(id)}.painting.webp`;
    const masksUrl    = `/data/theater/${encodeURIComponent(id)}.masks.png`;
    Promise.all([
      new Promise((res, rej) => loader.load(paintingUrl, res, undefined, rej)),
      new Promise((res, rej) => loader.load(masksUrl,    res, undefined, rej)),
    ]).then(([painting, masks]) => {
      if (cancelled) return;
      painting.colorSpace = THREE.SRGBColorSpace;
      // Mask is index data, not colour — keep it linear so nearest-neighbour
      // texel reads survive any colour transforms.
      masks.colorSpace  = THREE.NoColorSpace;
      masks.magFilter   = THREE.NearestFilter;
      masks.minFilter   = THREE.NearestFilter;
      masks.generateMipmaps = false;
      setTextures({ painting, masks });
    }).catch(() => {
      // Texture missing — keep the planes around but they'll render nothing.
    });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!textures) return;
    for (const m of planeMaterials) {
      m.uniforms.uPainting.value = textures.painting;
      m.uniforms.uMasks.value    = textures.masks;
    }
  }, [textures, planeMaterials]);

  // Sync metadata for the active painting.
  useEffect(() => {
    const isActiveSegment =
      mySegmentIndex === currentSegmentIndex ||
      mySegmentIndex === currentSegmentIndex + 1;
    if (!isActiveSegment || !meta) return;
    setCurrentResolution([meta.src?.width || 1000, meta.src?.height || 1000]);
  }, [mySegmentIndex, currentSegmentIndex, meta, setCurrentResolution]);

  // Dispose per-painting resources when the component unmounts or the id
  // swaps. baseMaterial and planeGeom are tied to the component lifetime;
  // textures + cloned materials regenerate per id.
  useEffect(() => () => {
    if (textures) {
      textures.painting.dispose();
      textures.masks.dispose();
    }
  }, [textures]);

  useEffect(() => () => {
    for (const m of planeMaterials) m.dispose();
  }, [planeMaterials]);

  useEffect(() => () => {
    baseMaterial.dispose();
    planeGeom.dispose();
  }, [baseMaterial, planeGeom]);

  // Camera distance → fade and colour-bleed envelope. Inside COLOR_HOT the
  // painting is at full saturation; past COLOR_GONE the hue is bone-white
  // only; past FADE_GONE the painting is invisible.
  useFrame(() => {
    if (!position) return;
    const v = tmpVec.current;
    v.set(position[0] || 0, position[1] || 0, position[2] || 0);
    const dist = camera.position.distanceTo(v);

    const fade  = 1.0 - THREE.MathUtils.smoothstep(dist, COLOR_GONE, FADE_GONE);
    const bleed = 1.0 - THREE.MathUtils.smoothstep(dist, COLOR_HOT,  COLOR_GONE);

    for (const m of planeMaterials) {
      m.uniforms.uIntensity.value  = fade;
      m.uniforms.uColorBleed.value = bleed;
    }
  });

  if (!meta || layers.length === 0 || planeMaterials.length === 0) return null;

  return (
    <group position={position} rotation={rotEuler}>
      {layers.map((L, i) => (
        <mesh
          key={i}
          geometry={planeGeom}
          material={planeMaterials[i]}
          position={[0, 0, L.z]}
          scale={[L.planeWidth, L.planeHeight, 1]}
        />
      ))}
    </group>
  );
}
