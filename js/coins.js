// ===================================================================================
// js/coins.js - Monedas coleccionables, contador (HUD) y pantalla de victoria
// ===================================================================================

const COIN_MODEL_URL = 'assets/models/Star_Coin.glb'; // Modelo obtenido en https://poly.pizza/m/n5nJIQAozN

class CoinManager {

  constructor(scene, diorama, tileSize = TILE_SIZE)
  {
    this.scene = scene;
    this.tileSize = tileSize;

    // ---- Ajustes ----
    this.coinSize = tileSize * 0.6;        // tamaño máximo del modelo
    this.pickupRadius = tileSize * 0.45;   // distancia caja del jugador - centro de la moneda
    this.spinSpeed = 2;                    // rad/s
    this.bobAmplitude = tileSize * 0.1;
    this.bobSpeed = 3;
    this.winDelay = 3;                     // segundos con el letrero antes de reiniciar

    // ---- Estado ----
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.coins = [];                       // { pivot, baseY, phase, collected }
    this.positions = this._readPositions(diorama);
    this.collected = 0;
    this.won = false;
    this.winTimer = 0;
    this.time = 0;
    this.onRestart = null;                 // se llama al terminar el letrero de victoria

    this._createHUD();
    this._loadModel();
  }

  get total() { return this.positions.length; }

  // ---- Lectura y validación del JSON ------------------------------------------------
  _readPositions(diorama)
  {
    const positions = [];
    for (const coin of diorama.coins) {
      const worldPos = gridToWorld(coin.x, coin.y, coin.z, this.tileSize);
      positions.push(worldPos);
    }
    return positions;
  }

  // ---- Modelo -----------------------------------------------------------------------

  _loadModel()
  {
    var self = this;  
    const loader = new THREE.GLTFLoader();

    loader.load(
      COIN_MODEL_URL,
      function(gltf) {
        const model = gltf.scene;
        self._prepareMaterials(model);

        // Escalar al tamaño deseado y centrar el modelo en su pivote
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        model.scale.setScalar(self.coinSize / Math.max(size.x, size.y, size.z));
        bbox.setFromObject(model);
        model.position.sub(bbox.getCenter(new THREE.Vector3()));

        const template = new THREE.Group();
        template.add(model);

        for (const p of self.positions) {
          const pivot = new THREE.Group();
          pivot.position.set(p.x, p.y, p.z);
          pivot.add(template.clone(true));
          self.group.add(pivot);
          self.coins.push({ pivot, baseY: p.y, phase: Math.random() * Math.PI * 2, collected: false });
        }
      },
      undefined,
      function(error) {
        console.error('Error cargando ' + COIN_MODEL_URL, error);
      }
    );
  }

  _prepareMaterials(model)
  {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;

      const old = o.material;

      o.material = new THREE.MeshPhongMaterial({
        map: old.map,
        color: old.color,
        emissive: 0x1a1200,       
        emissiveIntensity: 1.0,
      });
    });
  }

  // ---- HUD -------------------------------------------------------------------------- (Chatbot)

  _createHUD()
  {
    this.counterEl = document.createElement('div');
    Object.assign(this.counterEl.style, {
      position: 'fixed', top: '16px', left: '20px',
      font: 'bold 28px monospace', color: '#ffd400',
      textShadow: '2px 2px 0 #000', userSelect: 'none', pointerEvents: 'none',
    });
    document.body.appendChild(this.counterEl);

    this.winEl = document.createElement('div');
    this.winEl.textContent = 'You win';
    Object.assign(this.winEl.style, {
      position: 'fixed', inset: '0', display: 'none',
      alignItems: 'center', justifyContent: 'center',
      font: 'bold 96px monospace', color: '#ffd400',
      textShadow: '4px 4px 0 #000', background: 'rgba(0,0,0,0.35)',
      userSelect: 'none', pointerEvents: 'none',
    });
    document.body.appendChild(this.winEl);

    this._updateHUD();
  }

  _updateHUD()
  {
    this.counterEl.textContent = `Coins: ${this.collected} / ${this.total}`;
  }

  // ---- Lógica -----------------------------------------------------------------------

  update(delta, playerBox)
  {
    this.time += delta;

    for (const coin of this.coins) {
      if (coin.collected) continue;

      coin.pivot.rotation.y += this.spinSpeed * delta;
      coin.pivot.position.y = coin.baseY + Math.sin(this.time * this.bobSpeed + coin.phase) * this.bobAmplitude;

      if (!this.won && playerBox.distanceToPoint(coin.pivot.position) < this.pickupRadius) {
        coin.collected = true;
        coin.pivot.visible = false;
        this.collected++;
        this._updateHUD();
      }
    }

    if (!this.won && this.total > 0 && this.collected >= this.total) {
      this.won = true;
      this.winTimer = 0;
      this.winEl.style.display = 'flex';
    }

    if (this.won) {
      this.winTimer += delta;
      if (this.winTimer >= this.winDelay) {
        if (this.onRestart) this.onRestart(); else this.reset();
      }
    }
  }

  // Vuelven todas las monedas y el contador a cero
  reset()
  {
    this.collected = 0;
    this.won = false;
    this.winTimer = 0;
    this.winEl.style.display = 'none';
    for (const coin of this.coins) {
      coin.collected = false;
      coin.pivot.visible = true;
    }
    this._updateHUD();
  }

  // Libera memoria de la GPU que ocupan geometrías y materiales de coins
  dispose()
  {
    this.scene.remove(this.group);
    this.counterEl.remove();
    this.winEl.remove();
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    });
    this.coins = [];
    this.onRestart = null;
  }
}