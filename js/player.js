// ===================================================================================
// js/player.js - Clase Player: movimiento, físicas y colisiones
// ===================================================================================
//
// Resumen del flujo de update() en cada frame:
//   1. Leer la dirección de movimiento (teclas + orientación de la cámara)
//   2. Animar y girar al personaje
//   3. Mover en X y Z con colisión contra paredes
//   4. Saltar, aplicar gravedad / pegarse al suelo / chocar con el techo
//   5. Suavizar visualmente la subido por los escalones
//   6. Respawn si cae al vacío

const PLAYER_MODEL_URL = 'assets/models/Steve.glb'; // Modelo obtenido en https://poly.pizza/bundle/Cube-World-Kit-DwDr8493Fw

// Nombres de las animaciones dentro de Steve.glb
const ANIM_IDLE = 'CharacterArmature|CharacterArmature|CharacterArmature|Idle';
const ANIM_RUN  = 'CharacterArmature|CharacterArmature|CharacterArmature|Run';

const UP = new THREE.Vector3(0, 1, 0);

class Player {

  constructor(scene, spawnGridPos, tileSize = TILE_SIZE)
  {
    this.scene = scene;
    this.tileSize = tileSize;
    this.spawnGridPos = spawnGridPos;

    // ---- Parámetros de movimiento y físicas ----
    this.halfSize = { x: 4, y: 7, z: 4 };   // mitad de la caja de colisión
    this.speed = 30;
    this.gravity = -180;
    this.jumpStrength = 80;

    // Medio bloque se sube, un bloque entero no.
    // maxStepHeight es el umbral único: el rayo de suelo arranca a esta altura sobre los pies, y un bloque solo cuenta como pared si sobresale más que esto.
    this.maxStepHeight = tileSize * 0.55;
    this.snapDownTolerance = tileSize * 0.6; // pegarse al suelo al bajar escalones o rampas
    this.voidY = -5 * tileSize;              // por debajo de esta altura se hace respawn

    // Puntos de la base desde los que se lanzan los rayos de suelo (centro + 4 esquinas)
    this.footOffsets = [
      new THREE.Vector3( 0, 0,  0),
      new THREE.Vector3( 3, 0,  3),
      new THREE.Vector3(-3, 0,  3),
      new THREE.Vector3( 3, 0, -3),
      new THREE.Vector3(-3, 0, -3),
    ];

    // ---- Estado ----
    this.velocityY = 0;
    this.isGrounded = false;
    this.keys = { w: false, s: false, a: false, d: false, ' ': false };

    // ---- Colisión (reutilizados en cada frame para no crear objetos) ----
    this.box = new THREE.Box3();
    this._boxSize = new THREE.Vector3(
      this.halfSize.x * 2,
      this.halfSize.y * 2,
      this.halfSize.z * 2
    );
    this.downRaycaster = new THREE.Raycaster();
    this.downVector = new THREE.Vector3(0, -1, 0);
    this._rayOrigin = new THREE.Vector3();

    // ---- Modelo y animación ----
    this.model = null;
    this.modelBaseY = 0;
    this.visualOffsetY = 0;     // desfase visual al subir/bajar escalones
    this.stepSmoothing = 10;    // más bajo = más lento (prueba entre 6 y 14)

    this.mixer = null;
    this.actions = {};
    this.idleAction = null;
    this.walkAction = null;
    this.currentAction = null;
    this.onFall = null; 

    this._setupInput();
    this._createMesh();
    this._loadModel();
  }

  // Cambia el punto de aparición (nuevo nivel) y coloca al jugador en él
  setSpawn(spawnGridPos)
  {
    this.spawnGridPos = spawnGridPos;
    this.respawn();
  }

  // ===================================================================================
  // Inicialización
  // ===================================================================================

  _setupInput()
  {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (!(key in this.keys)) return;
      if (key === ' ') e.preventDefault();   // evita el scroll con espacio
      this.keys[key] = true;
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key in this.keys) this.keys[key] = false;
    });
  }

  // Posición de aparición en coordenadas de mundo
  _getSpawnWorldPos()
  {
    const { x, y, z } = this.spawnGridPos;
    return gridToWorld(x, y, z, this.tileSize);
  }

  // Malla invisible con el tamaño de la caja de colisión: el modelo 3D cuelga de ella
  _createMesh()
  {
    const geom = new THREE.BoxGeometry(this._boxSize.x, this._boxSize.y, this._boxSize.z);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    this.mesh = new THREE.Mesh(geom, mat);

    const spawn = this._getSpawnWorldPos();
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);

    this.scene.add(this.mesh);
    this.updateBox();
  }

  _loadModel()
  {
    var self = this;
    var loader = new THREE.GLTFLoader();

    loader.load(
      PLAYER_MODEL_URL,
      function(gltf) {
        var model = gltf.scene;
        self._prepareModelMaterials(model);
        self._fitModelToCollisionBox(model);

        self.model = model;
        self.modelBaseY = model.position.y;
        self.mesh.add(model);

        self._setupAnimations(model, gltf.animations);
      },
      undefined,
      function(error) {
        console.error('Error cargando ' + PLAYER_MODEL_URL, error);
      }
    );
  }

  // Sombras y materiales con iluminación Lambert y texturas nítidas
  _prepareModelMaterials(model)
  {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;

      const old = o.material;
      old.map.encoding = THREE.LinearEncoding; // (Chatbot)

      o.material = new THREE.MeshPhongMaterial({ 
        map: old.map,
        color: old.color,
        shininess: 80
      });
    });
  }

  // Escala el modelo a la altura de la caja de colisión y apoya sus pies en la base
  _fitModelToCollisionBox(model)
  {
    const bbox = new THREE.Box3().setFromObject(model);
    const size = bbox.getSize(new THREE.Vector3());
    model.scale.setScalar(this._boxSize.y / size.y);

    // Centrar en X/Z y colocar los pies en la cara inferior de la caja
    bbox.setFromObject(model);
    const center = bbox.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -this.halfSize.y - bbox.min.y, -center.z);
  }

  _setupAnimations(model, clips)
  {
    this.mixer = new THREE.AnimationMixer(model);
    clips.forEach((clip) => {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    });
    // console.log('Animaciones de Steve:', Object.keys(this.actions));

    this.idleAction = this.actions[ANIM_IDLE];
    this.walkAction = this.actions[ANIM_RUN];
    this._fadeTo(this.idleAction);
  }

  // Transición suave entre animaciones
  _fadeTo(next)
  {
    if (!next || next === this.currentAction) return;
    next.reset().fadeIn(0.2).play();
    if (this.currentAction) this.currentAction.fadeOut(0.2);
    this.currentAction = next;
  }

  // ===================================================================================
  // Colisiones
  // ===================================================================================

  // Recalcula la caja de colisión a partir de la posición actual
  updateBox()
  {
    this.box.setFromCenterAndSize(this.mesh.position, this._boxSize);
  }

  // Un bloque solo cuenta como pared si sobresale lo bastante por encima de los pies (si no, es un escalón que se puede subir).
  // (Sirve tanto para paredes laterales como para el techo al subir)
  checkWallCollision(solidWallBoxes)
  {
    const feetY = this.box.min.y;

    for (const wall of solidWallBoxes) {
      if (!this.box.intersectsBox(wall)) continue;
      if (wall.max.y - feetY > this.maxStepHeight) return true;
    }
    return false;
  }

  // ===================================================================================
  // Actualización por frame
  // ===================================================================================

  update(delta, camera, collidableMeshes, solidWallBoxes)
  {
    // Si la malla aún no se ha creado, no hay nada que actualizar
    if (!this.mesh) return;

    const prevY = this.mesh.position.y;
    const groundedAtStart = this.isGrounded;

    // 1. Dirección de movimiento
    const moveDir = this._getMoveDirection(camera);
    const isMoving = moveDir.lengthSq() > 0;
    if (isMoving) moveDir.normalize();   // la diagonal no debe ser más rápida

    // 2. Animación y orientación
    this._updateAnimation(isMoving, delta);
    if (isMoving) this._turnTowards(moveDir, delta);

    // 3. Movimiento horizontal
    this._moveHorizontally(moveDir, delta, solidWallBoxes);

    // 4. Salto y movimiento vertical
    this._handleJump();
    this._updateVertical(delta, collidableMeshes, solidWallBoxes);
    this.updateBox();

    // 5. Suavizado visual y respawn
    this._smoothStepVisual(prevY, groundedAtStart, delta);
    this._respawnIfFallen();
  }

  // ---- 1. Dirección ---------------------------------------------------------------

  // Suma de las teclas pulsadas, relativa a la cámara y sobre el plano horizontal
  _getMoveDirection(camera)
  {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();

    const dir = new THREE.Vector3();
    if (this.keys.w) dir.add(forward);
    if (this.keys.s) dir.sub(forward);
    if (this.keys.d) dir.add(right);
    if (this.keys.a) dir.sub(right);
    return dir;
  }

  // ---- 2. Animación y giro --------------------------------------------------------

  _updateAnimation(isMoving, delta)
  {
    if (!this.mixer) return;
    this._fadeTo(isMoving ? this.walkAction : this.idleAction);
    this.mixer.update(delta);
  }

  // Giro suave hacia la dirección de movimiento
  _turnTowards(moveDir, delta)
  {
    var targetAngle = Math.atan2(moveDir.x, moveDir.z);
    var diff = targetAngle - this.mesh.rotation.y;

    // Llevar la diferencia al rango [-PI, PI] para girar por el lado corto
    while (diff > Math.PI)  diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    // Avanzar una fracción de la diferencia en cada frame
    this.mesh.rotation.y += diff * Math.min(1, 30 * delta);
  }

  // ---- 3. Movimiento horizontal ---------------------------------------------------

  // Cada eje se mueve por separado: si uno choca, el otro sigue libre y el jugador puede deslizarse a lo largo de las paredes
  _moveHorizontally(moveDir, delta, solidWallBoxes)
  {
    for (const axis of ['x', 'z']) {
      const step = moveDir[axis] * this.speed * delta;
      if (step === 0) continue;

      this.mesh.position[axis] += step;
      this.updateBox();

      if (this.checkWallCollision(solidWallBoxes)) {
        this.mesh.position[axis] -= step;   // deshacer el movimiento
        this.updateBox();
      }
    }
  }

  // ---- 4. Movimiento vertical -----------------------------------------------------

  _handleJump()
  {
    if (this.keys[' '] && this.isGrounded) {
      this.velocityY = this.jumpStrength;
      this.isGrounded = false;
    }
  }

  _updateVertical(delta, collidableMeshes, solidWallBoxes)
  {
    // Se evalúa después del salto, que ya habrá puesto isGrounded a false
    const wasGrounded = this.isGrounded;

    const groundY = this._findGroundCenterY(collidableMeshes);
    const hasGround = groundY !== -Infinity;

    // Apoyado y con suelo al alcance: subir un escalón pequeño o pegarse al suelo
    const canSnapToGround = wasGrounded && this.velocityY <= 0 && hasGround && this.mesh.position.y <= groundY + this.snapDownTolerance;

    if (canSnapToGround) {
      this._landOn(groundY);
      return;
    }

    // En el aire (subiendo por un salto o en caída libre)
    this.isGrounded = false;
    this.velocityY += this.gravity * delta;
    this.mesh.position.y += this.velocityY * delta;

    if (this.velocityY > 0) {
      // Subiendo: el movimiento horizontal ya garantiza que no hay solapes con paredes, así que cualquier choque ahora viene del techo. Se deshace el ascenso
      this.updateBox();
      if (this.checkWallCollision(solidWallBoxes)) {
        this.mesh.position.y -= this.velocityY * delta;
        this.velocityY = 0;
      }
    } else if (hasGround && this.mesh.position.y <= groundY) {
      // Si durante la caída atraviesa el suelo detectado, aterriza sobre él
      this._landOn(groundY);
    }
  }

  // Altura del centro del jugador si estuviera apoyado en el suelo más alto bajo él (-Infinity si no hay suelo).
  // Los rayos parten de los pies + maxStepHeight: lo que quede más alto que eso no cuenta como suelo (es una pared), lo que evita teletransportes. 
  // Se lanzan desde el centro y las cuatro esquinas de la base para detectar suelo aunque solo se pise parcialmente.
  _findGroundCenterY(collidableMeshes)
  {
    const rayOriginY = this.mesh.position.y - this.halfSize.y + this.maxStepHeight;
    var highestGroundY = -Infinity;

    for (const offset of this.footOffsets) {
      this._rayOrigin.copy(this.mesh.position).add(offset);
      this._rayOrigin.y = rayOriginY;

      this.downRaycaster.set(this._rayOrigin, this.downVector);
      const hits = this.downRaycaster.intersectObjects(collidableMeshes, false);

      if (hits.length > 0 && hits[0].point.y > highestGroundY) {
        highestGroundY = hits[0].point.y;
      }
    }

    if(highestGroundY === -Infinity) return -Infinity;
    else return highestGroundY + this.halfSize.y;
  }

  _landOn(centerY)
  {
    this.mesh.position.y = centerY;
    this.velocityY = 0;
    this.isGrounded = true;
  }

  // ---- 5. Suavizado visual --------------------------------------------------------

  // Si el cambio de altura fue un "snap" en el suelo (escalón), el modelo se queda atrás y se acerca poco a poco (Asistido por chatbot)
  _smoothStepVisual(prevY, groundedAtStart, delta)
  {
    if (groundedAtStart && this.isGrounded) {
      this.visualOffsetY += prevY - this.mesh.position.y;
    }
    this.visualOffsetY *= Math.exp(-this.stepSmoothing * delta);
    if (Math.abs(this.visualOffsetY) < 0.001) this.visualOffsetY = 0;

    if (this.model) this.model.position.y = this.modelBaseY + this.visualOffsetY;
  }

  // ---- 6. Respawn -----------------------------------------------------------------

  // Vuelve al punto de aparición
  respawn()
  {
    const spawn = this._getSpawnWorldPos();
    this.mesh.position.set(spawn.x, spawn.y, spawn.z);
    this.velocityY = 0;
    this.visualOffsetY = 0;
    this.isGrounded = false;
    this.updateBox();
  }

  // Si cae por debajo del diorama, avisa para reiniciar el nivel (o hace respawn simple)
  _respawnIfFallen()
  {
    if (this.mesh.position.y >= this.voidY) return;
    if (this.onFall) this.onFall(); else this.respawn();
  }
}
