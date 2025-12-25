/**
 * Boulder Dash clone with Nostr integration
 * Classic cave exploration and diamond collecting
 */

import * as nostr from './nostr.js'

// Audio
let audioCtx = null
let masterGain = null

function initAudio() {
  if (audioCtx) return
  audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  masterGain = audioCtx.createGain()
  masterGain.gain.value = 0.3
  masterGain.connect(audioCtx.destination)
}

function playTone(freq, duration, type = 'square') {
  if (!audioCtx) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime)
  gain.gain.setValueAtTime(0.2, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration)
  osc.connect(gain)
  gain.connect(masterGain)
  osc.start()
  osc.stop(audioCtx.currentTime + duration)
}

function playDig() { playTone(150, 0.05, 'square') }
function playDiamond() {
  playTone(880, 0.1, 'sine')
  setTimeout(() => playTone(1320, 0.1, 'sine'), 50)
}
function playBoulder() { playTone(80, 0.15, 'sawtooth') }
function playExplosion() {
  if (!audioCtx) return
  const bufferSize = audioCtx.sampleRate * 0.3
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2)
  }
  const noise = audioCtx.createBufferSource()
  noise.buffer = buffer
  const gain = audioCtx.createGain()
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3)
  noise.connect(gain)
  gain.connect(masterGain)
  noise.start()
}
function playWin() {
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'sine'), i * 100))
}
function playDeath() {
  playTone(440, 0.5, 'sawtooth')
  setTimeout(() => playTone(220, 0.5, 'sawtooth'), 200)
}

// Tile types
const EMPTY = 0
const DIRT = 1
const WALL = 2
const STEEL = 3
const BOULDER = 4
const DIAMOND = 5
const PLAYER = 6
const EXIT = 7
const EXIT_OPEN = 8
const FIREFLY = 9
const BUTTERFLY = 10
const EXPLOSION = 11
const DIAMOND_BIRTH = 12

// Colors
const COLORS = {
  [EMPTY]: '#000000',
  [DIRT]: '#8b4513',
  [WALL]: '#808080',
  [STEEL]: '#404040',
  [BOULDER]: '#c0c0c0',
  [DIAMOND]: '#00ffff',
  [PLAYER]: '#ffff00',
  [EXIT]: '#404040',
  [EXIT_OPEN]: '#00ff00',
  [FIREFLY]: '#ff0000',
  [BUTTERFLY]: '#ff00ff',
  [EXPLOSION]: '#ff8800',
  [DIAMOND_BIRTH]: '#ffffff'
}

// Game state
let canvas, ctx
let grid = []
let gridWidth = 40
let gridHeight = 22
let tileSize = 12
let playerX, playerY
let diamonds = 0
let diamondsNeeded = 10
let score = 0
let lives = 3
let timeLeft = 150
let level = 0
let best = parseInt(localStorage.getItem('boulderdash-best')) || 0
let gameOver = false
let gameRunning = false
let exitOpen = false
let lastUpdate = 0
let updateInterval = 150 // ms between physics updates

// Animation state
let explosions = []
let falling = new Set()

// UI elements
let diamondsEl, diamondsNeededEl, scoreEl, livesEl, timeEl, caveEl, bestEl
let gameMessage, messageText, loginBtn, loginModal

// Levels
const LEVELS = [
  { // Cave A - Intro
    name: 'A',
    diamonds: 12,
    time: 150,
    map: `
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
W......................................W
W.r..d.......d........d................W
W......................................W
W..d.....d.........d.......d.....d.....W
W......................................W
W.........d............................W
W...d..................................W
W......d.......d.......d...............W
W......................................W
W..............d.......................W
W.....d................................W
W..........d...........................W
W......................................W
W.d................d...................W
W......................................W
W............d.........................W
W......P...............................W
W.....................d................W
W.....................................XW
W......................................W
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
`
  },
  { // Cave B - Boulders
    name: 'B',
    diamonds: 10,
    time: 150,
    map: `
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
W..........r.r.r.r.r.r.r...............W
W..........d.d.d.d.d.d.d...............W
W......................................W
W......................................W
W..P...................................W
W......................................W
W......................................W
W.....r.r.r.r.r.r.r.r..................W
W.....d.d.d.d.d.d.d.d..................W
W......................................W
W......................................W
W......................................W
W...............r.r.r.r.r.r............W
W...............d.d.d.d.d.d............W
W......................................W
W......................................W
W......................................W
W......................................W
W.....................................XW
W......................................W
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
`
  },
  { // Cave C - Maze
    name: 'C',
    diamonds: 15,
    time: 200,
    map: `
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
W.P..d.W.....d.W.....d.W.....d.W......dW
W.....rW......rW......rW......rW.......W
W......W.......W.......W.......W.......W
WWWW.WWWWWW.WWWWWWW.WWWWWWW.WWWWWWW.WWWW
W.....dW.....d.W.....d.W.....d.W.....d.W
W......W.......W.......W.......W.......W
W......W.......W.......W.......W.......W
WWWW.WWWWWWW.WWWWWW.WWWWWWW.WWWWWWW.WWWW
W.d....W.....d.W.....d.W.....d.W.......W
W......W.......W.......W.......W.......W
W......W.......W.......W.......W.......W
WWWW.WWWWWWW.WWWWWW.WWWWWWW.WWWWWWW.WWWW
W......W.....d.W.....d.W.....d.W.....d.W
W......W.......W.......W.......W.......W
W......W.......W.......W.......W.......W
WWWW.WWWWWWW.WWWWWW.WWWWWWW.WWWWWWW.WWWW
W.d....W.d.....W.d.....W.d.....W.d.....W
W......W.......W.......W.......W.......W
W......W.......W.......W.......W......XW
W......W.......W.......W.......W.......W
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
`
  },
  { // Cave D - Fireflies
    name: 'D',
    diamonds: 8,
    time: 180,
    map: `
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
W..P...................................W
W......................................W
W......................................W
W.......WWWWW..........................W
W.......W...W..........................W
W.......W.F.W..........................W
W.......W...W..........................W
W.......WWWWW..........................W
W......................................W
W..............WWWWW...................W
W..............W...W...................W
W..............W.F.W...................W
W..............W...W...................W
W..............WWWWW...................W
W......................................W
W...d.d.d.d.d.d.d.d.d.d................W
W......................................W
W......................................W
W.....................................XW
W......................................W
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
`
  },
  { // Cave E - Butterflies
    name: 'E',
    diamonds: 20,
    time: 200,
    map: `
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
W..P...................................W
W......................................W
W......r.r.r.r.r.r.r.r.................W
W......................................W
W.......WWWWW..WWWWW..WWWWW............W
W.......W...W..W...W..W...W............W
W.......W.B.W..W.B.W..W.B.W............W
W.......W...W..W...W..W...W............W
W.......WWWWW..WWWWW..WWWWW............W
W......................................W
W......................................W
W.......WWWWW..WWWWW..WWWWW............W
W.......W...W..W...W..W...W............W
W.......W.B.W..W.B.W..W.B.W............W
W.......W...W..W...W..W...W............W
W.......WWWWW..WWWWW..WWWWW............W
W......................................W
W......................................W
W.....................................XW
W......................................W
WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW
`
  }
]

function init() {
  canvas = document.getElementById('game-canvas')
  ctx = canvas.getContext('2d')

  diamondsEl = document.getElementById('diamonds')
  diamondsNeededEl = document.getElementById('diamonds-needed')
  scoreEl = document.getElementById('score')
  livesEl = document.getElementById('lives')
  timeEl = document.getElementById('time')
  caveEl = document.getElementById('cave')
  bestEl = document.getElementById('best')
  gameMessage = document.getElementById('game-message')
  messageText = document.getElementById('message-text')
  loginBtn = document.getElementById('login-btn')
  loginModal = document.getElementById('login-modal')

  bestEl.textContent = best

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  setupControls()
  setupUI()
  startGame()
  refreshLeaderboard()
}

function resizeCanvas() {
  const wrapper = canvas.parentElement
  const rect = wrapper.getBoundingClientRect()
  const maxWidth = rect.width
  tileSize = Math.floor(maxWidth / gridWidth)
  canvas.width = gridWidth * tileSize
  canvas.height = gridHeight * tileSize
}

function setupControls() {
  document.addEventListener('keydown', e => {
    initAudio()
    if (gameOver) return

    switch(e.code) {
      case 'ArrowUp': case 'KeyW': movePlayer(0, -1); e.preventDefault(); break
      case 'ArrowDown': case 'KeyS': movePlayer(0, 1); e.preventDefault(); break
      case 'ArrowLeft': case 'KeyA': movePlayer(-1, 0); e.preventDefault(); break
      case 'ArrowRight': case 'KeyD': movePlayer(1, 0); e.preventDefault(); break
    }
  })

  // Prevent pull-to-refresh
  let lastTouchY = 0
  document.addEventListener('touchstart', e => {
    lastTouchY = e.touches[0].clientY
  }, { passive: true })

  document.addEventListener('touchmove', e => {
    if (window.scrollY === 0 && e.touches[0].clientY > lastTouchY) {
      e.preventDefault()
    }
  }, { passive: false })

  // Mobile controls
  const addTouchControl = (id, dx, dy) => {
    const btn = document.getElementById(id)
    btn.addEventListener('touchstart', e => {
      e.preventDefault()
      initAudio()
      if (!gameOver) movePlayer(dx, dy)
    })
  }

  addTouchControl('btn-up', 0, -1)
  addTouchControl('btn-down', 0, 1)
  addTouchControl('btn-left', -1, 0)
  addTouchControl('btn-right', 1, 0)
}

function setupUI() {
  document.getElementById('new-game').addEventListener('click', () => { level = 0; lives = 3; score = 0; startGame() })
  document.getElementById('play-again').addEventListener('click', () => { level = 0; lives = 3; score = 0; startGame() })
  loginBtn.addEventListener('click', handleLoginClick)
  document.getElementById('login-extension').addEventListener('click', loginWithExtension)
  document.getElementById('login-privkey').addEventListener('click', loginWithPrivkey)
  document.getElementById('close-modal').addEventListener('click', closeModal)
  document.getElementById('refresh-leaderboard').addEventListener('click', refreshLeaderboard)
  loginModal.addEventListener('click', e => { if (e.target === loginModal) closeModal() })
  updateLoginUI()
}

function startGame() {
  gameOver = false
  gameRunning = true
  exitOpen = false
  explosions = []
  falling = new Set()

  loadLevel(level)

  scoreEl.textContent = score
  livesEl.textContent = lives
  gameMessage.classList.remove('active')

  lastUpdate = performance.now()
  requestAnimationFrame(gameLoop)
}

function loadLevel(n) {
  const lvl = LEVELS[n % LEVELS.length]
  diamondsNeeded = lvl.diamonds
  timeLeft = lvl.time
  diamonds = 0

  caveEl.textContent = lvl.name
  diamondsEl.textContent = diamonds
  diamondsNeededEl.textContent = diamondsNeeded
  timeEl.textContent = timeLeft

  // Parse map
  const lines = lvl.map.trim().split('\n')
  grid = []

  for (let y = 0; y < gridHeight; y++) {
    grid[y] = []
    const line = lines[y] || ''
    for (let x = 0; x < gridWidth; x++) {
      const char = line[x] || ' '
      switch(char) {
        case 'W': grid[y][x] = WALL; break
        case 'S': grid[y][x] = STEEL; break
        case '.': grid[y][x] = DIRT; break
        case ' ': grid[y][x] = EMPTY; break
        case 'r': grid[y][x] = BOULDER; break
        case 'd': grid[y][x] = DIAMOND; break
        case 'P': grid[y][x] = EMPTY; playerX = x; playerY = y; break
        case 'X': grid[y][x] = EXIT; break
        case 'F': grid[y][x] = FIREFLY; break
        case 'B': grid[y][x] = BUTTERFLY; break
        default: grid[y][x] = EMPTY
      }
    }
  }
}

function movePlayer(dx, dy) {
  const nx = playerX + dx
  const ny = playerY + dy

  if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) return

  const target = grid[ny][nx]

  // Can't move into walls or steel
  if (target === WALL || target === STEEL) return

  // Can't move into closed exit
  if (target === EXIT && !exitOpen) return

  // Collect diamond
  if (target === DIAMOND) {
    diamonds++
    score += 10
    diamondsEl.textContent = diamonds
    scoreEl.textContent = score
    playDiamond()

    if (diamonds >= diamondsNeeded && !exitOpen) {
      exitOpen = true
      // Open all exits
      for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
          if (grid[y][x] === EXIT) grid[y][x] = EXIT_OPEN
        }
      }
    }
  }

  // Push boulder horizontally
  if (target === BOULDER && dy === 0) {
    const bx = nx + dx
    if (bx >= 0 && bx < gridWidth && grid[ny][bx] === EMPTY) {
      grid[ny][bx] = BOULDER
      grid[ny][nx] = EMPTY
      playBoulder()
    } else {
      return // Can't push
    }
  }

  // Move into enemies = death
  if (target === FIREFLY || target === BUTTERFLY) {
    killPlayer()
    return
  }

  // Reach open exit = win level
  if (target === EXIT_OPEN) {
    score += timeLeft * 2
    scoreEl.textContent = score
    playWin()
    level++
    if (level >= LEVELS.length) {
      endGame(true)
    } else {
      setTimeout(() => startGame(), 500)
    }
    return
  }

  // Dig dirt
  if (target === DIRT) {
    playDig()
  }

  // Move player
  grid[ny][nx] = EMPTY
  playerX = nx
  playerY = ny
}

function killPlayer() {
  playDeath()
  playExplosion()

  // Explosion at player position
  explode(playerX, playerY, false)

  lives--
  livesEl.textContent = lives

  if (lives <= 0) {
    setTimeout(() => endGame(false), 500)
  } else {
    setTimeout(() => startGame(), 1000)
  }
}

function explode(cx, cy, makeDiamonds) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) continue
      if (grid[y][x] === STEEL) continue

      // Kill player if in blast
      if (x === playerX && y === playerY) {
        killPlayer()
        return
      }

      grid[y][x] = makeDiamonds ? DIAMOND_BIRTH : EXPLOSION
      explosions.push({ x, y, timer: 10, makeDiamonds })
    }
  }
  playExplosion()
}

function updatePhysics() {
  // Process explosions
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i]
    e.timer--
    if (e.timer <= 0) {
      grid[e.y][e.x] = e.makeDiamonds ? DIAMOND : EMPTY
      explosions.splice(i, 1)
    }
  }

  // Update falling objects (boulders and diamonds)
  // Scan from bottom to top
  const newFalling = new Set()

  for (let y = gridHeight - 2; y >= 0; y--) {
    for (let x = 0; x < gridWidth; x++) {
      const tile = grid[y][x]
      if (tile !== BOULDER && tile !== DIAMOND) continue

      const below = grid[y + 1][x]
      const wasFalling = falling.has(`${x},${y}`)

      // Fall straight down
      if (below === EMPTY) {
        grid[y + 1][x] = tile
        grid[y][x] = EMPTY
        newFalling.add(`${x},${y + 1}`)

        // Check if landed on player or enemy
        if (y + 1 === playerY && x === playerX) {
          killPlayer()
          return
        }
        if (grid[y + 2] && (grid[y + 2][x] === FIREFLY || grid[y + 2][x] === BUTTERFLY)) {
          // Will be handled next frame when it lands
        }
      }
      // Hit something while falling
      else if (wasFalling) {
        if (y + 1 === playerY && x === playerX) {
          killPlayer()
          return
        }
        if (below === FIREFLY) {
          explode(x, y + 1, false)
        } else if (below === BUTTERFLY) {
          explode(x, y + 1, true)
        } else {
          playBoulder()
        }
      }
      // Roll off rounded objects
      else if (below === BOULDER || below === DIAMOND || below === WALL) {
        // Try left
        if (x > 0 && grid[y][x - 1] === EMPTY && grid[y + 1][x - 1] === EMPTY) {
          grid[y][x - 1] = tile
          grid[y][x] = EMPTY
          newFalling.add(`${x - 1},${y}`)
        }
        // Try right
        else if (x < gridWidth - 1 && grid[y][x + 1] === EMPTY && grid[y + 1][x + 1] === EMPTY) {
          grid[y][x + 1] = tile
          grid[y][x] = EMPTY
          newFalling.add(`${x + 1},${y}`)
        }
      }
    }
  }

  falling = newFalling

  // Update enemies
  updateEnemies()
}

function updateEnemies() {
  const enemies = []

  // Find all enemies
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (grid[y][x] === FIREFLY || grid[y][x] === BUTTERFLY) {
        enemies.push({ x, y, type: grid[y][x] })
      }
    }
  }

  // Move enemies
  for (const enemy of enemies) {
    // Simple AI: move randomly in empty spaces
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]]

    // Shuffle directions for variety
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]]
    }

    for (const [dx, dy] of dirs) {
      const nx = enemy.x + dx
      const ny = enemy.y + dy
      if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue

      const target = grid[ny][nx]
      if (target === EMPTY) {
        grid[enemy.y][enemy.x] = EMPTY
        grid[ny][nx] = enemy.type

        // Check if touched player
        if (nx === playerX && ny === playerY) {
          killPlayer()
          return
        }
        break
      }
      // Touch player
      if (nx === playerX && ny === playerY) {
        killPlayer()
        return
      }
    }
  }
}

function updateTimer() {
  if (gameOver || !gameRunning) return

  timeLeft--
  timeEl.textContent = timeLeft

  if (timeLeft <= 0) {
    killPlayer()
  }
}

let timerInterval = null

function gameLoop(timestamp) {
  if (!gameRunning) return

  // Physics update at fixed interval
  if (timestamp - lastUpdate >= updateInterval) {
    updatePhysics()
    lastUpdate = timestamp
  }

  render()

  if (!gameOver) {
    requestAnimationFrame(gameLoop)
  }
}

function render() {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Draw grid
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const tile = grid[y][x]
      if (tile === EMPTY) continue

      const px = x * tileSize
      const py = y * tileSize

      switch(tile) {
        case DIRT:
          ctx.fillStyle = '#8b4513'
          ctx.fillRect(px, py, tileSize, tileSize)
          ctx.fillStyle = '#a0522d'
          ctx.fillRect(px + 2, py + 2, tileSize - 4, tileSize - 4)
          break

        case WALL:
          ctx.fillStyle = '#808080'
          ctx.fillRect(px, py, tileSize, tileSize)
          ctx.fillStyle = '#a0a0a0'
          ctx.fillRect(px, py, tileSize - 1, tileSize - 1)
          ctx.fillStyle = '#606060'
          ctx.fillRect(px + 1, py + 1, tileSize - 1, tileSize - 1)
          ctx.fillStyle = '#808080'
          ctx.fillRect(px + 1, py + 1, tileSize - 2, tileSize - 2)
          break

        case STEEL:
          ctx.fillStyle = '#404040'
          ctx.fillRect(px, py, tileSize, tileSize)
          break

        case BOULDER:
          ctx.fillStyle = '#a0a0a0'
          ctx.beginPath()
          ctx.arc(px + tileSize/2, py + tileSize/2, tileSize/2 - 1, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#c0c0c0'
          ctx.beginPath()
          ctx.arc(px + tileSize/2 - 2, py + tileSize/2 - 2, tileSize/4, 0, Math.PI * 2)
          ctx.fill()
          break

        case DIAMOND:
        case DIAMOND_BIRTH:
          const flash = tile === DIAMOND_BIRTH || Math.sin(Date.now() / 100) > 0
          ctx.fillStyle = flash ? '#ffffff' : '#00ffff'
          ctx.beginPath()
          ctx.moveTo(px + tileSize/2, py + 1)
          ctx.lineTo(px + tileSize - 2, py + tileSize/2)
          ctx.lineTo(px + tileSize/2, py + tileSize - 1)
          ctx.lineTo(px + 2, py + tileSize/2)
          ctx.closePath()
          ctx.fill()
          break

        case EXIT:
          ctx.fillStyle = '#303030'
          ctx.fillRect(px, py, tileSize, tileSize)
          ctx.strokeStyle = '#505050'
          ctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4)
          break

        case EXIT_OPEN:
          const pulse = Math.sin(Date.now() / 150) * 0.5 + 0.5
          ctx.fillStyle = `rgb(0, ${Math.floor(150 + pulse * 105)}, 0)`
          ctx.fillRect(px, py, tileSize, tileSize)
          ctx.fillStyle = '#00ff00'
          ctx.fillRect(px + 3, py + 3, tileSize - 6, tileSize - 6)
          break

        case FIREFLY:
          const ffPulse = Math.sin(Date.now() / 80) > 0
          ctx.fillStyle = ffPulse ? '#ff0000' : '#ff6600'
          ctx.fillRect(px + 2, py + 2, tileSize - 4, tileSize - 4)
          ctx.fillStyle = '#ffff00'
          ctx.fillRect(px + 4, py + 4, 2, 2)
          ctx.fillRect(px + tileSize - 6, py + 4, 2, 2)
          break

        case BUTTERFLY:
          const bfPulse = Math.sin(Date.now() / 100) > 0
          ctx.fillStyle = bfPulse ? '#ff00ff' : '#ff88ff'
          // Wings
          ctx.beginPath()
          ctx.ellipse(px + tileSize/4, py + tileSize/2, tileSize/4, tileSize/3, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.beginPath()
          ctx.ellipse(px + 3*tileSize/4, py + tileSize/2, tileSize/4, tileSize/3, 0, 0, Math.PI * 2)
          ctx.fill()
          // Body
          ctx.fillStyle = '#000'
          ctx.fillRect(px + tileSize/2 - 1, py + 2, 2, tileSize - 4)
          break

        case EXPLOSION:
          const expPhase = Math.random()
          ctx.fillStyle = `hsl(${30 + expPhase * 30}, 100%, ${50 + expPhase * 30}%)`
          ctx.fillRect(px, py, tileSize, tileSize)
          break
      }
    }
  }

  // Draw player
  if (!gameOver) {
    const px = playerX * tileSize
    const py = playerY * tileSize

    // Body
    ctx.fillStyle = '#ffff00'
    ctx.beginPath()
    ctx.arc(px + tileSize/2, py + tileSize/2, tileSize/2 - 1, 0, Math.PI * 2)
    ctx.fill()

    // Eyes
    ctx.fillStyle = '#000'
    ctx.fillRect(px + 3, py + 4, 2, 2)
    ctx.fillRect(px + tileSize - 5, py + 4, 2, 2)

    // Mouth
    ctx.fillRect(px + 4, py + tileSize - 5, tileSize - 8, 2)
  }
}

async function endGame(won) {
  gameOver = true
  gameRunning = false

  if (score > best) {
    best = score
    localStorage.setItem('boulderdash-best', best)
    bestEl.textContent = best
  }

  messageText.textContent = won ? 'Congratulations!' : 'Game Over!'
  gameMessage.classList.add('active')

  const user = nostr.getCurrentUser()
  if (user && score > 0) {
    try {
      const result = await nostr.publishScore(score)
      if (result) {
        messageText.textContent = (won ? 'Congratulations!' : 'Game Over!') + ' Score saved!'
        setTimeout(refreshLeaderboard, 1500)
      }
    } catch (err) {
      console.error('Failed to publish score:', err)
    }
  }
}

// Timer
setInterval(updateTimer, 1000)

// Login handling
function handleLoginClick() {
  const user = nostr.getCurrentUser()
  if (user) {
    nostr.logout()
    updateLoginUI()
  } else {
    loginModal.classList.add('active')
  }
}

async function loginWithExtension() {
  try {
    await nostr.loginWithExtension()
    closeModal()
    updateLoginUI()
    refreshLeaderboard()
  } catch (err) {
    alert(err.message)
  }
}

async function loginWithPrivkey() {
  const input = document.getElementById('privkey-input')
  try {
    await nostr.loginWithPrivkey(input.value)
    input.value = ''
    closeModal()
    updateLoginUI()
    refreshLeaderboard()
  } catch (err) {
    alert(err.message)
  }
}

function closeModal() {
  loginModal.classList.remove('active')
}

function updateLoginUI() {
  const user = nostr.getCurrentUser()
  if (user) {
    loginBtn.textContent = 'Logout'
    loginBtn.classList.add('logged-in')
  } else {
    loginBtn.textContent = 'Login'
    loginBtn.classList.remove('logged-in')
  }
}

async function refreshLeaderboard() {
  const list = document.getElementById('leaderboard-list')
  if (!list) return

  list.innerHTML = '<li class="loading">Loading...</li>'

  try {
    const scores = await nostr.fetchLeaderboard(10)

    if (scores.length === 0) {
      list.innerHTML = '<li class="empty">No scores yet. Be the first!</li>'
      return
    }

    const pubkeys = scores.map(s => s.pubkey)
    const metadata = await nostr.fetchMetadata(pubkeys)

    list.innerHTML = scores.map((entry, i) => {
      const meta = metadata.get(entry.pubkey)
      const displayName = meta?.name || nostr.formatPubkey(entry.pubkey)
      const profileUrl = `https://nostr.rocks/users/${entry.pubkey}`

      return `
        <li>
          <span class="rank">${i + 1}</span>
          <a href="${profileUrl}" target="_blank" class="player" title="${nostr.pubkeyToDid(entry.pubkey)}">${displayName}</a>
          <span class="score">${entry.score.toLocaleString()}</span>
        </li>
      `
    }).join('')
  } catch (err) {
    console.error('Failed to fetch leaderboard:', err)
    list.innerHTML = '<li class="error">Failed to load</li>'
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
