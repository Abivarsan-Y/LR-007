import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { azElToSceneDirection } from './directions.mjs';

export type TerrainMeshData = {
  positions: Float32Array; indices: Uint32Array; groundY: number | null;
  span: number; missingVertices: number;
};
export type BodyDirection = { azimuth_deg: number; elevation_deg: number };
export type SceneViewProps = {
  terrain: TerrainMeshData;
  sun: BodyDirection;
  earth: BodyDirection;
  dataKind: 'synthetic' | 'cached_real' | 'live_real';
  verticalScale?: number;
  wireframe?: boolean;
  cameraPreset?: 'overview' | 'surface';
  resetKey?: number;
  observerHeightM?: number;
};

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p role="alert">3D rendering is unavailable. Reload to retry; the numeric directions remain available outside the scene.</p>
      : this.props.children;
  }
}

function CameraControls({ terrain, verticalScale, preset, resetKey }: {
  terrain: TerrainMeshData; verticalScale: number; preset: 'overview' | 'surface'; resetKey: number;
}) {
  const { camera, gl } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const instance = new OrbitControls(camera, gl.domElement);
    instance.enableDamping = true;
    instance.minDistance = 5;
    instance.maxDistance = terrain.span * 3;
    instance.maxPolarAngle = Math.PI * 0.49;
    controls.current = instance;
    return () => { controls.current = null; instance.dispose(); };
  }, [camera, gl, terrain.span]);
  useEffect(() => {
    const ground = (terrain.groundY ?? 0) * verticalScale;
    if (preset === 'surface' && terrain.groundY !== null) {
      camera.position.set(40, ground + 35, 40);
      controls.current?.target.set(0, ground + 35, -150);
    } else {
      camera.position.set(terrain.span * .65, terrain.span * .5, terrain.span * .65);
      controls.current?.target.set(0, ground / 2, 0);
    }
    controls.current?.update();
  }, [camera, terrain, verticalScale, preset, resetKey]);
  useFrame(() => controls.current?.update());
  return null;
}

function Terrain({ terrain, verticalScale, wireframe }: {
  terrain: TerrainMeshData; verticalScale: number; wireframe: boolean;
}) {
  const geometry = useMemo(() => {
    const value = new THREE.BufferGeometry();
    value.setAttribute('position', new THREE.BufferAttribute(terrain.positions, 3));
    value.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
    value.computeVertexNormals();
    value.computeBoundingSphere();
    return value;
  }, [terrain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} scale={[1, verticalScale, 1]}>
    <meshStandardMaterial color="#9da7b0" roughness={1} metalness={0} wireframe={wireframe} />
  </mesh>;
}

function Lander({ groundY }: { groundY: number }) {
  return <group position={[0, groundY, 0]}>
    <mesh position={[0, 8, 0]}><cylinderGeometry args={[7, 11, 10, 6]} /><meshStandardMaterial color="#e1b974" /></mesh>
    <mesh position={[0, 20, 0]}><cylinderGeometry args={[.8, .8, 16, 6]} /><meshStandardMaterial color="#d8f1ed" /></mesh>
    <mesh position={[0, 29, 0]}><sphereGeometry args={[2.4, 12, 8]} /><meshBasicMaterial color="#83e2ce" /></mesh>
    {[[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([x, z]) =>
      <mesh key={`${x}:${z}`} position={[x, 2, z]}><boxGeometry args={[6, 4, 6]} /><meshStandardMaterial color="#a2b5c9" /></mesh>)}
  </group>;
}

function BodyMarker({ direction, radius, ground, color, size }: {
  direction: BodyDirection; radius: number; ground: number; color: string; size: number;
}) {
  const point = azElToSceneDirection(direction.azimuth_deg, direction.elevation_deg);
  const end = useMemo(() => new THREE.Vector3(point.x, point.y, point.z), [point.x, point.y, point.z]);
  return <group position={[0, ground, 0]}>
    <arrowHelper args={[end, new THREE.Vector3(), radius, color, radius * .04, radius * .018]} />
    <mesh position={[point.x * radius, point.y * radius, point.z * radius]}>
      <sphereGeometry args={[size, 20, 12]} /><meshBasicMaterial color={color} />
    </mesh>
  </group>;
}

function Content({ terrain, sun, earth, verticalScale = 10, wireframe = false,
  cameraPreset = 'overview', resetKey = 0, observerHeightM = 2 }: SceneViewProps) {
  const sunlight = azElToSceneDirection(sun.azimuth_deg, sun.elevation_deg);
  const ground = (terrain.groundY ?? 0) * verticalScale;
  const observerY = ground + observerHeightM;
  const lightTarget = useMemo(() => {
    const target = new THREE.Object3D();
    target.position.set(0, observerY, 0);
    return target;
  }, [observerY]);
  return <>
    <color attach="background" args={['#090f19']} />
    <ambientLight intensity={.65} />
    <primitive object={lightTarget} />
    <directionalLight target={lightTarget} position={[sunlight.x * 2000, observerY + sunlight.y * 2000, sunlight.z * 2000]} intensity={1.8} />
    <Terrain terrain={terrain} verticalScale={verticalScale} wireframe={wireframe} />
    {terrain.groundY !== null && <Lander groundY={ground} />}
    <BodyMarker direction={sun} radius={terrain.span * .65} ground={observerY} color="#ffd18a" size={13} />
    <BodyMarker direction={earth} radius={terrain.span * .55} ground={observerY} color="#78bdff" size={15} />
    <axesHelper args={[terrain.span * .18]} position={[0, ground, 0]} />
    <CameraControls terrain={terrain} verticalScale={verticalScale} preset={cameraPreset} resetKey={resetKey} />
  </>;
}

/** Controlled view: C owns site/time selection; A/B own scientific input data. */
export function SceneView(props: SceneViewProps) {
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    <SceneBoundary>
      <Canvas camera={{ near: .5, far: props.terrain.span * 10, fov: 48 }} dpr={[1, 1.5]}
        fallback={<p role="alert">WebGL is unavailable on this device. Numeric data remains available.</p>}>
        <Content {...props} />
      </Canvas>
    </SceneBoundary>
    <span style={{ position: 'absolute', top: 16, left: 16, background: '#0b1525dd', color: '#e5ecf5', padding: '8px 12px', borderRadius: 6, fontSize: 12, pointerEvents: 'none' }}>
      {props.dataKind === 'synthetic' ? 'SYNTHETIC DATA' : 'DATA VISUALIZATION'} · illustrative lighting
    </span>
  </div>;
}
