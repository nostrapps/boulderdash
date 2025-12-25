/**
 * Nostr module for Boulder Dash game
 * Handles authentication, event signing, and relay communication
 */

// Import noble-curves for schnorr signatures
import { schnorr } from 'https://esm.sh/@noble/curves@1.7.0/secp256k1'

// Relays for publishing and fetching scores
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
]

// Game identifier for d tag
const GAME_ID = 'boulderdash-nostrapps'

// Current user state
let currentUser = null
let privateKeyHex = null

// Hex encoding/decoding
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// SHA-256 hash
async function sha256(data) {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return new Uint8Array(hash)
}

// Get public key from private key using noble-curves
function getPublicKey(privKeyHex) {
  return bytesToHex(schnorr.getPublicKey(privKeyHex))
}

// Create schnorr signature using noble-curves
async function schnorrSign(messageHash, privKeyHex) {
  const sig = schnorr.sign(messageHash, privKeyHex)
  return bytesToHex(sig)
}

// Create event ID (SHA-256 of serialized event)
async function getEventId(event) {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content
  ])
  const hash = await sha256(serialized)
  return bytesToHex(hash)
}

// Sign event with private key
async function signEventWithPrivkey(event, privKeyHex) {
  event.pubkey = getPublicKey(privKeyHex)
  event.id = await getEventId(event)
  event.sig = await schnorrSign(hexToBytes(event.id), privKeyHex)
  return event
}

// Sign event with extension (NIP-07)
async function signEventWithExtension(event) {
  if (!window.nostr) throw new Error('No Nostr extension found')
  return await window.nostr.signEvent(event)
}

/**
 * Login with Nostr extension (NIP-07)
 */
export async function loginWithExtension() {
  if (!window.nostr) {
    throw new Error('No Nostr extension found. Please install Alby or nos2x.')
  }

  try {
    const pubkey = await window.nostr.getPublicKey()
    currentUser = { pubkey, method: 'extension' }
    privateKeyHex = null
    return pubkey
  } catch (err) {
    throw new Error('Extension login failed: ' + err.message)
  }
}

/**
 * Login with private key (hex or nsec)
 */
export async function loginWithPrivkey(key) {
  let hex = key.trim()

  // Convert nsec to hex if needed
  if (hex.startsWith('nsec1')) {
    hex = bech32ToHex(hex)
  }

  // Validate hex
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Invalid private key. Must be 64 hex characters or nsec.')
  }

  privateKeyHex = hex.toLowerCase()
  const pubkey = getPublicKey(privateKeyHex)
  currentUser = { pubkey, method: 'privkey' }
  return pubkey
}

/**
 * Bech32 decode (simplified for nsec)
 */
function bech32ToHex(bech32) {
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  const data = bech32.slice(5) // Remove 'nsec1' prefix
  const decoded = []

  for (const char of data) {
    const idx = CHARSET.indexOf(char)
    if (idx === -1) throw new Error('Invalid bech32 character')
    decoded.push(idx)
  }

  // Convert 5-bit to 8-bit
  let acc = 0
  let bits = 0
  const bytes = []

  for (const value of decoded.slice(0, -6)) { // Remove checksum
    acc = (acc << 5) | value
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((acc >> bits) & 0xff)
    }
  }

  return bytesToHex(new Uint8Array(bytes))
}

/**
 * Logout
 */
export function logout() {
  currentUser = null
  privateKeyHex = null
}

/**
 * Get current user
 */
export function getCurrentUser() {
  return currentUser
}

/**
 * Check if extension is available
 */
export function hasExtension() {
  return typeof window !== 'undefined' && !!window.nostr
}

/**
 * Fetch current user's score from relays
 */
export async function fetchUserScore(pubkey) {
  const filter = {
    kinds: [33334],
    authors: [pubkey],
    '#d': [GAME_ID]
  }

  const results = await Promise.allSettled(
    RELAYS.map(url => queryRelay(url, filter))
  )

  let highestScore = 0
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      const score = parseInt(event.content)
      if (!isNaN(score) && score > highestScore) {
        highestScore = score
      }
    }
  }

  return highestScore
}

/**
 * Publish score to relays (only if higher than existing)
 */
export async function publishScore(score) {
  if (!currentUser) throw new Error('Not logged in')

  // Check if new score is higher than existing
  const existingScore = await fetchUserScore(currentUser.pubkey)
  if (score <= existingScore) {
    console.log(`Score ${score} not higher than existing ${existingScore}, skipping publish`)
    return null
  }

  const event = {
    kind: 33334,
    content: String(score),
    tags: [['d', GAME_ID]],
    created_at: Math.floor(Date.now() / 1000)
  }

  // Sign event
  let signedEvent
  try {
    if (currentUser.method === 'extension') {
      signedEvent = await signEventWithExtension(event)
    } else {
      signedEvent = await signEventWithPrivkey(event, privateKeyHex)
    }
    console.log('Event signed:', signedEvent)
  } catch (err) {
    console.error('Signing failed:', err)
    throw new Error('Failed to sign event: ' + err.message)
  }

  // Publish to relays
  const results = await Promise.allSettled(
    RELAYS.map(url => publishToRelay(url, signedEvent))
  )

  console.log('Relay results:', results)

  const success = results.some(r => r.status === 'fulfilled')
  if (!success) {
    const errors = results.map(r => r.reason?.message || 'Unknown').join(', ')
    throw new Error('Failed to publish: ' + errors)
  }

  return signedEvent
}

/**
 * Publish event to a single relay
 */
function publishToRelay(url, event) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('Timeout'))
    }, 5000)

    ws.onopen = () => {
      ws.send(JSON.stringify(['EVENT', event]))
    }

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data)
      if (data[0] === 'OK') {
        clearTimeout(timeout)
        ws.close()
        if (data[2]) resolve(data)
        else reject(new Error(data[3] || 'Rejected'))
      }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Connection failed'))
    }
  })
}

/**
 * Fetch leaderboard from relays
 */
export async function fetchLeaderboard(limit = 50) {
  const filter = {
    kinds: [33334],
    '#d': [GAME_ID],
    limit: limit * 3
  }

  const results = await Promise.allSettled(
    RELAYS.map(url => queryRelay(url, filter))
  )

  const scoreMap = new Map()

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      const score = parseInt(event.content)
      if (isNaN(score)) continue

      const existing = scoreMap.get(event.pubkey)
      if (!existing || score > existing.score) {
        scoreMap.set(event.pubkey, {
          pubkey: event.pubkey,
          score,
          created_at: event.created_at
        })
      }
    }
  }

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * Query a single relay
 */
function queryRelay(url, filter) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const events = []
    const subId = Math.random().toString(36).slice(2)

    const timeout = setTimeout(() => {
      ws.close()
      resolve(events)
    }, 5000)

    ws.onopen = () => {
      ws.send(JSON.stringify(['REQ', subId, filter]))
    }

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data)
      if (data[0] === 'EVENT' && data[1] === subId) {
        events.push(data[2])
      } else if (data[0] === 'EOSE') {
        clearTimeout(timeout)
        ws.close()
        resolve(events)
      }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Connection failed'))
    }
  })
}

/**
 * Fetch user metadata (kind 0) for multiple pubkeys
 */
export async function fetchMetadata(pubkeys) {
  if (pubkeys.length === 0) return new Map()

  const filter = {
    kinds: [0],
    authors: pubkeys
  }

  const results = await Promise.allSettled(
    RELAYS.map(url => queryRelay(url, filter))
  )

  const metadataMap = new Map()

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const event of result.value) {
      try {
        const existing = metadataMap.get(event.pubkey)
        if (!existing || event.created_at > existing.created_at) {
          const content = JSON.parse(event.content)
          metadataMap.set(event.pubkey, {
            name: content.display_name || content.name || null,
            picture: content.picture || null,
            created_at: event.created_at
          })
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }
  }

  return metadataMap
}

/**
 * Format pubkey for display (truncated)
 */
export function formatPubkey(pubkey) {
  return pubkey.slice(0, 8) + '...' + pubkey.slice(-4)
}

/**
 * Convert pubkey to did:nostr format
 */
export function pubkeyToDid(pubkey) {
  return `did:nostr:${pubkey.toLowerCase()}`
}

/**
 * Format DID for display (truncated)
 */
export function formatDid(pubkey) {
  return `did:nostr:${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`
}
