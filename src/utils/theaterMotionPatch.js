import * as THREE from 'three';

// The Paper Theater renderer deliberately uses one plane per depth band. The
// original vertex shader left every plane centered at x/y=0 and relied almost
// entirely on z separation plus fragment-edge noise, so from the camera's
// mostly head-on view the artwork still read as one intact sheet. This patch
// keeps the exact coalesced/null view, but physically scatters and rotates each
// depth-band plane while it is away from its null. It is installed before the
// first React render, so every TheaterPainting ShaderMaterial receives the
// motion-aware vertex shader without changing the native theater data format.

const originalSetValues = THREE.ShaderMaterial.prototype.setValues;

const tornVertexShader = /* glsl */ `
varying vec2 vUv;
uniform float uBandMin;
uniform float uBandMax;
uniform float uWipe;

float bandHash(float n) {
  return fract(sin(n * 9283.173 + 17.31) * 43758.5453123);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vUv = uv;

  // uWipe is 1 exactly at the painting's resolved/null moment and falls
  // toward 0 while entering/leaving. That makes the original painting
  // reconstruct perfectly at the null while the same planes become a real
  // spatial cloud between paintings.
  float chaos = pow(clamp(1.0 - uWipe, 0.0, 1.0), 0.72);
  float band = (uBandMin + uBandMax) * 0.5;

  float r0 = bandHash(band + 0.11);
  float r1 = bandHash(band + 1.73);
  float r2 = bandHash(band + 3.91);
  float r3 = bandHash(band + 7.17);
  float r4 = bandHash(band + 11.53);

  vec3 p = position;

  // Give every depth slice a different torn-paper attitude. Rotation around
  // Z is strongest because it visibly breaks the silhouette; X/Y tilt makes
  // the pieces catch perspective as the camera threads through them.
  float rz = (r0 * 2.0 - 1.0) * 0.62 * chaos;
  p.xy = rot2(rz) * p.xy;

  float rx = (r1 * 2.0 - 1.0) * 0.38 * chaos;
  float ry = (r2 * 2.0 - 1.0) * 0.42 * chaos;
  float cx = cos(rx), sx = sin(rx);
  float cy = cos(ry), sy = sin(ry);
  p.yz = mat2(cx, -sx, sx, cx) * p.yz;
  p.xz = mat2(cy, sy, -sy, cy) * p.xz;

  // Local x/y offsets are intentionally large: modelMatrix subsequently
  // scales them by the painting's real plane dimensions, so the bands open
  // into visibly separated scraps instead of a barely perceptible parallax
  // stack. The z kick gives the camera something to fly between.
  vec2 drift = vec2(r3 * 2.0 - 1.0, r4 * 2.0 - 1.0);
  p.xy += drift * vec2(0.52, 0.42) * chaos;
  p.z += (bandHash(band + 19.07) * 2.0 - 1.0) * 2.6 * chaos;

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

THREE.ShaderMaterial.prototype.setValues = function patchedSetValues(values) {
  if (
    values &&
    typeof values.vertexShader === 'string' &&
    typeof values.fragmentShader === 'string' &&
    values.fragmentShader.includes('uniform float uBandMin;') &&
    values.fragmentShader.includes('uniform float uWipe;') &&
    values.uniforms?.uBandMin &&
    values.uniforms?.uBandMax &&
    values.uniforms?.uWipe
  ) {
    values = { ...values, vertexShader: tornVertexShader };

    // Make the masks themselves read as fibrous torn paper rather than smooth
    // topographic contours. These are narrow, targeted replacements of the
    // known TheaterPainting shader constants; if that shader changes later,
    // failure is benign and the original fragment shader is used unchanged.
    values.fragmentShader = values.fragmentShader
      .replace(
        '(vnoise(vUv * 48.0) - 0.5) * 0.05\n               + (vnoise(vUv * 320.0) - 0.5) * 0.012',
        '(vnoise(vUv * 48.0) - 0.5) * 0.095\n               + (vnoise(vUv * 320.0) - 0.5) * 0.026',
      )
      .replace(
        '(vnoise(vUv * 40.0) - 0.5) * 0.06',
        '(vnoise(vUv * 40.0) - 0.5) * 0.13',
      );
  }
  return originalSetValues.call(this, values);
};

// AnamorphicCam is the only live CatmullRomCurve3 consumer in the app. Its
// existing route already dives toward the shared hinge, but the generated
// curve is conservative and the quintic easing makes the middle feel like a
// restrained dolly. Preserve both endpoint/null positions exactly, then add a
// transient lateral arc and amplify the route's existing deviation through the
// middle. Reduced-motion users retain the original path unchanged.
const originalGetPointAt = THREE.CatmullRomCurve3.prototype.getPointAt;
const baseline = new THREE.Vector3();
const chord = new THREE.Vector3();
const deviation = new THREE.Vector3();
const side = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const altAxis = new THREE.Vector3(1, 0, 0);

THREE.CatmullRomCurve3.prototype.getPointAt = function dramaticGetPointAt(u, target) {
  const out = originalGetPointAt.call(this, u, target);
  if (
    !Array.isArray(this.points) ||
    this.points.length !== 11 ||
    u <= 0 ||
    u >= 1 ||
    (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  ) {
    return out;
  }

  const start = this.points[0];
  const end = this.points[this.points.length - 1];
  baseline.copy(start).lerp(end, u);
  deviation.copy(out).sub(baseline).multiplyScalar(1.65);
  out.copy(baseline).add(deviation);

  chord.copy(end).sub(start);
  const chordLength = chord.length();
  if (chordLength > 1e-4) {
    chord.normalize();
    side.crossVectors(chord, up);
    if (side.lengthSq() < 1e-5) side.crossVectors(chord, altAxis);
    side.normalize();

    // Zero at both nulls, strongest around the chaotic middle. The sign is
    // derived from the curve itself so adjacent moves do not all sweep in the
    // same screen direction.
    const sign = Math.sin((start.x + start.z + end.y) * 0.73) < 0 ? -1 : 1;
    const arc = Math.sin(Math.PI * u);
    const lateral = Math.min(5.0, chordLength * 0.16) * arc * sign;
    out.addScaledVector(side, lateral);
    out.y += Math.sin(Math.PI * 2.0 * u) * Math.min(1.8, chordLength * 0.045) * arc;
  }

  return out;
};
