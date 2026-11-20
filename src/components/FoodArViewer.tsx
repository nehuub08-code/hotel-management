import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatMoney } from '../shared/calculations.ts';
import type { Food3dModelDTO, MenuItemDTO, RestaurantDTO } from '../shared/types.ts';
import { DishVisual } from './DishVisual.tsx';

interface FoodArViewerProps {
  open: boolean;
  onClose: () => void;
  item: MenuItemDTO | null;
  model3d?: Food3dModelDTO | null;
  restaurant: RestaurantDTO;
  onAddToCart?: (item: MenuItemDTO) => void;
}

function buildProceduralDishGroup(preset: string): THREE.Group {
  const group = new THREE.Group();

  // Ceramic stoneware plate (common base)
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe6,
    roughness: 0.35,
    metalness: 0.05,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xd8cec0,
    roughness: 0.45,
    metalness: 0.05,
  });
  const plateBase = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.15, 0.14, 48), plateMat);
  plateBase.position.y = 0.07;
  plateBase.receiveShadow = true;
  plateBase.castShadow = true;
  group.add(plateBase);

  const plateRim = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.065, 18, 48), rimMat);
  plateRim.rotation.x = Math.PI / 2;
  plateRim.position.y = 0.14;
  group.add(plateRim);

  if (preset === 'truffle_flatbread' || preset === 'pepperoni_flatbread') {
    const isPepperoni = preset === 'pepperoni_flatbread';
    const crustMat = new THREE.MeshStandardMaterial({ color: 0xd9a76a, roughness: 0.78 });
    const dough = new THREE.Mesh(new THREE.CylinderGeometry(1.08, 1.1, 0.11, 36), crustMat);
    dough.position.y = 0.19;
    dough.castShadow = true;
    group.add(dough);

    const blisterMat = new THREE.MeshStandardMaterial({ color: 0x4b2e1b, roughness: 0.85 });
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const blister = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), blisterMat);
      blister.scale.set(1.2, 0.45, 0.9);
      blister.position.set(Math.cos(ang) * 0.96, 0.23, Math.sin(ang) * 0.96);
      group.add(blister);
    }

    const sauceMat = new THREE.MeshStandardMaterial({
      color: isPepperoni ? 0xb93822 : 0xe9dfd0,
      roughness: 0.45,
    });
    const toppingBase = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.03, 32), sauceMat);
    toppingBase.position.y = 0.255;
    group.add(toppingBase);

    const sliceColor = isPepperoni ? 0x9e231b : 0x6b5140;
    const itemMat = new THREE.MeshStandardMaterial({ color: sliceColor, roughness: 0.55 });
    for (let i = 0; i < 7; i++) {
      const r = i === 0 ? 0 : 0.48;
      const ang = (i / 6) * Math.PI * 2;
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18), itemMat);
      disc.position.set(Math.cos(ang) * r, 0.28, Math.sin(ang) * r);
      group.add(disc);
    }

    const herbMat = new THREE.MeshStandardMaterial({ color: 0x2f6f3e, roughness: 0.6 });
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 + 0.3;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), herbMat);
      leaf.rotation.z = Math.PI / 2.4;
      leaf.rotation.y = ang;
      leaf.position.set(Math.cos(ang) * 0.32, 0.31, Math.sin(ang) * 0.32);
      group.add(leaf);
    }
  } else if (preset === 'salmon_bowl' || preset === 'saffron_risotto') {
    const isRisotto = preset === 'saffron_risotto';
    const bowlMat = new THREE.MeshStandardMaterial({ color: 0x2a2421, roughness: 0.35 });
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.72, 0.48, 36), bowlMat);
    bowl.position.y = 0.28;
    bowl.castShadow = true;
    group.add(bowl);

    const baseFoodMat = new THREE.MeshStandardMaterial({
      color: isRisotto ? 0xeab308 : 0xf2ece1,
      roughness: 0.7,
    });
    const grainBed = new THREE.Mesh(new THREE.SphereGeometry(0.96, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), baseFoodMat);
    grainBed.scale.set(1, 0.32, 1);
    grainBed.position.y = 0.44;
    group.add(grainBed);

    const heroMat = new THREE.MeshPhysicalMaterial({
      color: isRisotto ? 0xf3e8d2 : 0xe86a42,
      roughness: 0.32,
      clearcoat: 0.5,
      clearcoatRoughness: 0.2,
    });
    const fillet = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.24, 0.48), heroMat);
    fillet.position.set(0, 0.62, 0);
    fillet.rotation.y = 0.25;
    fillet.castShadow = true;
    group.add(fillet);

    const radishMat = new THREE.MeshStandardMaterial({ color: 0xd94670, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.025, 16), radishMat);
      slice.position.set(-0.48 + i * 0.12, 0.58, 0.42);
      slice.rotation.x = 0.35;
      group.add(slice);
    }
  } else if (preset === 'hazelnut_torte') {
    const chocMat = new THREE.MeshPhysicalMaterial({
      color: 0x3b2316,
      roughness: 0.28,
      clearcoat: 0.65,
      clearcoatRoughness: 0.18,
    });
    const cake = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.78, 0.56, 36), chocMat);
    cake.position.y = 0.42;
    cake.castShadow = true;
    group.add(cake);

    const caramelMat = new THREE.MeshPhysicalMaterial({
      color: 0xc27828,
      roughness: 0.18,
      clearcoat: 0.85,
    });
    const drizzle = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 12, 28), caramelMat);
    drizzle.rotation.x = Math.PI / 2;
    drizzle.position.y = 0.71;
    group.add(drizzle);

    const nutMat = new THREE.MeshStandardMaterial({ color: 0x9b6b3f, roughness: 0.5 });
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), nutMat);
      nut.position.set(Math.cos(ang) * 0.34, 0.74, Math.sin(ang) * 0.34);
      group.add(nut);
    }
  } else if (preset === 'orange_tonic' || preset === 'saffron_brew') {
    const isOrange = preset === 'orange_tonic';
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.82,
      roughness: 0.08,
      ior: 1.48,
      thickness: 0.25,
      transparent: true,
      opacity: 0.9,
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.38, 1.32, 32, 1, true), glassMat);
    glass.position.y = 0.8;
    group.add(glass);

    const liquidMat = new THREE.MeshPhysicalMaterial({
      color: isOrange ? 0xea580c : 0x5c361d,
      roughness: 0.15,
      clearcoat: 0.6,
    });
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.35, 1.04, 28), liquidMat);
    liquid.position.y = 0.68;
    group.add(liquid);

    const garnishMat = new THREE.MeshStandardMaterial({
      color: isOrange ? 0xf97316 : 0xfde68a,
      roughness: 0.5,
    });
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 20), garnishMat);
    wheel.position.set(0.28, 1.24, 0);
    wheel.rotation.z = 0.75;
    group.add(wheel);
  } else {
    // Burrata Fig / Lamb Chops / Artisanal Hearth Plate
    const isMeat = preset === 'lamb_chops';
    const bedMat = new THREE.MeshStandardMaterial({
      color: isMeat ? 0xefe7da : 0xfaf6f0,
      roughness: 0.45,
    });
    const labneh = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.92, 0.12, 32), bedMat);
    labneh.position.y = 0.2;
    group.add(labneh);

    if (isMeat) {
      const chopMat = new THREE.MeshStandardMaterial({ color: 0x6b2d1b, roughness: 0.55 });
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xede6d8, roughness: 0.4 });
      for (let i = -1; i <= 1; i++) {
        const meat = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 14), chopMat);
        meat.scale.set(1.2, 0.65, 0.85);
        meat.position.set(i * 0.34, 0.36, 0.1);
        meat.castShadow = true;
        group.add(meat);

        const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.52, 10), boneMat);
        bone.position.set(i * 0.34, 0.56, -0.18);
        bone.rotation.x = -0.55;
        group.add(bone);
      }
    } else {
      const burrataMat = new THREE.MeshPhysicalMaterial({
        color: 0xfffdf8,
        roughness: 0.25,
        clearcoat: 0.4,
      });
      const burrata = new THREE.Mesh(new THREE.SphereGeometry(0.46, 28, 22), burrataMat);
      burrata.scale.set(1.15, 0.72, 1.15);
      burrata.position.y = 0.44;
      burrata.castShadow = true;
      group.add(burrata);

      const figMat = new THREE.MeshStandardMaterial({ color: 0x5c2342, roughness: 0.5 });
      for (let i = 0; i < 4; i++) {
        const ang = (i / 4) * Math.PI * 2 + 0.4;
        const fig = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 12), figMat);
        fig.position.set(Math.cos(ang) * 0.62, 0.32, Math.sin(ang) * 0.62);
        fig.rotation.z = 0.55;
        fig.rotation.y = ang;
        group.add(fig);
      }
    }

    const oilMat = new THREE.MeshStandardMaterial({ color: 0x5e7d2c, roughness: 0.2 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.025, 10, 32), oilMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.27;
    group.add(ring);
  }

  // Ground object bottom to y = 0
  const box = new THREE.Box3().setFromObject(group);
  if (Number.isFinite(box.min.y)) {
    group.position.y -= box.min.y;
  }
  return group;
}

export const FoodArViewer: React.FC<FoodArViewerProps> = ({
  open,
  onClose,
  item,
  model3d,
  restaurant,
  onAddToCart,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  const [cameraArActive, setCameraArActive] = useState(false);
  const [arStatusNote, setArStatusNote] = useState('');
  const [webXrSupported, setWebXrSupported] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [webglError, setWebglError] = useState('');
  const autoRotateRef = useRef(true);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    if (!open) return;
    const navXr = (navigator as unknown as { xr?: { isSessionSupported?: (m: string) => Promise<boolean> } }).xr;
    if (navXr?.isSessionSupported) {
      navXr
        .isSessionSupported('immersive-ar')
        .then((ok) => setWebXrSupported(Boolean(ok)))
        .catch(() => setWebXrSupported(false));
    } else {
      setWebXrSupported(false);
    }
  }, [open]);

  const stopCameraAr = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraArActive(false);
  };

  const toggleCameraAr = async () => {
    if (cameraArActive) {
      stopCameraAr();
      setArStatusNote('');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setArStatusNote(
        'Camera AR is unavailable in this browser context. Using interactive 3D studio preview.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraArActive(true);
      setArStatusNote('Live table camera active — drag to rotate or pinch/zoom dish scale.');
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setArStatusNote(
        'Camera permission was declined or unavailable. Showing interactive 3D table preview instead.'
      );
      setCameraArActive(false);
    }
  };

  useEffect(() => {
    if (!open || !item || !containerRef.current) return;
    if (model3d && model3d.arEnabled === false) return;

    const mount = containerRef.current;
    setWebglError('');

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL 3D rendering is unavailable on this device.');
      return;
    }

    const gl = renderer.getContext();
    const debugExt = gl?.getExtension('WEBGL_debug_renderer_info');
    const glRenderer = debugExt
      ? String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '')
      : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|Software Rasterizer/i.test(glRenderer);

    const width = Math.max(300, mount.clientWidth);
    const height = Math.max(280, mount.clientHeight);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 50);
    camera.position.set(2.4, 2.0, 2.7);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.35, 0);
    controls.minDistance = 1.6;
    controls.maxDistance = 6.5;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.autoRotate = autoRotateRef.current;
    controls.autoRotateSpeed = 1.8;
    controlsRef.current = controls;

    // 3-Point Warm Culinary Studio Lighting
    const keyLight = new THREE.DirectionalLight(0xfff5ea, 1.8);
    keyLight.position.set(4, 6, 4);
    keyLight.castShadow = !isSoftwareGl;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffedd5, 0.85);
    fillLight.position.set(-4, 3, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xf97316, 0.45);
    rimLight.position.set(0, 4, -5);
    scene.add(rimLight);

    // Subtle tabletop shadow plane
    const shadowPlane = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.ShadowMaterial({ opacity: 0.22 })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    let activeModel: THREE.Object3D = buildProceduralDishGroup(
      model3d?.proceduralPreset || item.imageKey || 'generic_plate'
    );
    const scale = model3d?.scaleFactor || 1;
    activeModel.scale.setScalar(scale);
    scene.add(activeModel);

    // Optional uploaded GLB/GLTF override
    if (model3d?.glbUrl) {
      const loader = new GLTFLoader();
      loader.load(
        model3d.glbUrl,
        (gltf) => {
          scene.remove(activeModel);
          const loaded = gltf.scene;
          const box = new THREE.Box3().setFromObject(loaded);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 0.001);
          const norm = (2.1 / maxDim) * scale;
          loaded.scale.setScalar(norm);
          loaded.position.set(-center.x * norm, -box.min.y * norm, -center.z * norm);
          scene.add(loaded);
          activeModel = loaded;
        },
        undefined,
        () => {
          // Keep procedural dish model cleanly if external GLB fails to load
        }
      );
    }

    let rafId = 0;
    let disposed = false;

    const animate = () => {
      if (disposed) return;
      rafId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      if (!mount || disposed) return;
      const w = Math.max(280, mount.clientWidth);
      const h = Math.max(260, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry?.dispose();
          if (Array.isArray(m.material)) {
            m.material.forEach((mat) => mat.dispose());
          } else {
            m.material?.dispose();
          }
        }
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [open, item, model3d]);

  useEffect(() => {
    if (!open) {
      stopCameraAr();
    }
  }, [open]);

  if (!open || !item) return null;

  const isDisabled = model3d?.arEnabled === false;

  const handleResetView = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(2.4, 2.0, 2.7);
      controlsRef.current.target.set(0, 0.35, 0);
      controlsRef.current.update();
    }
  };

  const handleZoom = (factor: number) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const offset = cameraRef.current.position.clone().sub(controlsRef.current.target);
    offset.multiplyScalar(factor);
    const len = offset.length();
    if (len >= 1.4 && len <= 7.0) {
      cameraRef.current.position.copy(controlsRef.current.target).add(offset);
      controlsRef.current.update();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-0 sm:p-4">
      <div
        className={`bg-[#171310] text-[#F5F0EB] border border-stone-800 flex flex-col justify-between overflow-hidden ${
          fullscreen
            ? 'w-screen h-screen rounded-none'
            : 'w-full sm:max-w-3xl h-[88vh] sm:h-[640px] sm:rounded-2xl'
        }`}
      >
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-stone-800 flex items-center justify-between gap-4 shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-orange-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              3D Dish Preview &amp; Table AR
            </p>
            <h3 className="text-base sm:text-lg font-display font-bold text-white">
              {item.name} ·{' '}
              <span className="font-mono text-orange-300">
                {formatMoney(item.basePriceCents, restaurant.currencySymbol)}
              </span>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFullscreen((f) => !f)}
              className="p-2 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"
              title="Toggle fullscreen"
            >
              {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => {
                stopCameraAr();
                onClose();
              }}
              className="p-2 rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewport Stage (No backdrop-filter over WebGL canvas) */}
        <div className="relative flex-1 bg-gradient-to-b from-[#231C17] to-[#120F0D] overflow-hidden">
          {cameraArActive && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          {isDisabled || webglError ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-4">
              <DishVisual
                imageKey={item.imageKey}
                name={item.name}
                className="w-64 h-48 rounded-2xl overflow-hidden border border-stone-700"
              />
              <p className="text-xs text-stone-400 max-w-md">
                {webglError ||
                  '3D/AR preview is currently disabled for this dish. Showing studio illustration.'}
              </p>
            </div>
          ) : (
            <div ref={containerRef} className="relative z-10 w-full h-full cursor-grab active:cursor-grabbing" />
          )}

          {/* Subtle status overlay */}
          {arStatusNote && (
            <div className="absolute top-3 left-3 right-3 z-20 rounded-xl bg-stone-950/90 border border-stone-700 px-3.5 py-2 text-xs text-stone-200 flex items-center justify-between gap-3">
              <span>{arStatusNote}</span>
              <button
                type="button"
                onClick={() => setArStatusNote('')}
                className="text-stone-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Collapsible Control Dock */}
        <div className="border-t border-stone-800 bg-[#1B1613] px-4 py-3 shrink-0 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-stone-400 truncate">
              {model3d?.previewNotes || 'Drag to rotate 360° · Scroll or pinch to inspect portion scale.'}
            </p>
            <button
              type="button"
              onClick={() => setDockCollapsed((c) => !c)}
              className="text-[11px] text-stone-400 hover:text-white inline-flex items-center gap-1 shrink-0"
            >
              {dockCollapsed ? 'Show Controls' : 'Hide Controls'}
              {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>

          {!dockCollapsed && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleCameraAr}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold border ${
                    cameraArActive
                      ? 'bg-emerald-700 text-white border-emerald-600'
                      : 'bg-[#120F0D] text-orange-300 border-orange-600/60 hover:bg-stone-900'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  {cameraArActive ? 'Exit Camera AR' : 'View on Your Table (Camera AR)'}
                </button>

                {model3d?.usdzUrl && (
                  <a
                    rel="ar"
                    href={model3d.usdzUrl}
                    className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border border-stone-700 bg-[#120F0D] text-stone-200 hover:bg-stone-800"
                  >
                    iOS Quick Look
                  </a>
                )}

                <button
                  type="button"
                  onClick={() => handleZoom(0.84)}
                  className="p-2 rounded-xl border border-stone-700 bg-[#120F0D] text-stone-200 hover:bg-stone-800"
                  title="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleZoom(1.18)}
                  className="p-2 rounded-xl border border-stone-700 bg-[#120F0D] text-stone-200 hover:bg-stone-800"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleResetView}
                  className="p-2 rounded-xl border border-stone-700 bg-[#120F0D] text-stone-200 hover:bg-stone-800"
                  title="Reset View"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setAutoRotate((r) => !r)}
                  className={`rounded-xl px-3 py-2 text-xs font-medium border ${
                    autoRotate
                      ? 'border-orange-500/70 text-orange-300 bg-orange-950/30'
                      : 'border-stone-700 text-stone-400 bg-[#120F0D]'
                  }`}
                >
                  Auto-Spin {autoRotate ? 'On' : 'Off'}
                </button>
                <span className="text-[11px] text-stone-500 hidden sm:inline">
                  {webXrSupported ? 'WebXR AR Ready' : '3D + Camera AR Mode'}
                </span>
              </div>

              {onAddToCart && item.isAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    onAddToCart(item);
                    stopCameraAr();
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-700"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Customize &amp; Order
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
