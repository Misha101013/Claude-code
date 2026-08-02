// Управление от первого лица + коллизии локального игрока.

import * as THREE from 'three';
import { collisionBoxes, SPAWN } from '/shared/layout.js';
import { resolveCircle } from '/shared/physics.js';
import { PLAYER_RADIUS, EYE_HEIGHT, WALK_SPEED, SPRINT_SPEED } from '/shared/config.js';
import { makeBoxMesh } from './entities.js';

const SOLIDS = collisionBoxes();

export class Player {
  constructor(camera, canvas) {
    this.camera = camera;
    this.canvas = canvas;
    this.x = SPAWN.x;
    this.z = SPAWN.z;
    this.yaw = SPAWN.yaw;
    this.pitch = 0;
    this.keys = new Set();
    this.locked = false;
    this.bob = 0;
    this.moving = false;
    this.sprint = false;
    this.sensitivity = 0.0022;
    this.heldMesh = null;
    this.heldId = null;
    this.onStep = null;
    this.stepAcc = 0;

    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
      while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
      while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    };
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
    });
  }

  lock() {
    this.canvas.requestPointerLock?.();
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setHeld(productId) {
    if (productId === this.heldId) return;
    this.heldId = productId;
    if (this.heldMesh) {
      this.camera.remove(this.heldMesh);
      this.heldMesh.material.dispose();
      this.heldMesh = null;
    }
    if (productId) {
      const mesh = makeBoxMesh(productId);
      mesh.position.set(0.46, -0.46, -0.95);
      mesh.rotation.set(0.1, -0.5, 0.06);
      mesh.scale.setScalar(0.8);
      this.camera.add(mesh);
      this.heldMesh = mesh;
    }
  }

  update(dt, uiFocused) {
    let fx = 0;
    let fz = 0;
    if (!uiFocused && this.locked) {
      if (this.keys.has('KeyW')) fz += 1;
      if (this.keys.has('KeyS')) fz -= 1;
      if (this.keys.has('KeyA')) fx -= 1;
      if (this.keys.has('KeyD')) fx += 1;
    }
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const len = Math.hypot(fx, fz);
    this.moving = len > 0;

    if (len > 0) {
      fx /= len; fz /= len;
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // forward = (sin, cos); экранный «вправо» = (-cos, sin)
      let dx = fz * sin - fx * cos;
      let dz = fz * cos + fx * sin;
      const speed = (this.sprint ? SPRINT_SPEED : WALK_SPEED) * (this.heldId ? 0.86 : 1);
      dx *= speed * dt;
      dz *= speed * dt;
      const res = resolveCircle(this.x + dx, this.z + dz, PLAYER_RADIUS, SOLIDS);
      this.x = Math.max(-70, Math.min(70, res.x));
      this.z = Math.max(-70, Math.min(70, res.z));

      this.bob += dt * (this.sprint ? 14 : 10);
      this.stepAcc += dt * (this.sprint ? 2.1 : 1.5);
      if (this.stepAcc > 1) {
        this.stepAcc = 0;
        this.onStep?.();
      }
    } else {
      this.bob += dt * 2;
    }

    const bobY = this.moving ? Math.sin(this.bob) * 0.035 : Math.sin(this.bob) * 0.006;
    this.camera.position.set(this.x, EYE_HEIGHT + bobY, this.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + Math.PI;
    this.camera.rotation.x = this.pitch;

    if (this.heldMesh) {
      this.heldMesh.position.y = -0.46 + Math.sin(this.bob) * (this.moving ? 0.03 : 0.006);
      this.heldMesh.rotation.z = 0.06 + Math.sin(this.bob * 0.5) * 0.02;
    }
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  inStorage() {
    return this.z > 8;
  }
}

export { SOLIDS };
