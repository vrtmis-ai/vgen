"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A drifting cloud of lit particles that flinches away from the pointer.
 *
 * Adapted from the "quantum nebula" scene the design asked for, with two
 * changes it could not ship without.
 *
 * **The simulation moved to the GPU.** The original stepped all 50,000
 * particles in JavaScript every frame, allocating several `THREE.Vector3` per
 * particle as it went — about a quarter of a million objects a frame, which is
 * a stalled main thread and a garbage collector that never catches up. The
 * curl-noise field it wanted is the same one written out in GLSL at the bottom
 * of that file and never used; it lives in the vertex shader here, where the
 * whole cloud costs one draw call and nothing per frame on the CPU.
 *
 * **The bloom pass is gone.** `UnrealBloomPass` renders the scene several more
 * times at half resolution for a glow, which is a lot to ask of a 200px tile
 * that four of may be on screen. Additive blending of soft sprites with a hot
 * core gives the same read at no cost.
 *
 * What stayed: the look, the pointer repulsion, and the parallax. The pointer
 * is tracked on this element rather than on `window` — the original divided by
 * `window.innerWidth`, which is only correct when the scene is the page.
 */

const VERTEX = /* glsl */ `
  attribute vec3 seed;
  varying vec3 vColor;
  varying float vFade;
  uniform float u_time;
  uniform float u_size;
  uniform float u_scale;
  uniform float u_amplitude;
  uniform vec3 u_pointer;
  uniform float u_push;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  vec3 snoiseVec3(vec3 x) {
    return vec3(
      snoise(x),
      snoise(vec3(x.y - 19.1, x.z + 33.4, x.x + 47.2)),
      snoise(vec3(x.z + 74.2, x.x - 124.5, x.y + 99.4))
    );
  }

  /* Curl of the noise field: divergence-free, so the cloud swirls instead of
     collecting in the places the raw noise happens to point at. */
  vec3 curl(vec3 p) {
    const float e = 0.08;
    vec3 dx = vec3(e, 0.0, 0.0);
    vec3 dy = vec3(0.0, e, 0.0);
    vec3 dz = vec3(0.0, 0.0, e);
    vec3 ox = snoiseVec3(p + dx) - snoiseVec3(p - dx);
    vec3 oy = snoiseVec3(p + dy) - snoiseVec3(p - dy);
    vec3 oz = snoiseVec3(p + dz) - snoiseVec3(p - dz);
    return normalize(vec3(oy.z - oz.y, oz.x - ox.z, ox.y - oy.x));
  }

  void main() {
    vColor = color;

    /* Displaced along the field rather than advected through it. A true
       advection needs last frame's positions, which needs a second buffer and
       a ping-pong pass; the phase shift reads the same at this size and keeps
       the cloud inside its box for as long as a generation runs. */
    vec3 p = position + curl(position * u_scale + vec3(u_time * 0.08)) * u_amplitude;

    // The pointer pushes a soft bubble through the cloud.
    vec3 away = p - u_pointer;
    float d = length(away);
    p += normalize(away + 0.0001) * u_push * exp(-d * d * 0.55);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    /* Two falloffs, and without either this reads as a wall of lime rather
       than a cloud. Depth, because it is the only cue a field of points has;
       and distance from the middle, so the thing has edges and the tile keeps
       some dark for the label to sit on. */
    float depth = clamp(1.0 - (-mv.z - 2.0) / 6.0, 0.12, 1.0);
    float radial = smoothstep(1.25, 0.25, length(p) / 2.5);
    vFade = depth * radial;
    gl_PointSize = u_size * (10.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vFade;

  void main() {
    // A soft disc with a hot centre. The centre is what reads as glow once
    // these are blended additively, which is what the bloom pass was for.
    float d = distance(gl_PointCoord, vec2(0.5));
    float disc = smoothstep(0.5, 0.0, d);
    float core = smoothstep(0.22, 0.0, d);
    float a = (disc * 0.40 + core * 0.85) * vFade;
    if (a < 0.008) discard;
    gl_FragColor = vec4(vColor * (0.72 + core * 0.9), a);
  }
`;

export interface QuantumNebulaProps {
  /** Base hue in degrees. Defaults to the brand's lime. */
  hue?: number;
  /** Spread of hue around the base, in degrees. */
  hueVariance?: number;
  /** Particles per 1000 css pixels of the element; clamped to a sane range. */
  density?: number;
  className?: string;
}

/* The brand is #C6F52E — hue 74 in HSL, a yellow-green. The original scene sat
   at 200 (cyan), which is the one hue this product does not own. */
const BRAND_HUE = 74;

export default function QuantumNebula({ hue = BRAND_HUE, hueVariance = 26, density = 20, className }: QuantumNebulaProps) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    let width = host.clientWidth;
    let height = host.clientHeight;
    if (width === 0 || height === 0) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power" });
    } catch {
      // No context to be had — the caller's CSS field stays as it is.
      return;
    }
    // 1.75 rather than the device's own: a nebula is all soft edges, and the
    // pixels past this point cost fill rate without being visible.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(width, height, false);
    renderer.setClearAlpha(0);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
    camera.position.z = 5.4;

    const BOX = 5;
    const count = Math.round(Math.min(26000, Math.max(2600, (width * height * density) / 1000)));
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * BOX;
      positions[i3 + 1] = (Math.random() - 0.5) * BOX;
      positions[i3 + 2] = (Math.random() - 0.5) * BOX;
      tint.setHSL(((hue + (Math.random() - 0.5) * hueVariance) % 360) / 360, 0.85, 0.55 + Math.random() * 0.2);
      colors[i3] = tint.r;
      colors[i3 + 1] = tint.g;
      colors[i3 + 2] = tint.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_time: { value: 0 },
        u_size: { value: 1.55 * renderer.getPixelRatio() },
        u_scale: { value: 0.55 },
        u_amplitude: { value: 0.9 },
        u_pointer: { value: new THREE.Vector3(0, 0, 40) },
        u_push: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // Where the pointer is, in the field's own space, and how hard it pushes.
    const pointer = new THREE.Vector3(0, 0, 40);
    let push = 0;
    let wantPush = 0;

    /* Listened for on the window but measured against this element.
       The veil it lives in is `pointer-events: none` — it lies over a card
       that opens a result, and a cloud that swallowed that click would be a
       worse trade than a cloud that ignores the mouse. So the events are taken
       where they are allowed to land and mapped in here, which is also what
       makes the reaction correct for a 200px tile: the original divided by
       `window.innerWidth`, and was only ever right full-screen.

       The push falls away outside the element's own bounds, with a margin, so
       the cloud answers a pointer approaching it rather than one anywhere on
       the page. */
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      pointer.set((x - 0.5) * BOX, -(y - 0.5) * BOX, 0);
      const outside = Math.max(0, -x, x - 1, -y, y - 1);
      wantPush = outside > 0.35 ? 0 : 0.55 * (1 - outside / 0.35);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let frame = 0;
    let visible = true;
    const clock = new THREE.Clock();

    const render = () => {
      const t = clock.getElapsedTime();
      material.uniforms.u_time!.value = t;
      // Eased in and out, so the bubble does not snap open under the cursor.
      push += (wantPush - push) * 0.08;
      material.uniforms.u_push!.value = push;
      material.uniforms.u_pointer!.value.copy(pointer);
      // A slow turn of the whole cloud, which is the motion that carries while
      // the noise phase only shimmers.
      points.rotation.y = t * 0.035;
      points.rotation.x = Math.sin(t * 0.09) * 0.12;
      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = requestAnimationFrame(loop);
      render();
    };

    const start = () => {
      if (frame) return;
      clock.getDelta();
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (!frame) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // Off-screen tiles and a backgrounded tab cost nothing.
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !document.hidden) start();
      else stop();
    });
    io.observe(host);
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0 || (w === width && h === height)) return;
      width = w;
      height = h;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      render();
    });
    ro.observe(host);

    start();

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      // Hands the context back now rather than when the GC gets to it: a
      // browser allows a small number of live contexts, and a studio can open
      // and close several of these in a minute.
      renderer.forceContextLoss();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, [hue, hueVariance, density]);

  return <div ref={mount} className={className} />;
}
