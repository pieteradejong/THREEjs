// crystal.js: the breathing crystal. Built once; update(channels, time) each frame.
//
//   shell   flat-faceted icosahedron, glass-like (transmission + iridescence). Its facets drift
//           apart and back along their own normals: the breath. Load sets depth and rate.
//   edges   the same facets as a glowing wireframe, breathing with the shell (same shader patch)
//   core    emissive inner gem + a point light, coloured by temperature
//   shards  4 small octahedra around the core, one per CPU core, swelling with that core's load
//   rings   3 tilted orbits with beads, spinning with the fan
//   dust    a GPU point field: WiFi signal sets how much of it sparkles
//   fog     memory use thickens the haze (set on the scene by main.js)
import * as THREE from 'three';
import { breathAmplitude, breathRate, heatColor, ringSpeed, CORES } from './mapping.js';

// Patch a built-in material so every vertex moves along its facet normal (the `normal`
// attribute, which every material declares; computeVertexNormals on a non-indexed geometry
// makes it the flat facet normal) by
// uBreath * a per-facet phase. All three vertices of a facet share the normal and the phase,
// so each facet moves as one rigid tile.
function addBreath(material, uniforms) {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uAmp;
uniform float uRate;
attribute float aPhase;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
float breath = 0.5 + 0.5 * sin(uTime * uRate + aPhase * 6.2831853);
transformed += normalize(normal) * uAmp * breath;`);
    };
    material.customProgramCacheKey = () => 'pi-crystal-breath';
}

// One random phase per facet (a non-indexed geometry has 3 vertices per facet).
function facetPhases(geometry, rand) {
    const n = geometry.attributes.position.count;
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
        const p = rand();
        phase[i] = phase[i + 1] = phase[i + 2] = p;
    }
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
}

// Small seeded PRNG (mulberry32), so the crystal looks the same on every load.
function prng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const WHITE = new THREE.Color(0xffffff);

const DUST_VERT = `
uniform float uTime;
uniform float uWifi;
uniform float uPixelRatio;
attribute float aSeed;
varying float vAlpha;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // A point is "lit" when its seed is under the signal strength; lit points twinkle.
    float lit = step(aSeed, uWifi);
    float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 4.0) + aSeed * 60.0);
    vAlpha = mix(0.05, 0.2 + 0.7 * tw, lit);
    gl_PointSize = (1.0 + 2.2 * lit * tw) * uPixelRatio * (10.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
}`;

export class Crystal {
    constructor(scene, { pixelRatio = 1, dustCount = 1800 } = {}) {
        const rand = prng(20261118);
        this.group = new THREE.Group();
        scene.add(this.group);
        this.breath = { uTime: { value: 0 }, uAmp: { value: 0.1 }, uRate: { value: 1 } };

        // Shell: icosahedron detail 1 = 80 facets, non-indexed, flat normals.
        const shellGeo = new THREE.IcosahedronGeometry(1.35, 1);
        shellGeo.computeVertexNormals(); // flat facet normals: each facet moves as one tile
        facetPhases(shellGeo, rand);
        this.shellMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, metalness: 0, roughness: 0.12,
            transmission: 1, thickness: 1.2, ior: 1.7,
            attenuationColor: new THREE.Color(0x40d8ff), attenuationDistance: 2.6,
            iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 520],
            clearcoat: 1, clearcoatRoughness: 0.05,
            emissive: new THREE.Color(0x000000), flatShading: true, side: THREE.DoubleSide,
        });
        addBreath(this.shellMat, this.breath);
        this.shell = new THREE.Mesh(shellGeo, this.shellMat);
        this.group.add(this.shell);

        this.edgeMat = new THREE.MeshBasicMaterial({
            color: 0x9fe8ff, wireframe: true, transparent: true, opacity: 0.2,
            blending: THREE.AdditiveBlending, depthWrite: false,
        });
        addBreath(this.edgeMat, this.breath);
        this.edges = new THREE.Mesh(shellGeo, this.edgeMat);
        this.edges.scale.setScalar(1.002);
        this.group.add(this.edges);

        // Core: a gem and the light it casts through the shell.
        this.coreMat = new THREE.MeshStandardMaterial({
            color: 0x111111, emissive: new THREE.Color(0x40d8ff), emissiveIntensity: 2.5,
            roughness: 0.3, metalness: 0.1, flatShading: true,
        });
        this.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), this.coreMat);
        this.group.add(this.core);
        this.light = new THREE.PointLight(0x40d8ff, 3, 8, 1.4);
        this.group.add(this.light);

        // Shards: one per CPU core, on the corners of a tetrahedron around the core.
        const corners = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
        this.shardPivot = new THREE.Group();
        this.group.add(this.shardPivot);
        this.shards = [];
        const shardGeo = new THREE.OctahedronGeometry(0.11, 0);
        for (let i = 0; i < CORES; i++) {
            const m = new THREE.Mesh(shardGeo, new THREE.MeshStandardMaterial({
                color: 0x0a0a0a, emissive: new THREE.Color(0xffffff), emissiveIntensity: 1,
                flatShading: true,
            }));
            m.position.set(...corners[i]).normalize().multiplyScalar(0.82);
            this.shardPivot.add(m);
            this.shards.push(m);
        }

        // Rings: thin tori with beads (a bare torus spinning about its axis looks still).
        this.rings = [];
        const tilts = [[1.2, 0.2, 0], [0.35, 1.1, 0.4], [-0.6, 0.3, 1.0]];
        [2.05, 2.4, 2.8].forEach((r, i) => {
            const pivot = new THREE.Group();
            pivot.rotation.set(...tilts[i]);
            const spin = new THREE.Group();
            pivot.add(spin);
            const mat = new THREE.MeshBasicMaterial({
                color: 0x7fdcff, transparent: true, opacity: 0.55,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            spin.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 6, 256), mat));
            const beadGeo = new THREE.SphereGeometry(0.035, 12, 8);
            const beads = 3 + i;
            for (let b = 0; b < beads; b++) {
                const a = (b / beads) * Math.PI * 2;
                const bead = new THREE.Mesh(beadGeo, mat);
                bead.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
                spin.add(bead);
            }
            this.group.add(pivot);
            this.rings.push({ spin, mat, dir: i % 2 ? -1 : 1, factor: 1 - i * 0.22 });
        });

        // Dust: a shell of points between radius 3.2 and 7.
        const pos = new Float32Array(dustCount * 3);
        const seed = new Float32Array(dustCount);
        for (let i = 0; i < dustCount; i++) {
            const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 3.2 + Math.pow(rand(), 0.7) * 3.8;
            const s = Math.sqrt(1 - u * u);
            pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
            seed[i] = rand();
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
        this.dustUniforms = {
            uTime: { value: 0 }, uWifi: { value: 0.6 }, uPixelRatio: { value: pixelRatio },
            uColor: { value: new THREE.Color(0xbfeaff) },
        };
        this.dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
            uniforms: this.dustUniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        }));
        scene.add(this.dust);

        this._color = new THREE.Color();
        this._red = new THREE.Color(1, 0.08, 0.05);
        this._glow = new THREE.Color();
        this._ringPhase = [0, 0, 0];
    }

    setPixelRatio(pr) { this.dustUniforms.uPixelRatio.value = pr; }

    // ch: smoothed channels from mapping.js (all 0..1). time, dt in seconds.
    update(ch, time, dt) {
        const [r, g, b] = heatColor(ch.heat);
        const heat = this._color.setRGB(r, g, b, THREE.SRGBColorSpace);
        // Throttling: a hard red flicker over everything that glows.
        const flick = ch.throttle * (0.55 + 0.45 * Math.sign(Math.sin(time * 23.0)));
        const glow = this._glow.copy(heat).lerp(this._red, ch.throttle * 0.8);

        this.breath.uTime.value = time;
        this.breath.uAmp.value = breathAmplitude(ch.load);
        this.breath.uRate.value = breathRate(ch.load);

        this.coreMat.emissive.copy(glow);
        this.coreMat.emissiveIntensity = 3 + ch.heat * 4 + ch.load * 2 + flick * 3;
        this.light.color.copy(glow);
        this.light.intensity = 3 + ch.heat * 8 + ch.load * 3;
        this.core.rotation.y += dt * (0.3 + ch.load * 1.5);
        this.core.rotation.x += dt * 0.17;
        const pulse = 1 + 0.06 * Math.sin(time * breathRate(ch.load) * 1.3);
        this.core.scale.setScalar(pulse * (0.9 + ch.heat * 0.3));

        this.shellMat.emissive.copy(glow).multiplyScalar(0.02 + ch.heat * 0.06 + flick * 0.25);
        this.shellMat.attenuationColor.copy(glow);
        this.edgeMat.color.copy(glow).lerp(WHITE, 0.35);
        this.edgeMat.opacity = 0.16 + ch.load * 0.3 + flick * 0.3;

        this.shardPivot.rotation.y += dt * (0.25 + ch.load * 0.9);
        this.shardPivot.rotation.z += dt * 0.11;
        this.shards.forEach((s, i) => {
            const c = ch.cores[i];
            s.scale.setScalar(0.7 + c * 1.6);
            s.material.emissive.copy(glow).lerp(WHITE, 0.5 - c * 0.4);
            s.material.emissiveIntensity = 0.6 + c * 4;
            s.rotation.x += dt * (1 + c * 6);
        });

        this.rings.forEach((ring, i) => {
            this._ringPhase[i] += dt * ringSpeed(ch.fan) * ring.factor * ring.dir;
            ring.spin.rotation.z = this._ringPhase[i];
            ring.mat.color.copy(glow).lerp(WHITE, 0.25);
            ring.mat.opacity = 0.25 + ch.fan * 0.45;
        });

        this.dustUniforms.uTime.value = time;
        this.dustUniforms.uWifi.value = ch.wifi;
        this.dust.rotation.y += dt * 0.02;
        this.group.rotation.y += dt * 0.05;
    }
}
