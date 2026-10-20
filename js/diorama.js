// ===================================================================================
// js/diorama.js - Materiales PBR, tipos de bloque y clase Diorama
// ===================================================================================
//
// Resumen del flujo:
//   1. level1.json  ->  parseLevel()  ->  matriz voxel[y][z][x] + mapa de rotaciones
//   2. Diorama._build() recorre la matriz y, por cada celda no vacía, busca su
//      definición en BLOCKS (forma + material) y la coloca en la escena.
//   3. Cada pieza colocada se registra para las colisiones del jugador:
//        - collidableMeshes -> raycasts de suelo
//        - solidWallBoxes   -> colisiones laterales y de techo
//
// Tipos de bloque (un carácter por celda en "voxel_blocks"; '0' = aire):
//   D tierra | G hierba | S mossy stone bricks | B stone bricks
//   L tronco de abeto | F hojas de abeto | R rampa (escalera)
// La orientación (grados en Y) de cualquier bloque se define en "rotations".

const TILE_SIZE = 15;
const TORCH_CHAR = 'T';
const COIN_CHAR = 'C';

// -----------------------------------------------------------------------------------
// 1. COORDENADAS
// -----------------------------------------------------------------------------------
// Una celda (gx, gy, gz) ocupa un cubo de lado tileSize; su centro está en +0.5.

function gridToWorld(gx, gy, gz, tileSize = TILE_SIZE) {
  return {
    x: (gx + 0.5) * tileSize,
    y: (gy + 0.5) * tileSize,
    z: (gz + 0.5) * tileSize,
  };
}

function cellKey(x, y, z) {
  return x + ',' + y + ',' + z;
}

// -----------------------------------------------------------------------------------
// 2. MATERIALES PBR
// (Texturas de https://www.curseforge.com/minecraft/texture-packs/roundista)
// -----------------------------------------------------------------------------------
const TEX_DIR = 'assets/block_textures/';
const textureLoader = new THREE.TextureLoader();

// --- Color base ---
const texDirt        = textureLoader.load(TEX_DIR + 'dirt.png');
const texMossyBricks = textureLoader.load(TEX_DIR + 'mossy_stone_bricks.png');
const texStoneBricks = textureLoader.load(TEX_DIR + 'stone_bricks.png');
const texLogSide     = textureLoader.load(TEX_DIR + 'spruce_log.png');
const texLogTop      = textureLoader.load(TEX_DIR + 'spruce_log_top.png');
const texGrassTop    = textureLoader.load(TEX_DIR + 'grass_block_top.png');
const texGrassSide   = textureLoader.load(TEX_DIR + 'grass_block_side.png');
const texLeaves      = textureLoader.load(TEX_DIR + 'spruce_leaves.png');

// --- Normal maps ---
const norDirt        = textureLoader.load(TEX_DIR + 'dirt_n.png');
const norMossyBricks = textureLoader.load(TEX_DIR + 'mossy_stone_bricks_n.png');
const norStoneBricks = textureLoader.load(TEX_DIR + 'stone_bricks_n.png');
const norLogSide     = textureLoader.load(TEX_DIR + 'spruce_log_n.png');
const norLogTop      = textureLoader.load(TEX_DIR + 'spruce_log_top_n.png');
const norGrassTop    = textureLoader.load(TEX_DIR + 'grass_block_top_n.png');
const norGrassSide   = textureLoader.load(TEX_DIR + 'grass_block_side_n.png');
const norLeaves      = textureLoader.load(TEX_DIR + 'spruce_leaves_n.png');

// --- Specular maps ---
const spcDirt        = textureLoader.load(TEX_DIR + 'dirt_s.png');
const spcMossyBricks = textureLoader.load(TEX_DIR + 'mossy_stone_bricks_s.png');
const spcStoneBricks = textureLoader.load(TEX_DIR + 'stone_bricks_s.png');
const spcLogSide     = textureLoader.load(TEX_DIR + 'spruce_log_s.png');
const spcLogTop      = textureLoader.load(TEX_DIR + 'spruce_log_top_s.png');
const spcGrassTop    = textureLoader.load(TEX_DIR + 'grass_block_top_s.png');
const spcGrassSide   = textureLoader.load(TEX_DIR + 'grass_block_side_s.png');
const spcLeaves      = textureLoader.load(TEX_DIR + 'spruce_leaves_s.png');

// Filtros: píxeles nítidos de cerca (mag) y mipmaps a distancia (min)
const allTextures = [
  texDirt, texMossyBricks, texStoneBricks, texLogSide, texLogTop, texGrassTop, texGrassSide, texLeaves,
  norDirt, norMossyBricks, norStoneBricks, norLogSide, norLogTop, norGrassTop, norGrassSide, norLeaves,
  spcDirt, spcMossyBricks, spcStoneBricks, spcLogSide, spcLogTop, spcGrassTop, spcGrassSide, spcLeaves,
];
for (const tex of allTextures) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
}

// --- Materiales ---
const matDirt = new THREE.MeshPhongMaterial({
  map: texDirt, normalMap: norDirt, specularMap: spcDirt,
  specular: 0xffffff, shininess: 20,
});
const matMossyBricks = new THREE.MeshPhongMaterial({
  map: texMossyBricks, normalMap: norMossyBricks, specularMap: spcMossyBricks, specular: 0x999999,
});
const matStoneBricks = new THREE.MeshPhongMaterial({
  map: texStoneBricks, normalMap: norStoneBricks, specularMap: spcStoneBricks, specular: 0x999999, 
});
const matLogSide = new THREE.MeshPhongMaterial({
  map: texLogSide, normalMap: norLogSide, specularMap: spcLogSide, shininess: 20,
});
const matLogTop = new THREE.MeshPhongMaterial({
  map: texLogTop, normalMap: norLogTop, specularMap: spcLogTop, shininess: 20,
});
const matGrassTop = new THREE.MeshPhongMaterial({
  map: texGrassTop, normalMap: norGrassTop, specularMap: spcGrassTop, shininess: 20,
});
const matGrassSide = new THREE.MeshPhongMaterial({
  map: texGrassSide, normalMap: norGrassSide, specularMap: spcGrassSide, shininess: 20,
});

const matLeaves = new THREE.MeshPhongMaterial({
  map: texLeaves, normalMap: norLeaves, specularMap: spcLeaves,
  specular: 0xffffff, shininess: 20,
  alphaTest: 0.5,
  side: THREE.DoubleSide, 
});

// -----------------------------------------------------------------------------------
// 3. FORMAS Y TIPOS DE BLOQUE
// -----------------------------------------------------------------------------------
// Una forma es una lista de cajas en coordenadas de bloque [0..1]
// Las escaleras suben hacia +z local
const SHAPES = {
  cube: [
    { min: [0, 0, 0], max: [1, 1, 1] },
  ],
  stairs: [
    { min: [0, 0,   0  ], max: [1, 0.5, 1] },   // peldaño bajo (bloque completo, media altura)
    { min: [0, 0.5, 0.5], max: [1, 1,   1] },   // peldaño alto (mitad trasera)
  ],
};

// Orden de caras de BoxGeometry para materiales por cara: +x, -x, +y, -y, +z, -z
const BLOCKS = {
  D: { shape: 'cube',   material: matDirt },
  G: { shape: 'cube',   material: [matGrassSide, matGrassSide, matGrassTop, matDirt, matGrassSide, matGrassSide] },
  S: { shape: 'cube',   material: matMossyBricks },
  B: { shape: 'cube',   material: matStoneBricks },
  L: { shape: 'cube',   material: [matLogSide, matLogSide, matLogTop, matLogTop, matLogSide, matLogSide] },
  F: { shape: 'cube',   material: matLeaves },
  R: { shape: 'stairs', material: matMossyBricks },
};

// Crea la geometría de una caja de la forma, centrada en el origen del bloque
function createPartGeometry(part, tileSize) {
  const [minX, minY, minZ] = part.min;
  const [maxX, maxY, maxZ] = part.max;

  const geom = new THREE.BoxGeometry(
    (maxX - minX) * tileSize,
    (maxY - minY) * tileSize,
    (maxZ - minZ) * tileSize
  );
  geom.translate(
    ((minX + maxX) / 2 - 0.5) * tileSize,
    ((minY + maxY) / 2 - 0.5) * tileSize,
    ((minZ + maxZ) / 2 - 0.5) * tileSize
  );
  mapBlockUVs(geom, tileSize);
  return geom;
}

// Recalcula los UVs según la posición dentro del bloque, para que la textura no se estire en las partes de media altura y encaje con los bloques vecinos
function mapBlockUVs(geom, tileSize) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const uv = geom.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    // Posición dentro del bloque, en [0..1]
    const bx = pos.getX(i) / tileSize + 0.5;
    const by = pos.getY(i) / tileSize + 0.5;
    const bz = pos.getZ(i) / tileSize + 0.5;
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);

    if      (nx >  0.5) uv.setXY(i, 1 - bz, by);
    else if (nx < -0.5) uv.setXY(i, bz,     by);
    else if (ny >  0.5) uv.setXY(i, bx,     1 - bz);
    else if (ny < -0.5) uv.setXY(i, bx,     bz);
    else if (nz >  0.5) uv.setXY(i, bx,     by);
    else                uv.setXY(i, 1 - bx, by);
  }
  uv.needsUpdate = true;
}

// -----------------------------------------------------------------------------------
// 4. LECTURA DEL NIVEL (JSON -> datos)
// -----------------------------------------------------------------------------------

function parseLevel(levelData) {
  const w = levelData.voxel_width;
  const d = levelData.voxel_depth;
  const h = levelData.voxel_height;

  return {
    sizeX: w,
    sizeY: h,
    sizeZ: d,
    voxel: decodeVoxelBlocks(levelData.voxel_blocks, w, d, h),
    rotations: decodeRotations(levelData.rotations, w, d, h)
  };
}

// Convierte voxel_blocks (string o array de strings) en la matriz [y][z][x]
// Orden de lectura: capas de abajo a arriba (y), dentro de cada capa filas (z), dentro de cada fila columnas (x)
// Los espacios y saltos de línea se ignoran, así que sirven para separar filas o capas
// Las celdas que faltan son aire
function decodeVoxelBlocks(voxelBlocks, w, d, h) {
  var raw = Array.isArray(voxelBlocks) ? voxelBlocks.join('') : voxelBlocks;
 
  var cells = raw.replace(/\s+/g, '');
  var total = w * d * h;
 
  var voxel = [];
  for (var y = 0; y < h; y++) {
    voxel[y] = [];
    for (var z = 0; z < d; z++) {
      voxel[y][z] = [];
      for (var x = 0; x < w; x++) {
        var c = cells[(y * d + z) * w + x];
        voxel[y][z][x] = (!c || c === '0') ? 0 : c;
      }
    }
  }
  return voxel;
}

// Convierte la lista "rotations" ([{x, y, z, rotation}, ...]) en un Map "x,y,z" -> radianes
// "rotation" son grados alrededor del eje Y (múltiplos de 90). Las celdas que no aparecen en la lista tienen rotación 0
function decodeRotations(list, w, d, h) 
{ 
  var map = new Map();
  for (var i = 0; i < list.length; i++) {
    var entry = list[i];
    map.set(cellKey(entry.x, entry.y, entry.z), THREE.MathUtils.degToRad(entry.rotation));
  }
  return map;
}

// -----------------------------------------------------------------------------------
// 5. CLASE DIORAMA
// -----------------------------------------------------------------------------------
class Diorama {

  constructor(levelData, tileSize = TILE_SIZE) {
    const level = parseLevel(levelData);

    this.tileSize = tileSize;
    this.playerSpawn = levelData.playerSpawn;

    this.sizeX = level.sizeX;
    this.sizeY = level.sizeY;
    this.sizeZ = level.sizeZ;
    this.voxel = level.voxel;           // [y][z][x]
    this.rotations = level.rotations;   // "x,y,z" -> radianes en Y

    this.group = new THREE.Group();     // Objeto a añadir a la escena
    this.collidableMeshes = [];         // Para los raycasts de suelo
    this.solidWallBoxes = [];           // Para las colisiones laterales / techo

    this.torches = [];  
    this.coins = [];
    
    this._build();
  }

  // Carga un nivel desde una URL y devuelve el Diorama ya construido
  static async load(url, tileSize = TILE_SIZE) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`No se pudo cargar el nivel ${url} (${response.status})`);
    }
    return new Diorama(await response.json(), tileSize);
  }

  // Centro del diorama en coordenadas de mundo (para apuntar la cámara)
  getCenter() {
    return gridToWorld(
      (this.sizeX - 1) / 2,
      (this.sizeY - 1) / 2,
      (this.sizeZ - 1) / 2,
      this.tileSize
    );
  }

  // Esquina opuesta al origen en coordenadas de mundo (posición inicial de la cámara)
  getCameraStart() {
    return gridToWorld(this.sizeX, this.sizeY, this.sizeZ*0.5, this.tileSize);
  }

  // ---------------------------------------------------------------------------------
  // Construcción
  // ---------------------------------------------------------------------------------
  _build() {
    for (let y = 0; y < this.sizeY; y++) {
      for (let z = 0; z < this.sizeZ; z++) {
        for (let x = 0; x < this.sizeX; x++) {
          var cell = this.voxel[y][z][x];
          if (cell !== 0) this._placeBlock(cell, x, y, z);
        }
      }
    }
  }

  // Crea el bloque de la celda, lo coloca/orienta y lo registra para colisiones
  _placeBlock(type, x, y, z) {

    // Las antorchas no son bloques
    if (type === TORCH_CHAR) {
      this.torches.push({ x, y, z, rotation: this.rotations.get(cellKey(x, y, z)) || 0 });
      return;
    }

    // Las monedas tampoco son bloques
    if (type === COIN_CHAR) {
      this.coins.push({ x, y, z });
      return;
    }

    const definition = BLOCKS[type];
    if (!definition) {
      console.warn(`Diorama: tipo de celda desconocido "${type}" en (x=${x}, y=${y}, z=${z})`);
      return;
    }

    const block = new THREE.Group();
    for (const geom of this._getGeometries(definition.shape)) {
      const mesh = new THREE.Mesh(geom, definition.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      block.add(mesh);
    }

    const pos = gridToWorld(x, y, z, this.tileSize);
    block.position.set(pos.x, pos.y, pos.z);
    block.rotation.y = this.rotations.get(cellKey(x, y, z)) || 0;
    this.group.add(block);
    block.updateMatrixWorld(true);   // necesario antes de calcular las cajas de colisión

    // Cada parte (un cubo, o cada peldaño) tiene su malla y su caja de colisión
    for (const part of block.children) {
      this.collidableMeshes.push(part);
      this.solidWallBoxes.push(new THREE.Box3().setFromObject(part));
    }
  }

  // Geometrías de una forma, creadas una sola vez y compartidas entre bloques (Chatbot)
  _getGeometries(shapeName) {
    return SHAPES[shapeName].map(
      (part) => createPartGeometry(part, this.tileSize)
    );
  }

  // Libera memoria de la GPU que ocupan geometrías y materiales del diorama
  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}