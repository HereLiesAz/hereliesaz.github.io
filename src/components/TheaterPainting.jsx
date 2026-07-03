import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store/useStore';

// World-height of every painting's central shell, and the depth of the
// shell from front to back. Each painting occupies a slab of 3D space
// `PAINTING_HEIGHT × aspect × SHELL_DEPTH`: a full-painting backdrop at
// the rear plus a handful of cutout flats in front — a paper theater.
const PAINTING_HEIGHT = 10.0;
const SHELL_DEPTH     = 6.0;

// Push the shell ahead of the painting's worldPos so the camera, which
// arrives at worldPos at each null, sees the painting at a comfortable
// reading distance instead of plunging into its near face.
//   front flat at  world z = worldPos.z - SHELL_FRONT
//   backdrop  at   world z = worldPos.z - SHELL_FRONT - SHELL_DEPTH
// Chosen so a 10-unit-tall painting at 50° FoV roughly fills the frame.
const SHELL_FRONT     = 11.0;

// Distance envelope: full colour inside FADE_FULL, gone past FADE_GONE.
// Paintings are SEGMENT_LENGTH=36 units apart. At the middle of a
// transit the camera sits ~18 units from each null; if FADE_FULL is
// also 18 the current painting hits zero exactly as the next hasn't
// yet risen, so the frame goes fully black. Widened past half-segment
// so BOTH dioramas are visible mid-transit and their flats interleave.
const FADE_FULL = 24.0;
const FADE_GONE = 44.0;

// When the camera's world z crosses a flat's z, the flat dissolves to
// black over this many units instead of clipping across the near plane.
const CROSS_FADE = 1.2;

// The backdrop is slightly oversized so lateral parallax never exposes
// its frame edge behind the cutout flats.
const BACKDROP_OVERSCAN = 1.08;


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

const flatVS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// A cutout flat: sample the painting and the depth map. Pixels whose depth
// falls outside this flat's band are discarded — the flat is the cut-paper
// silhouette of one depth stratum. The band threshold is jittered with a
// small hash noise so the cut edge tears organically instead of aliasing
// along iso-depth contours. uFade lerps toward black (the void), never
// toward transparency — flats are opaque cardboard, and real depth-writes
// keep occlusion honest.
const flatFS = /* glsl */ `
precision highp float;
uniform sampler2D uPainting;
uniform sampler2D uDepth;
uniform float uBandMin;    // band edges in [0,1] depth
uniform float uBandMax;
uniform float uBackdrop;   // 1.0 = full-bleed backdrop, no discard
uniform float uFade;       // 0 = black/void, 1 = full colour
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Bilinear value noise — smooth enough that the band threshold wanders in
// organic lobes (paper tears) rather than per-texel speckle.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i),                 hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y);
}

void main() {
  if (uBackdrop < 0.5) {
    float d = texture2D(uDepth, vUv).r;
    // Torn-paper edge: wander the band threshold with coarse lobes plus a
    // little fibre-scale fuzz.
    float tear = (vnoise(vUv * 48.0) - 0.5) * 0.05
               + (hash(vUv * 1024.0) - 0.5) * 0.012;
    float dj = d + tear;
    if (dj < uBandMin || dj >= uBandMax) discard;
  }
  vec3 painting = texture2D(uPainting, vUv).rgb;
  gl_FragColor = vec4(painting * uFade, 1.0);
}
`;


// ---- flat assembly ------------------------------------------------------------

// Build the paper theater from schema-2 metadata: one backdrop (the whole
// painting, rearmost) + one cutout flat per depth band. Band center depth
// t (0 = rearmost, 1 = frontmost) maps to
//   z(t)     = -(SHELL_FRONT + SHELL_DEPTH * (1 - t))
//   persp(t) =  (SHELL_FRONT + SHELL_DEPTH * (1 - t)) / SHELL_FRONT
// The perspective compensation makes every flat subtend exactly the same
// view from the null — head-on the flats reassemble into the original
// painting over the backdrop; any camera offset parts them into coherent
// physical parallax.
function buildFlats(metadata) {
  const bands = metadata?.depth?.bands;
  if (!bands || !Array.isArray(bands.edges) || !Array.isArray(bands.centers)) return [];
  const aspect = (metadata.src?.width || 1) / (metadata.src?.height || 1);
  const planeWidth  = PAINTING_HEIGHT * aspect;
  const planeHeight = PAINTING_HEIGHT;

  const depthAt = (t) => SHELL_FRONT + SHELL_DEPTH * (1 - t);

  const flats = [{
    kind: 'backdrop',
    bandMin: 0, bandMax: 1,
    z: -depthAt(0),
    persp: depthAt(0) / SHELL_FRONT,
    overscan: BACKDROP_OVERSCAN,
    planeWidth, planeHeight,
  }];

  for (let i = 0; i < bands.centers.length; i++) {
    // The rearmost band is already carried by the backdrop; a cutout copy
    // of it at the same depth would only z-fight.
    if (i === 0) continue;
    const t = bands.centers[i];
    flats.push({
      kind: 'flat',
      bandMin: bands.edges[i],
      bandMax: bands.edges[i + 1],
      z: -depthAt(t),
      persp: depthAt(t) / SHELL_FRONT,
      overscan: 1.0,
      planeWidth, planeHeight,
    });
  }
  return flats;
}


// ---- component --------------------------------------------------------------

export default function TheaterPainting({ id, image, position, rotation, mySegmentIndex }) {
  const [meta, setMeta] = useState(null);
  const [flatTex, setFlatTex] = useState(null);
  const currentSegmentIndex = useStore(s => s.currentSegmentIndex);
  const setCurrentResolution = useStore(s => s.setCurrentResolution);
  const tmpVec = useRef(new THREE.Vector3());

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetchTheaterMeta(id).then(json => {
      if (cancelled) return;
      // Only schema-2 metadata drives the layered shell; anything else
      // (legacy v1 json, missing bake) drops to the flat fallback below.
      const usable = json && json.schema === 2 && json.depth?.bands ? json : null;
      setMeta(usable);
      // Flat fallback: when the theater bake hasn't run for this id, render
      // the original asset image as a single textured plane instead of the
      // layered shell. Looks like the legacy gallery — no parallax — but
      // the page isn't blank.
      if (!usable && image) {
        const loader = new THREE.TextureLoader();
        loader.load(
          image,
          tex => {
            if (cancelled) { tex.dispose(); return; }
            tex.colorSpace = THREE.SRGBColorSpace;
            const w = tex.image?.width || 1;
            const h = tex.image?.height || 1;
            setFlatTex({ texture: tex, aspect: w / h, width: w, height: h });
          },
          undefined,
          () => { /* image missing — render nothing for this id */ },
        );
      }
    });
    return () => { cancelled = true; };
  }, [id, image]);

  const rotEuler = useMemo(() => {
    const r = rotation || [0, 0, 0];
    return new THREE.Euler(
      THREE.MathUtils.degToRad(r[0] || 0),
      THREE.MathUtils.degToRad(r[1] || 0),
      THREE.MathUtils.degToRad(r[2] || 0),
    );
  }, [rotation]);

  const flats = useMemo(() => meta ? buildFlats(meta) : [], [meta]);

  // Calculate dynamic scale to fit the painting into the screen at SHELL_FRONT.
  // Same math regardless of whether the layered shell or the flat fallback is
  // rendering — only the source of the aspect ratio differs (theater.json vs.
  // the raw asset image dimensions).
  const { size, camera } = useThree();
  const fitScale = useMemo(() => {
    let paintingWidth, paintingHeight;
    if (meta && flats.length > 0) {
      paintingWidth  = flats[0].planeWidth;
      paintingHeight = flats[0].planeHeight;
    } else if (flatTex) {
      paintingWidth  = PAINTING_HEIGHT * flatTex.aspect;
      paintingHeight = PAINTING_HEIGHT;
    } else {
      return 1.0;
    }

    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2.0 * SHELL_FRONT * Math.tan(vFov / 2.0);
    const visibleWidth  = visibleHeight * (size.width / size.height);
    const widthScale  = (visibleWidth  * 0.85) / paintingWidth;
    const heightScale = (visibleHeight * 0.90) / paintingHeight;
    return Math.min(widthScale, heightScale);
  }, [meta, flats, flatTex, size.width, size.height, camera.fov]);

  const planeGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  // One material per flat: opaque, depth-writing paper. Texture uniforms
  // point at the shared painting/depth textures once those load.
  const flatMaterials = useMemo(() => flats.map(flat => new THREE.ShaderMaterial({
    vertexShader:   flatVS,
    fragmentShader: flatFS,
    transparent:    false,
    depthWrite:     true,
    // Paper is visible from backstage too — the camera's orbit passes
    // behind the shell mid-transition, and single-sided flats would
    // vanish into a black beat there.
    side:           THREE.DoubleSide,
    uniforms: {
      uPainting: { value: null },
      uDepth:    { value: null },
      uBandMin:  { value: flat.bandMin },
      uBandMax:  { value: flat.bandMax },
      uBackdrop: { value: flat.kind === 'backdrop' ? 1 : 0 },
      uFade:     { value: 0 },
    },
  })), [flats]);

  // Load painting + depth textures once meta is known. Pass them into
  // every flat's material.
  const [textures, setTextures] = useState(null);
  useEffect(() => {
    if (!id || !meta) return;
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const paintingUrl = `/data/theater/${encodeURIComponent(id)}.painting.webp`;
    const depthUrl    = `/data/theater/${encodeURIComponent(meta.depth.file || `${id}.depth.png`)}`;
    Promise.all([
      new Promise((res, rej) => loader.load(paintingUrl, res, undefined, rej)),
      new Promise((res, rej) => loader.load(depthUrl,    res, undefined, rej)),
    ]).then(([painting, depth]) => {
      if (cancelled) return;
      painting.colorSpace = THREE.SRGBColorSpace;
      painting.anisotropy = 4;
      // Depth is data, not colour — keep it linear. (Browsers decode the
      // 16-bit PNG to 8 bits per channel; 256 depth levels is far more
      // than the ~6 bands need.)
      depth.colorSpace = THREE.NoColorSpace;
      depth.generateMipmaps = false;
      depth.minFilter = THREE.LinearFilter;
      setTextures({ painting, depth });
    }).catch(() => {
      // Texture missing — keep the flats around but they'll render nothing.
    });
    return () => { cancelled = true; };
  }, [id, meta]);

  useEffect(() => {
    if (!textures) return;
    for (const m of flatMaterials) {
      m.uniforms.uPainting.value = textures.painting;
      m.uniforms.uDepth.value    = textures.depth;
    }
  }, [textures, flatMaterials]);

  // Push the active painting's source resolution to the store so the overlay
  // stays coherent. Works for both modes: prefer the theater metadata's src
  // dims, fall back to the flat texture's natural dims.
  useEffect(() => {
    const isActiveSegment =
      mySegmentIndex === currentSegmentIndex ||
      mySegmentIndex === currentSegmentIndex + 1;
    if (!isActiveSegment) return;
    if (meta) {
      setCurrentResolution([meta.src?.width || 1000, meta.src?.height || 1000]);
    } else if (flatTex) {
      setCurrentResolution([flatTex.width, flatTex.height]);
    }
  }, [mySegmentIndex, currentSegmentIndex, meta, flatTex, setCurrentResolution]);

  // Dispose per-painting resources when the component unmounts or the id
  // swaps. planeGeom is tied to the component lifetime; textures + flat
  // materials regenerate per id.
  useEffect(() => () => {
    if (textures) {
      textures.painting.dispose();
      textures.depth.dispose();
    }
  }, [textures]);

  useEffect(() => () => {
    for (const m of flatMaterials) m.dispose();
  }, [flatMaterials]);

  useEffect(() => () => {
    planeGeom.dispose();
  }, [planeGeom]);

  useEffect(() => () => {
    if (flatTex?.texture) flatTex.texture.dispose();
  }, [flatTex]);

  // Shared material for the flat fallback. Created once and updated per-frame
  // so it picks up the same distance fade as the layered shell.
  const fallbackMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide }),
    [],
  );
  useEffect(() => () => fallbackMaterial.dispose(), [fallbackMaterial]);
  useEffect(() => {
    if (flatTex) fallbackMaterial.map = flatTex.texture;
    fallbackMaterial.needsUpdate = true;
  }, [flatTex, fallbackMaterial]);

  // Camera distance → fade envelope, plus the fly-through dissolve: a flat
  // the camera is about to cross fades to black over CROSS_FADE units so
  // the shell can be scrubbed through like theater flats, never clipped.
  useFrame(() => {
    if (!position) return;
    const v = tmpVec.current;
    v.set(position[0] || 0, position[1] || 0, position[2] || 0);
    const dist = camera.position.distanceTo(v);
    const fade = 1.0 - THREE.MathUtils.smoothstep(dist, FADE_FULL, FADE_GONE);

    for (let i = 0; i < flatMaterials.length; i++) {
      const flatWorldZ = v.z + flats[i].z;
      const cross = Math.min(
        Math.abs(camera.position.z - flatWorldZ) / CROSS_FADE, 1.0);
      flatMaterials[i].uniforms.uFade.value = fade * cross;
    }
    // Fallback plane: same envelope, applied as a colour dim so it stays
    // opaque too.
    fallbackMaterial.color.setScalar(fade);
  });

  // Flat fallback render — single textured plane at the shell-front depth.
  if (!meta && flatTex) {
    const fw = PAINTING_HEIGHT * flatTex.aspect * fitScale;
    const fh = PAINTING_HEIGHT * fitScale;
    return (
      <group position={position} rotation={rotEuler}>
        <mesh
          geometry={planeGeom}
          material={fallbackMaterial}
          position={[0, 0, -SHELL_FRONT]}
          scale={[fw, fh, 1]}
        />
      </group>
    );
  }

  if (!meta || flats.length === 0 || flatMaterials.length === 0) return null;

  return (
    <group position={position} rotation={rotEuler}>
      {flats.map((F, i) => (
        <mesh
          key={i}
          geometry={planeGeom}
          material={flatMaterials[i]}
          position={[0, 0, F.z]}
          scale={[
            F.planeWidth  * fitScale * F.persp * F.overscan,
            F.planeHeight * fitScale * F.persp * F.overscan,
            1,
          ]}
        />
      ))}
    </group>
  );
}
