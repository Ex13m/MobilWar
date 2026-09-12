import * as THREE from "three";
import { AVATAR_COLORS, TEAM_COLORS, type AvatarId, type Team } from "@mobilwar/shared";

/**
 * Procedural low-poly avatars — no asset downloads, instant load on any phone.
 * Each avatar is ~1.7 m tall, origin at feet, faces -Z.
 */
export function buildAvatar(avatar: AvatarId, team: Team): THREE.Group {
  const g = new THREE.Group();
  const teamColor = TEAM_COLORS[team];
  const skin = new THREE.MeshStandardMaterial({ color: AVATAR_COLORS[avatar], roughness: 0.7 });
  const teamMat = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.5, emissive: teamColor, emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.8, 8), dark);
  legs.position.y = 0.4;
  g.add(legs);

  const torsoH = avatar === "heavy" ? 0.7 : 0.6;
  const torsoW = avatar === "heavy" ? 0.55 : avatar === "ninja" ? 0.36 : 0.42;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, 0.28), teamMat);
  torso.position.y = 0.8 + torsoH / 2;
  g.add(torso);

  const headGeo = avatar === "robot" ? new THREE.BoxGeometry(0.3, 0.3, 0.3) : new THREE.SphereGeometry(0.17, 12, 10);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.y = 0.8 + torsoH + 0.22;
  g.add(head);

  // visor / eyes facing -Z
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0x0ea5e9 }));
  visor.position.set(0, head.position.y + 0.02, -0.16);
  g.add(visor);

  // arms + gun pointing forward
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), skin);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0.22, 0.8 + torsoH * 0.75, -0.25);
  g.add(arm);
  const gunLen = avatar === "sniper" ? 0.9 : 0.55;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, gunLen), dark);
  gun.position.set(0.22, 0.8 + torsoH * 0.75, -0.25 - gunLen / 2);
  g.add(gun);

  if (avatar === "medic") {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cross.position.set(0, torso.position.y, -0.15);
    g.add(cross);
  }
  if (avatar === "scout") {
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.12, 8), teamMat);
    cap.position.y = head.position.y + 0.17;
    g.add(cap);
  }

  // team ring on the ground
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.45, 24),
    new THREE.MeshBasicMaterial({ color: teamColor, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.name = "ring";
  g.add(ring);

  g.userData.headY = head.position.y;
  return g;
}

export function buildTurret(team: Team | null): THREE.Group {
  const g = new THREE.Group();
  const c = team ? TEAM_COLORS[team] : 0x9ca3af;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0x374151 }));
  base.position.y = 0.15;
  g.add(base);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
  body.position.y = 0.5;
  body.name = "head";
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 8), new THREE.MeshStandardMaterial({ color: 0x111827 }));
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.5, -0.5);
  body.add(barrel);
  barrel.position.set(0, 0, -0.5);
  return g;
}

export function buildBarrier(team: Team | null): THREE.Group {
  const g = new THREE.Group();
  const c = team ? TEAM_COLORS[team] : 0x9ca3af;
  const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x4b5563 }));
  m.position.y = 0.55;
  g.add(m);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.12, 0.32), new THREE.MeshBasicMaterial({ color: c }));
  stripe.position.y = 1.0;
  g.add(stripe);
  return g;
}

export function buildMedkit(): THREE.Group {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  box.position.y = 0.4;
  g.add(box);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.42), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  cross.position.y = 0.4;
  g.add(cross);
  const cross2 = cross.clone();
  cross2.rotation.y = Math.PI / 2;
  g.add(cross2);
  return g;
}

export function buildFlag(team: Team | null): THREE.Group {
  const g = new THREE.Group();
  const c = team ? TEAM_COLORS[team] : 0xffffff;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0xd1d5db }));
  pole.position.y = 1.1;
  g.add(pole);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  cloth.position.set(0.4, 1.9, 0);
  g.add(cloth);
  return g;
}

/** Billboard label with nick + HP bar drawn into a canvas texture. */
export function buildLabel(text: string, hp: number, maxHp: number, team: Team): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 80;
  const ctx = cv.getContext("2d")!;
  drawLabel(ctx, text, hp, maxHp, team);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.6, 0.5, 1);
  s.userData.canvas = cv;
  s.userData.text = text;
  return s;
}

export function updateLabel(s: THREE.Sprite, text: string, hp: number, maxHp: number, team: Team): void {
  const cv = s.userData.canvas as HTMLCanvasElement;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  drawLabel(ctx, text, hp, maxHp, team);
  (s.material.map as THREE.CanvasTexture).needsUpdate = true;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, hp: number, maxHp: number, team: Team): void {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, 0, 0, 256, 80, 16);
  ctx.fill();
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText(text.slice(0, 12), 128, 40);
  ctx.fillStyle = "#374151";
  roundRect(ctx, 24, 54, 208, 14, 7);
  ctx.fill();
  ctx.fillStyle = team === "red" ? "#ef4444" : "#3b82f6";
  roundRect(ctx, 24, 54, Math.max(8, 208 * Math.max(0, hp / maxHp)), 14, 7);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
