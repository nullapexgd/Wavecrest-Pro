// GLSL for the relief, its skirt, the contact shadow, the pennants and the sounding lead.
// One studio light (upper left, slightly in front) and one cool fill, shared by everything,
// so a pennant and the ceramic it stands on are lit by the same sun.

const COMMON = /* glsl */ `
  uniform vec3 uPaper; uniform vec3 uPaper2; uniform vec3 uLit; uniform vec3 uShade;
  uniform vec3 uInk; uniform vec3 uTide; uniform vec3 uSignal;
  uniform vec3 uMetalLo; uniform vec3 uMetalHi; uniform vec3 uShadowCol;
  const vec3 KEY = vec3(-0.5464, 0.7749, 0.3179);
  const vec3 FILL = vec3(0.62, 0.30, -0.55);

  vec3 ceramic(vec3 N, float h) {
    float wrap = clamp(dot(N, KEY), -1.0, 1.0) * 0.5 + 0.5;
    float fill = clamp(dot(N, FILL) * 0.5 + 0.5, 0.0, 1.0);
    vec3 c = mix(uShade, uLit, smoothstep(0.22, 0.90, wrap));
    c = mix(c, uPaper, 0.18 * fill);
    return c * mix(0.80, 1.0, smoothstep(0.0, 0.30, h)); // valleys sit a little darker
  }
  // anti-aliased iso-line of a scalar: 1 on the line, 0 elsewhere (about one pixel wide)
  float iso(float v) {
    float f = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(0.5, 1.5, f);
  }
`;

export const reliefVert = /* glsl */ `
  uniform float uAmp;
  attribute float aH; attribute vec2 aG;
  varying float vH; varying vec3 vN; varying vec2 vUv;
  void main() {
    vec3 p = position; p.y = aH * uAmp;
    vH = aH; vUv = uv;
    vN = normalize(vec3(-aG.x * uAmp, 1.0, -aG.y * uAmp));
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`;

export const reliefFrag = /* glsl */ `
  ${COMMON}
  uniform float uContour; uniform float uCrestH; uniform float uMarkMix;
  uniform sampler2D uMarks; uniform vec4 uHover; uniform vec2 uWorld;
  varying float vH; varying vec3 vN; varying vec2 vUv;
  void main() {
    vec3 col = ceramic(normalize(vN), vH);

    // crest paint first, so the contour lines still run across it and it reads as terrain
    float above = smoothstep(uCrestH - 0.01, uCrestH + 0.04, vH);
    col = mix(col, uSignal * mix(0.86, 1.0, ceramic(normalize(vN), vH).r), above * 0.88);
    col = mix(col, uInk, iso(vH * uContour) * 0.22 + iso(vH * uContour / 5.0) * 0.42);
    float tline = 1.0 - smoothstep(0.5, 1.5, abs(vH - uCrestH) / max(fwidth(vH), 1e-5));
    col = mix(col, uInk, tline * 0.8);

    vec4 m = texture2D(uMarks, vUv);
    col = mix(col, m.rgb, m.a * uMarkMix);

    float r = length((vUv - uHover.xy) * uWorld);
    float ring = 1.0 - smoothstep(0.5, 1.5, abs(r - uHover.z) / max(fwidth(r), 1e-5));
    col = mix(col, uInk, ring * uHover.w);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export const skirtVert = /* glsl */ `
  uniform float uAmp; uniform float uSkirt;
  attribute float aH; attribute float aT;
  varying float vT; varying vec3 vN;
  void main() {
    vec3 p = position; p.y = mix(aH * uAmp, -uSkirt, aT);
    vT = aT; vN = normalize(normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(p, 1.0);
  }
`;

export const skirtFrag = /* glsl */ `
  ${COMMON}
  varying float vT; varying vec3 vN;
  void main() {
    vec3 col = ceramic(normalize(vN), 0.4);
    col = mix(col, uInk, 0.16);
    col *= mix(1.0, 0.78, vT);
    col = mix(uInk, col, smoothstep(0.0, 0.05, vT)); // a hairline where the top surface ends
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export const shadowVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;

export const shadowFrag = /* glsl */ `
  ${COMMON}
  uniform vec2 uPlane; uniform vec2 uHalf; uniform vec2 uOffset; uniform float uStrength;
  varying vec2 vUv;
  float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  void main() {
    vec2 p = (vUv - 0.5) * uPlane - uOffset;
    float d = sdBox(p, uHalf, 0.08);
    float a = (1.0 - smoothstep(-0.04, 0.85, d)) * uStrength;
    gl_FragColor = vec4(uShadowCol, a);
    #include <colorspace_fragment>
  }
`;

export const pennantVert = /* glsl */ `
  uniform float uAmp; uniform float uTime; uniform float uFlutter; uniform float uScale; uniform float uPlant;
  attribute float aPeak; attribute float aPhase;
  varying vec3 vN; varying float vCloth;
  void main() {
    float s = uScale * uPlant;
    vec3 p = position * s;
    float w = uv.x;
    float wave = 0.5 * sin(uTime * 4.2 + aPhase + w * 7.0) + 0.5 * sin(uTime * 2.3 + aPhase * 1.7 + w * 3.0);
    p.z += wave * 0.11 * w * w * uFlutter * s;
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    wp.y += aPeak * uAmp;
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vCloth = w;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const pennantFrag = /* glsl */ `
  ${COMMON}
  uniform float uIsPole;
  varying vec3 vN; varying float vCloth;
  void main() {
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    float k = clamp(dot(N, KEY), -1.0, 1.0) * 0.5 + 0.5;
    vec3 col = uIsPole > 0.5
      ? mix(uMetalLo, uMetalHi, smoothstep(0.1, 0.95, k))
      : uSignal * mix(0.72, 1.06, k);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export const leadVert = /* glsl */ `
  varying vec3 vN; varying vec3 vP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vP = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const leadFrag = /* glsl */ `
  ${COMMON}
  varying vec3 vN; varying vec3 vP;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vP);
    float k = clamp(dot(N, KEY), -1.0, 1.0) * 0.5 + 0.5;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6);
    vec3 col = mix(uMetalLo, uMetalHi, smoothstep(0.12, 0.96, k));
    col = mix(col, uMetalHi, rim * 0.35);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
