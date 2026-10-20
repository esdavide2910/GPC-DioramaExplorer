// ===================================================================================
// js/main.js - Configuración general, cámara, luces, montaje y renderización
// ===================================================================================

let renderer, scene, camera, cameraControls, player, diorama, coins, torches;
let backgroundMusic;

const CAMERA_FOLLOW_SPEED = 4;
const LEVELS = {
  'Nivel 1': 'levels/level1.json',
  'Nivel 2': 'levels/level2.json',
};
const DEFAULT_LEVEL = LEVELS['Nivel 1'];

const CLOCK = new THREE.Clock();

async function init() 
{
  // ---------------- Renderizado --------------------------------------------------------
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(new THREE.Color(0x111122)); //Antes: 0x00cdf8
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('container').appendChild(renderer.domElement);

  // ---------------- Escena -------------------------------------------------------------
  scene = new THREE.Scene();
  scene.add(new THREE.AxesHelper(60));

  // ---------------- Luces, cámara y audio (se crean una sola vez) ----------------------
  setupLights();
  setupCamera();
  setupAudio('assets/audio/elwynn_forest.aac', 0.3);

   // ---------------- Interfaz -----------------------------------------------------------
  setupGUI();

  // ---------------- Primer nivel -------------------------------------------------------
  await loadLevel(DEFAULT_LEVEL);

  // Si detecta cambios en el tamaño de canvas, llama a la función `onWindowsResize`
  window.addEventListener('resize', onWindowResize);
}

async function loadLevel(url)
{
  // Se carga primero el nuevo nivel: si falla, el actual sigue intacto (Chatbot)
  var newDiorama = await Diorama.load(url, TILE_SIZE);

  // Desmontar el nivel anterior
  if (coins)   coins.dispose();
  if (torches) torches.dispose();
  if (diorama) {
    scene.remove(diorama.group);
    diorama.dispose();
  }

  // Montar el nuevo
  diorama = newDiorama;
  scene.add(diorama.group);

  coins = new CoinManager(scene, diorama, TILE_SIZE);
  coins.onRestart = restartLevel;

  torches = new TorchManager(scene, diorama, TILE_SIZE);

  if (!player) {
    player = new Player(scene, diorama.playerSpawn, TILE_SIZE);
    player.onFall = restartLevel;
  } else {
    player.setSpawn(diorama.playerSpawn);   // recoloca y reinicia la física
  }

  frameCamera();
}

function setupGUI() 
{
  gui = new lil.GUI({ title: 'Dorama Explorer' });

  const state = { level: DEFAULT_LEVEL };

  gui.add(state, 'level', LEVELS)
    .name('Nivel')
    .onChange(function(url) {
      if (document.activeElement) document.activeElement.blur();
      loadLevel(url).catch(function(error) {
        console.error(error);
        alert(`No se pudo cargar el nivel: ${error.message}`);
      });
    });

  gui.add({ restart: restartLevel }, 'restart').name('Reiniciar nivel');
}

function setupLights()
{
  // ---------------- Luz ambiente --------------------------------------------------------
  var ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // 0.6
  scene.add(ambientLight);

  // // ---------------- Luz direccional -----------------------------------------------------
  // var directionLight = new THREE.DirectionalLight(0xffffff, 0.1); //0.8
  // directionLight.position.set(100, 300, 180);
  // directionLight.castShadow = true;
  // directionLight.shadow.mapSize.width = 1024;
  // directionLight.shadow.mapSize.height = 1024;
  // directionLight.shadow.camera.near = 0.01;
  // directionLight.shadow.camera.far = 400;
  // directionLight.shadow.camera.left = -300;
  // directionLight.shadow.camera.right = 300;
  // directionLight.shadow.camera.top = 300;
  // directionLight.shadow.camera.bottom = -300;
  // scene.add(directionLight);
}

function setupCamera()
{
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 5000);

  cameraControls = new THREE.OrbitControls(camera, renderer.domElement);
  cameraControls.enablePan = false;

  const elevationAngle = Math.PI / 3;
  cameraControls.minPolarAngle = elevationAngle;
  cameraControls.maxPolarAngle = elevationAngle;
}


function frameCamera() // Coloca la cámara según el tamaño del diorama actual
{
  const camPos = diorama.getCameraStart();
  camera.position.set(camPos.x, camPos.y, camPos.z);

  const target = diorama.getCenter();
  cameraControls.target.set(target.x, target.y, target.z);

  // La cámara sigue al jugador en altura, así que la distancia depende de la base (X/Z)
  const footprint = Math.max(diorama.sizeX, diorama.sizeZ) * TILE_SIZE;
  cameraControls.minDistance = footprint * 1.25;
  cameraControls.maxDistance = footprint * 4;

  cameraControls.update();
}

function setupAudio(track_path, volume) 
{
  // Crea el receptor de audio (oyente) y lo añade a la cámara
  const listener = new THREE.AudioListener();
  camera.add(listener);

  // Crea una fuente global de audio
  const backgroundMusic = new THREE.Audio(listener);

  // Carga el archivo de audio
  const audioLoader = new THREE.AudioLoader();
  audioLoader.load(
    track_path, 
    function(buffer) {
      backgroundMusic.setBuffer(buffer);
      backgroundMusic.setLoop(true); // Reproducción en bucle
      backgroundMusic.setVolume(volume); // Volumen entre 0.0 y 1.0
    }
  );

  // Los navegadores Chromium y Firefox bloquean el audio automático, por ello lo activamos desde la primera interacción del usuario
  const startAudioOnInteraction = function(){ 
    if (backgroundMusic && backgroundMusic.buffer && !backgroundMusic.isPlaying) {
      backgroundMusic.play();
    }
    // Elimina las escuchas para que no se reejecuten una y otra vez
    window.removeEventListener('click', startAudioOnInteraction);
    window.removeEventListener('keydown', startAudioOnInteraction);
  }

  window.addEventListener('click', startAudioOnInteraction);
  window.addEventListener('keydown', startAudioOnInteraction);
}

function onWindowResize()
{
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function render() 
{
  requestAnimationFrame(render);
  update();
  renderer.render(scene, camera);
}

function restartLevel()
{
  coins.reset();
  player.respawn();
}

function update() 
{
  //
  let delta = CLOCK.getDelta();
  if (delta > 0.1) delta = 0.1;

  // La cámara sigue la altura del jugador (suavizado exponencial)
  if (player && player.mesh) {
    var t = 1 - Math.exp(-CAMERA_FOLLOW_SPEED * delta);
    var dy = (player.mesh.position.y - cameraControls.target.y) * t;
    cameraControls.target.y += dy;
    camera.position.y += dy;
  }

  //
  cameraControls.update();
  
  // Físicas del jugador (congeladas mientras se muestra "You win")
  if (!coins.won) {
    player.update(delta, camera, diorama.collidableMeshes, diorama.solidWallBoxes);
  }
  coins.update(delta, player.box);
}

init().then(render)