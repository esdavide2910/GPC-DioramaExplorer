// ===================================================================================
// js/torches.js - Antorchas (modelo + luz puntual cálida con parpadeo)
// ===================================================================================

const TORCH_MODEL_URL = 'assets/models/Torch.glb'; // Modelo obtenido en https://sketchfab.com/3d-models/minecraft-torch-51a60bc7d2e8489a831fb7995d9139fc

class TorchManager {

  constructor(scene, diorama, tileSize = TILE_SIZE)
  {
    this.scene = scene;
    this.tileSize = tileSize;

    this.torchHeight = tileSize * 0.7;        // altura del modelo
    this.lightColor = 0xff9a3c;               // luz naranja cálida
    this.lightIntensity = 1.6;                // intensidad de la luz
    this.lightDistance = tileSize * 7;        // alcance de la luz
    this.lightDecay = 2;                      // decaimiento de luz (cómo se atenúa la luz a medida que aumenta la distancia desde la fuente)
    this.emissiveIntensity = 0.1;             // brillo propio del modelo
    
    this.castShadows = false;                 

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.torches = [];

    this._createTorches(diorama);
    this._loadModel();
  }

  // Las luces se crean enseguida; el modelo se añade cuando termine de cargar
  _createTorches(diorama)
  {
    for (var t of diorama.torches) {

      const pos = gridToWorld(t.x, t.y, t.z, this.tileSize);

      // El holder se coloca en el suelo de la celda
      const holder = new THREE.Group();
      holder.position.set(pos.x, pos.y - this.tileSize / 2, pos.z);

      const light = new THREE.PointLight(this.lightColor, this.lightIntensity, this.lightDistance, this.lightDecay);

      light.position.set(0, this.torchHeight, 0); // a la altura de la llama
      if (this.castShadows) {
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.camera.near = 1;
        light.shadow.camera.far = this.lightDistance;
      }
      holder.add(light);

      this.group.add(holder);
      this.torches.push({ holder, light, phase: Math.random() * Math.PI * 2 });
    }
  }

  _loadModel()
  {
    var self = this;
    const loader = new THREE.GLTFLoader();

    loader.load(
      TORCH_MODEL_URL,
      function(gltf) {
        const model = gltf.scene;
        self._prepareMaterials(model);

        // Escalar a la altura deseada, centrar en X/Z y apoyar la base en y = 0
        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        model.scale.setScalar(self.torchHeight / size.y);
        bbox.setFromObject(model);
        const center = bbox.getCenter(new THREE.Vector3());
        model.position.set(-center.x, -bbox.min.y, -center.z);

        const torch_template = new THREE.Group();
        torch_template.add(model);

        for (const t of self.torches) t.holder.add(torch_template.clone());
      },
      undefined,
      function(error) {
        console.error('Error cargando ' + TORCH_MODEL_URL, error);
      }
    );
  }

  _prepareMaterials(model)
  {
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.receiveShadow = true;
      o.receiveShadow = true;

      const old = o.material;

      o.material = new THREE.MeshStandardMaterial({
        map: old.map,
        color: old.color,
        emissive: old.color, // la antorcha brilla por sí misma
        emissiveMap: old.map,
        emissiveIntensity: 1.55,
      });
    });
  }

  // Libera memoria de la GPU que ocupan geometrías y materiales de torch
  dispose()
  {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    });
    this.torches = [];
  }
}