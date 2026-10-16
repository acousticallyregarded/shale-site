// Shaly the golem: idles beside a block of layered shale; each click makes him strike the
// block (a punch, or a tool swing if a tool model is given), which jolts and throws gold
// sparks. The moment and place of impact are measured from the animation itself at load,
// so a different model or strike animation needs no hand tuning.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const DEFAULTS = {
  strike: /Ground_Slam|Slam|Punch|Hammer_Swing/i,   // which clip to use for the strike
  blockTop: 0.38,     // preferred height of the block's top (it is lowered if the fist never gets that high)
  fist: 0.07,         // fist radius: how far above the hand bone the knuckles meet the block
  hold: 0.16,         // hit-stop at impact, seconds
  recover: 0.45,      // ease back to idle, seconds
  tool: null,         // { url, length, grip, dir } to hold a tool in the right hand (optional)
};

function strataTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  const bands = [["#a7b2b9", 9], ["#8c98a1", 10], ["#6f7c86", 7], ["#e2b443", 3], ["#5d6a74", 11], ["#7a8790", 8], ["#4b5761", 9], ["#3f4a53", 7]];
  let y = 0;
  for (const [col, h] of bands) { g.fillStyle = col; g.fillRect(0, y, 64, h); y += h; }
  for (let i = 0; i < 220; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.18})`; g.fillRect(Math.random() * 64 | 0, Math.random() * 64 | 0, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const bone = (root, name) => { let hit = null; root.traverse((o) => { if (!hit && o.isBone && o.name === name) hit = o; }); return hit; };

/** Finds when and where the striking hand (or tool tip) reaches the block, and the block size. */
function calibrate(golem, mixer, action, clip, strikers, cfg) {
  const p = new THREE.Vector3(), samples = [];
  action.reset(); action.play();
  for (let i = 0; i <= 240; i++) {
    action.time = clip.duration * i / 240; mixer.update(0); golem.updateMatrixWorld(true);
    let best = null;
    for (const s of strikers) { s.getWorldPosition(p); if (p.z > 0.2 && (!best || p.y < best.y)) best = p.clone(); }
    samples.push({ t: action.time, at: best });
  }
  action.stop();
  // the strike starts after the striker's highest point in front
  let peak = 0;
  samples.forEach((s, i) => { if (s.at && (!samples[peak].at || s.at.y > samples[peak].at.y)) peak = i; });
  const target = cfg.blockTop + cfg.fist;
  let hit = samples.slice(peak).find((s) => s.at && s.at.y <= target);
  if (!hit) {  // never gets that low (a straight punch): strike at the lowest point instead
    hit = samples.slice(peak).reduce((a, b) => (b.at && (!a.at || b.at.y < a.at.y) ? b : a), samples[peak]);
  }
  const top = Math.max(0.16, Math.min(cfg.blockTop, hit.at.y - cfg.fist));
  return { time: hit.t, size: top, pos: [hit.at.x, top / 2, hit.at.z] };
}

export async function mountMascot(container, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x22262c, 1.5));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
  sun.position.set(3, 5, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2.4, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const loader = new GLTFLoader();
  const [golemGltf, toolGltf] = await Promise.all([
    loader.loadAsync(cfg.golemUrl),
    cfg.tool ? loader.loadAsync(cfg.tool.url) : Promise.resolve(null),
  ]);
  const golem = golemGltf.scene;
  golem.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  scene.add(golem);

  const mixer = new THREE.AnimationMixer(golem);
  const clips = golemGltf.animations;
  const idleClip = clips.find((c) => /idle/i.test(c.name)) || clips[0];
  const strikeClip = clips.find((c) => cfg.strike.test(c.name) && c !== idleClip) || clips.find((c) => c !== idleClip) || clips[0];
  const idle = mixer.clipAction(idleClip);
  const swing = mixer.clipAction(strikeClip); swing.setLoop(THREE.LoopOnce, 1); swing.clampWhenFinished = true;

  const rightHand = bone(golem, "RightHand"), leftHand = bone(golem, "LeftHand");
  const strikers = [rightHand, leftHand].filter(Boolean);

  // Optional tool in the right hand, sized in world units and pointing along the swing at impact.
  if (toolGltf && rightHand) {
    const tool = toolGltf.scene;
    tool.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    rightHand.add(tool);
    const size = new THREE.Vector3(); new THREE.Box3().setFromObject(tool).getSize(size);
    const ws = new THREE.Vector3(); rightHand.getWorldScale(ws);
    const s = cfg.tool.length / size.y / ws.x;
    tool.scale.setScalar(s);
    const tip = new THREE.Object3D(); tip.position.set(0, size.y * 0.47, 0); tool.add(tip);
    strikers.splice(0, strikers.length, tip);
    // orient it at a provisional impact pose, then calibrate with the tool tip
    swing.play(); swing.time = strikeClip.duration * 0.85; mixer.update(0); golem.updateMatrixWorld(true);
    const q = new THREE.Quaternion(); rightHand.getWorldQuaternion(q);
    const local = new THREE.Vector3(...cfg.tool.dir).normalize().applyQuaternion(q.invert()).normalize();
    tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), local);
    tool.position.copy(local.clone().multiplyScalar(-cfg.tool.grip * s));
    swing.stop();
  }

  const impact = calibrate(golem, mixer, swing, strikeClip, strikers, cfg);
  const block = new THREE.Mesh(new THREE.BoxGeometry(impact.size, impact.size, impact.size), new THREE.MeshStandardMaterial({ map: strataTexture(), roughness: 0.9 }));
  block.position.set(...impact.pos); block.castShadow = true; block.receiveShadow = true; scene.add(block);
  idle.play();

  // frame the golem and the block from a three-quarter side view
  const golemBox = new THREE.Box3().setFromObject(golem);
  const height = golemBox.max.y - golemBox.min.y;
  const target = new THREE.Vector3((impact.pos[0]) / 2, height * 0.55, impact.pos[2] / 2);
  camera.position.copy(target).add(new THREE.Vector3(3.0, 0.55, 3.0).multiplyScalar(height / 1.7));  // three-quarter front: his face and the block
  camera.lookAt(target);

  // sparks
  const N = 60;
  const sparkGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xf2c230, size: 0.035, transparent: true, opacity: 0 }));
  scene.add(sparks);
  let sparkLife = 0;
  function burst() {
    for (let i = 0; i < N; i++) {
      pos.set([impact.pos[0], impact.size, impact.pos[2]], i * 3);
      const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.4;
      vel.set([Math.cos(a) * s * 0.5, 1.2 + Math.random() * 1.6, Math.sin(a) * s * 0.5], i * 3);
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkLife = 0.9;
  }

  // strike -> (impact) hold -> ease back to idle
  let phase = "idle", hitDone = false, shake = 0, holdLeft = 0, recoverLeft = 0;
  function strike() {
    if (phase !== "idle") return;
    phase = "swing"; hitDone = false;
    swing.reset(); swing.paused = false; swing.setEffectiveWeight(1); swing.play();
    idle.crossFadeTo(swing, 0.15, false);
  }
  renderer.domElement.style.cursor = "pointer";
  renderer.domElement.addEventListener("click", strike);
  container.setAttribute("role", "button");
  container.tabIndex = 0;
  container.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); strike(); } });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%";
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    mixer.update(reduced && phase === "idle" ? 0 : dt);
    if (phase === "swing" && !hitDone && swing.time >= impact.time) {
      hitDone = true; shake = 0.25; burst(); cfg.onHit && cfg.onHit();
      swing.time = impact.time; mixer.update(0);  // land exactly on the block, not through it
      swing.paused = true; phase = "hold"; holdLeft = cfg.hold;
    } else if (phase === "hold" && (holdLeft -= dt) <= 0) {
      idle.reset(); idle.play(); swing.paused = false; swing.crossFadeTo(idle, cfg.recover, false);
      phase = "recover"; recoverLeft = cfg.recover;
    } else if (phase === "recover" && (recoverLeft -= dt) <= 0) {
      swing.stop(); phase = "idle";
    }
    if (shake > 0) {
      shake -= dt;
      const k = Math.max(shake, 0) * 0.06;
      block.position.set(impact.pos[0] + (Math.random() - 0.5) * k, impact.pos[1] - k * 0.5, impact.pos[2] + (Math.random() - 0.5) * k);
    } else block.position.set(...impact.pos);
    if (sparkLife > 0) {
      sparkLife -= dt;
      for (let i = 0; i < N; i++) {
        vel[i * 3 + 1] -= 5.5 * dt;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparks.material.opacity = Math.max(sparkLife / 0.9, 0);
    }
    renderer.render(scene, camera);
  });
  return {
    strike, clips: clips.map((c) => c.name), strikeClip: strikeClip.name, impact,
    bones: () => { const n = []; golem.traverse((o) => o.isBone && n.push(o.name)); return n; },
    debug: { THREE, scene, camera, golem, block, mixer, swing, idle },
  };
}
