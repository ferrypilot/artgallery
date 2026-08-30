"use client";

/* ============================================================
   Gallery.jsx — Next.js 프로젝트용 R3F 전시장
   ------------------------------------------------------------
   설치:
     npm i three @react-three/fiber @react-three/drei

   사용:
     <Gallery works={works} />
     works = [{ id, title, artist, note, videoUrl, posterUrl, wall, at }]
     wall: "L" | "R" | "B" | "P+" | "P-"   at: 벽 위 좌표(m)

   Supabase 등에서 학생 작품을 fetch 해서 그대로 넘기면 됩니다.
   ============================================================ */

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import * as THREE from "three";

const ROOM = { w: 24, d: 14, h: 4.2 };
const PLAY_RADIUS = 7.5;  // 이 안에 들어오면 재생 시작
const FULL_RADIUS = 2.6;  // 이 안이면 볼륨 100%
const MAX_PLAYING = 3;    // 동시에 디코딩할 영상 수 상한 (모바일 보호)

/* ---------- 작품 한 점 ---------- */
function Artwork({ work, register }) {
  const groupRef = useRef();
  const meshRef = useRef();
  const haloRef = useRef();
  const spillRef = useRef();

  // <video> 를 직접 만들어야 재생/볼륨을 우리가 통제할 수 있습니다.
  const video = useMemo(() => {
    const v = document.createElement("video");
    v.src = work.videoUrl;
    v.crossOrigin = "anonymous";
    v.loop = true;
    v.muted = true;          // 입장 클릭 전까지는 음소거 (브라우저 자동재생 정책)
    v.playsInline = true;
    v.preload = "metadata";  // 10개를 한꺼번에 받지 않도록
    return v;
  }, [work.videoUrl]);

  const texture = useMemo(() => {
    const t = new THREE.VideoTexture(video);
    t.minFilter = THREE.LinearFilter;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }, [video]);

  useEffect(() => {
    // 정지 상태에서도 첫 프레임이 보이도록 살짝 시크해 둡니다 (= 포스터 프레임)
    const onMeta = () => { try { video.currentTime = 0.05; } catch {} };
    video.addEventListener("loadedmetadata", onMeta);
    return () => {
      video.removeEventListener("loadedmetadata", onMeta);
      video.pause();
      video.src = "";
      texture.dispose();
    };
  }, [video, texture]);

  const { pos, ry, size } = useMemo(() => layoutFor(work), [work]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    const entry = {
      id: work.id, work, video, group: g,
      halo: haloRef.current, spill: spillRef.current,
      normal, gain: 0,
    };
    register(entry);
    return () => register(entry, true);
  }, [work, video, register]);

  const glowTex = useGlowTexture();
  const [w, h] = size;

  return (
    <>
      <group ref={groupRef} position={pos} rotation={[0, ry, 0]}>
        {/* 벽으로 번지는 빛 */}
        <mesh ref={haloRef} position={[0, 0, 0.012]}>
          <planeGeometry args={[w * 2.6, h * 3.4]} />
          <meshBasicMaterial
            map={glowTex} transparent opacity={0} depthWrite={false}
            blending={THREE.AdditiveBlending} color="#8fa8c8"
          />
        </mesh>

        {/* 액자 */}
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[w + 0.09, h + 0.09]} />
          <meshBasicMaterial color="#26262c" />
        </mesh>

        {/* 영상 */}
        <mesh ref={meshRef} position={[0, 0, 0.026]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      </group>

      {/* 바닥으로 떨어지는 빛 */}
      <mesh
        ref={spillRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[
          pos[0] + Math.sin(ry) * 1.5,
          0.015,
          pos[2] + Math.cos(ry) * 1.5,
        ]}
      >
        <planeGeometry args={[w * 2.4, w * 2.4]} />
        <meshBasicMaterial
          map={glowTex} transparent opacity={0} depthWrite={false}
          blending={THREE.AdditiveBlending} color="#8fa8c8"
        />
      </mesh>
    </>
  );
}

/* ---------- 근접 판정: 전시장의 핵심 로직 ---------- */
function ProximityDirector({ entriesRef, onActive, unlocked }) {
  const { camera } = useThree();
  const reported = useRef({ id: null, gain: 0 });

  useFrame((_, dt) => {
    const entries = entriesRef.current;
    if (!entries.length) return;

    const scored = [];
    for (const e of entries) {
      const d = camera.position.distanceTo(e.group.position);
      const facing = camera.position.clone().sub(e.group.position).dot(e.normal) > 0;
      const target = facing
        ? THREE.MathUtils.clamp((PLAY_RADIUS - d) / (PLAY_RADIUS - FULL_RADIUS), 0, 1)
        : 0;
      e.gain += (target - e.gain) * Math.min(1, dt * 4);
      if (e.halo) e.halo.material.opacity = e.gain * 0.5;
      if (e.spill) e.spill.material.opacity = e.gain * 0.34;
      scored.push(e);
    }

    // 가까운 순으로 정렬해 상위 N개만 재생 — 10개 동시 디코딩을 막습니다
    scored.sort((a, b) => b.gain - a.gain);

    scored.forEach((e, i) => {
      const shouldPlay = i < MAX_PLAYING && e.gain > 0.03;
      if (shouldPlay && e.video.paused) {
        e.video.preload = "auto";
        e.video.play().catch(() => {});
      } else if (!shouldPlay && !e.video.paused) {
        e.video.pause();
      }
      // 소리는 가장 가까운 한 점에서만
      if (unlocked) {
        e.video.muted = false;
        e.video.volume = i === 0 ? THREE.MathUtils.clamp(e.gain, 0, 1) : 0;
      }
    });

    const top = scored[0];
    const id = top && top.gain > 0.04 ? top.id : null;
    const gain = top ? top.gain : 0;
    if (id !== reported.current.id || Math.abs(gain - reported.current.gain) > 0.05) {
      reported.current = { id, gain };
      onActive(id ? { ...top.work, gain } : null);
    }
  });

  return null;
}

/* ---------- 이동 + 충돌 ---------- */
function Walker() {
  const { camera } = useThree();
  const keys = useRef({});
  const vel = useRef(new THREE.Vector3());

  useEffect(() => {
    const d = (e) => (keys.current[e.code] = true);
    const u = (e) => (keys.current[e.code] = false);
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
    };
  }, []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const k = keys.current;
    const dir = new THREE.Vector3(
      (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
      0,
      (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0)
    );
    if (dir.lengthSq() > 0) {
      dir.normalize().applyQuaternion(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, camera.rotation.y, 0))
      );
      vel.current.addScaledVector(dir, 26 * dt);
    }
    vel.current.multiplyScalar(Math.pow(0.0022, dt));
    camera.position.addScaledVector(vel.current, dt);

    const lx = ROOM.w / 2 - 0.7, lz = ROOM.d / 2 - 0.7;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -lx, lx);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -lz, lz);
    // 가운데 가벽 통과 방지
    if (Math.abs(camera.position.x) < 0.95 && Math.abs(camera.position.z) < 3.1) {
      camera.position.x = camera.position.x >= 0 ? 0.95 : -0.95;
    }
    camera.position.y = 1.62;
  });

  return null;
}

/* ---------- 공간 ---------- */
function Room() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshBasicMaterial color="#0a0a0c" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM.h, 0]}>
        <planeGeometry args={[ROOM.w, ROOM.d]} />
        <meshBasicMaterial color="#050506" />
      </mesh>
      {[
        [[0, ROOM.h / 2, -ROOM.d / 2], 0, ROOM.w],
        [[0, ROOM.h / 2, ROOM.d / 2], Math.PI, ROOM.w],
        [[-ROOM.w / 2, ROOM.h / 2, 0], Math.PI / 2, ROOM.d],
        [[ROOM.w / 2, ROOM.h / 2, 0], -Math.PI / 2, ROOM.d],
      ].map(([p, r, wide], i) => (
        <mesh key={i} position={p} rotation={[0, r, 0]}>
          <planeGeometry args={[wide, ROOM.h]} />
          <meshBasicMaterial color="#131318" side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* 가운데 가벽 */}
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[0.5, 3.2, 5.2]} />
        <meshBasicMaterial color="#131318" />
      </mesh>
    </group>
  );
}

/* ---------- 유틸 ---------- */
function layoutFor(work) {
  const partition = work.wall === "P+" || work.wall === "P-";
  const w = partition ? 1.9 : 2.5;
  const size = [w, w * (9 / 16)];
  if (work.wall === "L") return { pos: [-ROOM.w / 2 + 0.02, 1.78, work.at], ry: Math.PI / 2, size };
  if (work.wall === "R") return { pos: [ROOM.w / 2 - 0.02, 1.78, work.at], ry: -Math.PI / 2, size };
  if (work.wall === "B") return { pos: [work.at, 1.78, -ROOM.d / 2 + 0.02], ry: 0, size };
  if (work.wall === "P+") return { pos: [0.26, 1.72, work.at], ry: Math.PI / 2, size };
  return { pos: [-0.26, 1.72, work.at], ry: -Math.PI / 2, size };
}

let _glow = null;
function useGlowTexture() {
  return useMemo(() => {
    if (_glow) return _glow;
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(128, 128, 6, 128, 128, 128);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.5, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    _glow = new THREE.CanvasTexture(c);
    return _glow;
  }, []);
}

/* ---------- 최상위 ---------- */
export default function Gallery({ works = [] }) {
  const [entered, setEntered] = useState(false);
  const [active, setActive] = useState(null);
  const entriesRef = useRef([]);

  const register = useMemo(
    () => (entry, remove) => {
      entriesRef.current = remove
        ? entriesRef.current.filter((e) => e.id !== entry.id)
        : [...entriesRef.current.filter((e) => e.id !== entry.id), entry];
    },
    []
  );

  return (
    <div className="relative w-full h-screen bg-[#08080a] text-[#e8e6e1] overflow-hidden">
      <Canvas
        camera={{ position: [0, 1.62, 6], fov: 66, near: 0.1, far: 120 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color("#08080a");
          scene.fog = new THREE.Fog("#08080a", 9, 30);
        }}
      >
        <Suspense fallback={null}>
          <Room />
          {works.map((w) => (
            <Artwork key={w.id} work={w} register={register} />
          ))}
        </Suspense>
        <Walker />
        <ProximityDirector entriesRef={entriesRef} onActive={setActive} unlocked={entered} />
        {entered && <PointerLockControls />}
      </Canvas>

      {/* 작품 라벨 */}
      <div
        className={`absolute bottom-6 left-6 max-w-sm pointer-events-none transition-all duration-500 ${
          active ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
        }`}
      >
        <div className="w-6 h-px bg-[#4a4a52] mb-3" />
        <div className="text-xl font-medium tracking-wide">{active?.title}</div>
        <div className="text-xs text-[#a8a49c] mt-1">{active?.artist}</div>
        <div className="text-[11px] text-[#6e6b65] mt-3 leading-relaxed">{active?.note}</div>
      </div>

      {!entered && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#08080a] text-center px-6">
          <div className="text-[11px] tracking-[0.34em] text-[#7d7a73] uppercase mb-6">
            Generative Video Exhibition
          </div>
          <h1 className="text-4xl md:text-5xl font-light tracking-wide leading-snug">
            열 개의 방,<br />열 개의 움직임
          </h1>
          <p className="text-[13px] text-[#8a8780] leading-loose mt-5 max-w-xs">
            작품에 가까이 다가가면 영상이 깨어납니다.
            소리는 가장 가까운 한 작품에서만 납니다.
          </p>
          {/* 이 클릭이 오디오 잠금을 푸는 사용자 제스처입니다 */}
          <button
            onClick={() => setEntered(true)}
            className="mt-9 px-8 py-3 border border-[#3a3a42] text-xs tracking-[0.24em] hover:border-[#8a8780] hover:bg-white/5 transition"
          >
            전시장 입장
          </button>
        </div>
      )}
    </div>
  );
}
