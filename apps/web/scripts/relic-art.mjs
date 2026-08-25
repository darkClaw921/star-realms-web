/**
 * Рисует иллюстрации артефактов забега в public/cards/relics/.
 *
 * Наши, а не издателя, и потому единственный арт в этом проекте, который
 * лежит в репозитории: артефактов в Star Realms нет, скачивать нечего, а
 * случайная картинка из сети — это чужие права в чужом репозитории.
 *
 * Генератором, а не четырнадцатью файлами руками: общая часть — тёмный фон,
 * звёзды, виньетка — у всех одна, и правится она тогда в одном месте. Скрипт
 * идемпотентен (звёзды раскладывает свой ГПСЧ от идентификатора), поэтому
 * повторный запуск не трогает файлы и не будит наблюдателей сборки.
 *
 * Запуск: node scripts/relic-art.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'public', 'cards', 'relics')

/** Пропорции окна карты: тот же 4:3, что у остального арта. */
const W = 320
const H = 240

/** Мелкий ГПСЧ, чтобы звёздное поле было своим у каждой карты и одним и тем же при каждом запуске. */
function rng(seed) {
  let s = 0
  for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function stars(seed, n = 46) {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < n; i++) {
    const x = (r() * W).toFixed(1)
    const y = (r() * H).toFixed(1)
    const rad = (0.5 + r() * 1.2).toFixed(2)
    const o = (0.12 + r() * 0.38).toFixed(2)
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff" opacity="${o}"/>`
  }
  return out
}

/**
 * Общая рамка. Эмблема рисуется поверх фона и под виньеткой: виньетка гасит
 * углы, где на карте лежат цена, название и оборона.
 *
 * И поднимается в видимую зону. Карта показывает арт своей шириной, сверху, а
 * низ растворяет маской (globals.css: linear-gradient to bottom, #000 58%) —
 * то есть всё ниже примерно 140-й строки на карте уже не видно. Эмблемы
 * рисуются в естественном центре холста, а этот сдвиг переносит их туда, где
 * они целиком помещаются: так каждая картинка остаётся читаемой сама по себе.
 */
const SAFE = 'translate(160 98) scale(0.84) translate(-160 -118)'

function svg(id, ground, emblem) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
<defs>
<radialGradient id="bg" cx="50%" cy="36%" r="82%">
<stop offset="0" stop-color="${ground}"/><stop offset="1" stop-color="#070a12"/>
</radialGradient>
<radialGradient id="vig" cx="50%" cy="45%" r="70%">
<stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.72"/>
</radialGradient>
<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
<feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${stars(id)}
<g transform="${SAFE}">${emblem}</g>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>`
}

/** Мягкое световое пятно под эмблемой — иначе она висит в пустоте. */
const halo = (c, cx = 160, cy = 118, r = 82) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="0.2" filter="url(#glow)"/>`

const RELICS = [
  {
    id: 'rl-viper-fangs',
    ground: '#12241a',
    art: (c = '#5fd08a') => `
${halo(c)}
<path d="M110 58 Q160 44 210 58" fill="none" stroke="${c}" stroke-opacity="0.5" stroke-width="4" stroke-linecap="round"/>
<path d="M124 62 Q136 118 143 168 Q152 116 146 62 Z" fill="${c}"/>
<path d="M196 62 Q184 118 177 168 Q168 116 174 62 Z" fill="${c}"/>
<path d="M124 62 Q136 118 143 168 Q147 118 141 62 Z" fill="#fff" opacity="0.28"/>
<circle cx="143" cy="186" r="6" fill="${c}" opacity="0.85"/>
<circle cx="177" cy="182" r="4.5" fill="${c}" opacity="0.6"/>
<circle cx="160" cy="206" r="3" fill="${c}" opacity="0.4"/>`,
  },
  {
    id: 'rl-scout-scanners',
    ground: '#0d1c2c',
    art: (c = '#6fb7f0') => `
${halo(c)}
<circle cx="160" cy="120" r="74" fill="none" stroke="${c}" stroke-opacity="0.28" stroke-width="2"/>
<circle cx="160" cy="120" r="52" fill="none" stroke="${c}" stroke-opacity="0.36" stroke-width="2"/>
<circle cx="160" cy="120" r="28" fill="none" stroke="${c}" stroke-opacity="0.5" stroke-width="2"/>
<path d="M160 120 L160 46 A74 74 0 0 1 226 96 Z" fill="${c}" opacity="0.22"/>
<line x1="160" y1="120" x2="160" y2="46" stroke="${c}" stroke-width="2.5" stroke-opacity="0.85"/>
<line x1="70" y1="120" x2="250" y2="120" stroke="${c}" stroke-opacity="0.18" stroke-width="1.5"/>
<line x1="160" y1="30" x2="160" y2="210" stroke="${c}" stroke-opacity="0.18" stroke-width="1.5"/>
<circle cx="203" cy="88" r="6" fill="${c}" filter="url(#glow)"/>
<circle cx="120" cy="152" r="3.5" fill="${c}" opacity="0.7"/>`,
  },
  {
    id: 'rl-dock-crew',
    ground: '#2a1f0c',
    art: (c = '#f0b429') => `
${halo(c)}
<rect x="60" y="44" width="12" height="150" fill="${c}" opacity="0.9"/>
<rect x="60" y="44" width="150" height="11" fill="${c}" opacity="0.9"/>
<path d="M72 60 L110 90" stroke="${c}" stroke-opacity="0.45" stroke-width="4"/>
<line x1="196" y1="55" x2="196" y2="104" stroke="${c}" stroke-width="2.5" stroke-opacity="0.8"/>
<path d="M188 104 q8 26 8 30 q0 12 -12 12 q-10 0 -10 -10" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/>
<rect x="96" y="158" width="120" height="46" rx="6" fill="#0e1522" stroke="${c}" stroke-opacity="0.7" stroke-width="2"/>
<rect x="108" y="170" width="16" height="12" fill="${c}" opacity="0.8"/>
<rect x="132" y="170" width="16" height="12" fill="${c}" opacity="0.45"/>
<rect x="156" y="170" width="16" height="12" fill="${c}" opacity="0.8"/>
<rect x="180" y="170" width="16" height="12" fill="${c}" opacity="0.35"/>
<rect x="52" y="192" width="150" height="8" rx="3" fill="${c}" opacity="0.55"/>`,
  },
  {
    id: 'rl-swarm-doctrine',
    ground: '#122417',
    art: (c = '#5fd08a') => {
      const hex = (x, y, r, o) => {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2
          return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`
        }).join(' ')
        return `<polygon points="${pts}" fill="${c}" opacity="${o}" stroke="${c}" stroke-opacity="0.9" stroke-width="2"/>`
      }
      return `
${halo(c)}
<line x1="160" y1="118" x2="108" y2="86" stroke="${c}" stroke-opacity="0.35" stroke-width="2"/>
<line x1="160" y1="118" x2="214" y2="88" stroke="${c}" stroke-opacity="0.35" stroke-width="2"/>
<line x1="160" y1="118" x2="112" y2="160" stroke="${c}" stroke-opacity="0.35" stroke-width="2"/>
<line x1="160" y1="118" x2="210" y2="162" stroke="${c}" stroke-opacity="0.35" stroke-width="2"/>
<line x1="160" y1="118" x2="160" y2="184" stroke="${c}" stroke-opacity="0.35" stroke-width="2"/>
${hex(160, 118, 30, 0.45)}
${hex(108, 86, 17, 0.3)}
${hex(214, 88, 15, 0.3)}
${hex(112, 160, 14, 0.25)}
${hex(210, 162, 18, 0.3)}
${hex(160, 184, 12, 0.22)}
<circle cx="160" cy="118" r="9" fill="#eafff2" opacity="0.85"/>`
    },
  },
  {
    id: 'rl-war-drums',
    ground: '#2a1210',
    art: (c = '#f4593c') => `
${halo(c)}
<g>
<ellipse cx="122" cy="112" rx="42" ry="16" fill="${c}" opacity="0.9"/>
<path d="M80 112 v42 a42 16 0 0 0 84 0 v-42" fill="#160c0e" stroke="${c}" stroke-width="2.5" stroke-opacity="0.8"/>
<ellipse cx="122" cy="112" rx="42" ry="16" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>
<path d="M84 122 l76 0" stroke="${c}" stroke-opacity="0.4" stroke-width="2"/>
</g>
<g>
<ellipse cx="208" cy="140" rx="30" ry="12" fill="${c}" opacity="0.75"/>
<path d="M178 140 v30 a30 12 0 0 0 60 0 v-30" fill="#160c0e" stroke="${c}" stroke-width="2.5" stroke-opacity="0.7"/>
</g>
<g stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="0.95">
<line x1="96" y1="76" x2="164" y2="34"/>
<line x1="152" y1="76" x2="84" y2="34"/>
</g>
<circle cx="164" cy="34" r="9" fill="${c}"/>
<circle cx="84" cy="34" r="9" fill="${c}"/>`,
  },
  {
    id: 'rl-trade-charter',
    ground: '#2a2410',
    art: (c = '#f0b429') => `
${halo(c)}
<path d="M78 62 q82 -14 164 0 v112 q-82 -14 -164 0 z" fill="#efe4c8" opacity="0.94"/>
<path d="M78 62 q-14 6 -14 20 q0 14 14 20 z" fill="#c9b98f"/>
<path d="M242 62 q14 6 14 20 q0 14 -14 20 z" fill="#c9b98f"/>
<g stroke="#8a7b52" stroke-width="3" stroke-linecap="round" opacity="0.7">
<line x1="100" y1="92" x2="220" y2="92"/>
<line x1="100" y1="110" x2="220" y2="110"/>
<line x1="100" y1="128" x2="184" y2="128"/>
</g>
<circle cx="204" cy="150" r="19" fill="${c}"/>
<circle cx="204" cy="150" r="19" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="2"/>
<path d="M196 150 l6 7 l12 -14" fill="none" stroke="#2a2410" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: 'rl-hull-plating',
    ground: '#16202e',
    art: (c = '#a9c4e6') => {
      const rivets = (x, y, w) => Array.from({ length: 4 }, (_, i) =>
        `<circle cx="${x + 14 + i * ((w - 28) / 3)}" cy="${y}" r="3.4" fill="#0a0f18" opacity="0.9"/>`).join('')
      return `
${halo(c)}
<g>
<rect x="64" y="60" width="136" height="60" rx="10" fill="#54688a" stroke="${c}" stroke-width="2.5"/>
${rivets(64, 74, 136)}
<rect x="108" y="104" width="146" height="60" rx="10" fill="#7d94b8" stroke="${c}" stroke-width="2.5"/>
${rivets(108, 118, 146)}
<rect x="76" y="148" width="126" height="52" rx="10" fill="#455873" stroke="${c}" stroke-width="2.5"/>
${rivets(76, 162, 126)}
</g>
<path d="M112 109 l138 0" stroke="#fff" stroke-opacity="0.45" stroke-width="3"/>
<path d="M69 65 l126 0" stroke="#fff" stroke-opacity="0.3" stroke-width="3"/>
<path d="M81 153 l116 0" stroke="#fff" stroke-opacity="0.22" stroke-width="3"/>`
    },
  },
  {
    id: 'rl-shield-array',
    ground: '#0e2230',
    art: (c = '#58cfe0') => {
      const hex = (x, y, r) => {
        const pts = Array.from({ length: 6 }, (_, i) => {
          const a = (Math.PI / 3) * i - Math.PI / 2
          return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`
        }).join(' ')
        return `<polygon points="${pts}" fill="none" stroke="${c}" stroke-opacity="0.55" stroke-width="1.6"/>`
      }
      let lattice = ''
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 4; col++) {
          const x = 112 + col * 32 + (row % 2 ? 16 : 0)
          const y = 62 + row * 28
          lattice += hex(x, y, 15)
        }
      }
      return `
${halo(c)}
<clipPath id="sh"><path d="M160 36 l72 26 v52 q0 62 -72 90 q-72 -28 -72 -90 v-52 z"/></clipPath>
<g clip-path="url(#sh)">
<rect width="${W}" height="${H}" fill="${c}" opacity="0.14"/>
${lattice}
</g>
<path d="M160 36 l72 26 v52 q0 62 -72 90 q-72 -28 -72 -90 v-52 z" fill="none" stroke="${c}" stroke-width="4" filter="url(#glow)"/>
<path d="M160 36 l72 26 v52 q0 62 -72 90" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>`
    },
  },
  {
    id: 'rl-salvage-rig',
    ground: '#2a1c0e',
    art: (c = '#f08b29') => `
${halo(c)}
<line x1="160" y1="26" x2="160" y2="70" stroke="${c}" stroke-width="4" stroke-opacity="0.7"/>
<rect x="140" y="66" width="40" height="22" rx="5" fill="${c}" opacity="0.9"/>
<path d="M144 88 q-30 30 -26 66" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
<path d="M176 88 q30 30 26 66" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>
<path d="M160 90 v52" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round" opacity="0.75"/>
<polygon points="132,140 196,132 210,178 146,192" fill="#5b6474" opacity="0.85" stroke="${c}" stroke-opacity="0.6" stroke-width="2"/>
<polygon points="132,140 168,136 162,186 146,192" fill="#79839a" opacity="0.6"/>
<circle cx="118" cy="160" r="3" fill="${c}"/>
<circle cx="214" cy="152" r="2.4" fill="${c}" opacity="0.8"/>
<circle cx="200" cy="196" r="2" fill="${c}" opacity="0.6"/>`,
  },
  {
    id: 'rl-overclock',
    ground: '#1e1430',
    art: (c = '#b07af0') => {
      const pins = () => {
        let out = ''
        for (let i = 0; i < 4; i++) {
          const p = 92 + i * 34
          out += `<rect x="${p}" y="52" width="12" height="14" rx="3" fill="${c}" opacity="0.7"/>`
          out += `<rect x="${p}" y="174" width="12" height="14" rx="3" fill="${c}" opacity="0.7"/>`
          out += `<rect x="74" y="${p - 8}" width="14" height="12" rx="3" fill="${c}" opacity="0.55"/>`
          out += `<rect x="232" y="${p - 8}" width="14" height="12" rx="3" fill="${c}" opacity="0.55"/>`
        }
        return out
      }
      return `
${halo(c)}
${pins()}
<rect x="86" y="64" width="148" height="112" rx="12" fill="#140d22" stroke="${c}" stroke-width="3"/>
<rect x="102" y="80" width="116" height="80" rx="8" fill="none" stroke="${c}" stroke-opacity="0.4" stroke-width="2"/>
<polygon points="170,74 128,124 156,124 142,170 194,112 164,112" fill="${c}" filter="url(#glow)"/>
<polygon points="170,74 128,124 156,124 150,150 160,112 146,112" fill="#fff" opacity="0.35"/>`
    },
  },
  {
    id: 'rl-deep-reserves',
    ground: '#0e2428',
    art: (c = '#4fc9c0') => `
${halo(c)}
<g>
<rect x="70" y="86" width="72" height="102" rx="8" fill="#122a2e" stroke="${c}" stroke-width="2.5" transform="rotate(-16 106 137)"/>
<rect x="124" y="76" width="72" height="102" rx="8" fill="#16343a" stroke="${c}" stroke-width="2.5" transform="rotate(-3 160 127)"/>
<rect x="178" y="86" width="72" height="102" rx="8" fill="#122a2e" stroke="${c}" stroke-width="2.5" transform="rotate(12 214 137)"/>
</g>
<g fill="${c}" opacity="0.75">
<rect x="140" y="92" width="40" height="6" rx="3"/>
<rect x="140" y="106" width="26" height="6" rx="3"/>
</g>
<circle cx="160" cy="146" r="16" fill="${c}" opacity="0.55"/>
<path d="M152 146 l6 7 l12 -15" fill="none" stroke="#eafcfb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: 'rl-black-market-pass',
    ground: '#26102a',
    art: (c = '#e05fc8') => `
${halo(c)}
<g transform="rotate(-12 160 120)">
<rect x="74" y="72" width="172" height="106" rx="12" fill="#16101c" stroke="${c}" stroke-width="3"/>
<rect x="92" y="92" width="42" height="34" rx="6" fill="${c}" opacity="0.9"/>
<g stroke="${c}" stroke-opacity="0.55" stroke-width="2">
<line x1="98" y1="100" x2="128" y2="100"/><line x1="98" y1="110" x2="128" y2="110"/><line x1="98" y1="120" x2="128" y2="120"/>
</g>
<g fill="${c}">
<rect x="150" y="92" width="4" height="34"/><rect x="158" y="92" width="7" height="34"/>
<rect x="170" y="92" width="3" height="34"/><rect x="178" y="92" width="8" height="34"/>
<rect x="191" y="92" width="4" height="34"/><rect x="200" y="92" width="6" height="34"/>
<rect x="211" y="92" width="3" height="34"/><rect x="219" y="92" width="7" height="34"/>
</g>
<rect x="92" y="142" width="134" height="8" rx="4" fill="${c}" opacity="0.4"/>
<rect x="92" y="156" width="84" height="6" rx="3" fill="${c}" opacity="0.25"/>
</g>`,
  },
  {
    id: 'rl-outpost-cache',
    ground: '#16220f',
    art: (c = '#9fc45a') => `
${halo(c)}
<path d="M84 152 a76 76 0 0 1 152 0 z" fill="#1b2a16" stroke="${c}" stroke-width="3"/>
<path d="M84 152 a76 76 0 0 1 76 -76 l0 76 z" fill="${c}" opacity="0.22"/>
<rect x="66" y="152" width="188" height="20" rx="6" fill="${c}" opacity="0.85"/>
<rect x="80" y="172" width="160" height="28" rx="6" fill="#1b2a16" stroke="${c}" stroke-opacity="0.7" stroke-width="2"/>
<rect x="100" y="180" width="18" height="12" rx="2" fill="${c}" opacity="0.8"/>
<rect x="146" y="180" width="18" height="12" rx="2" fill="${c}" opacity="0.45"/>
<rect x="192" y="180" width="18" height="12" rx="2" fill="${c}" opacity="0.8"/>
<rect x="98" y="106" width="34" height="12" rx="6" fill="${c}" opacity="0.9" transform="rotate(-28 115 112)"/>
<rect x="188" y="106" width="34" height="12" rx="6" fill="${c}" opacity="0.9" transform="rotate(28 205 112)"/>
<path d="M110 60 a68 68 0 0 1 100 0" fill="none" stroke="${c}" stroke-opacity="0.4" stroke-width="3" stroke-dasharray="9 9"/>`,
  },
  {
    id: 'rl-field-hospital',
    ground: '#0e2430',
    art: (c = '#58cfe0') => {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2
        return `${(160 + 78 * Math.cos(a)).toFixed(1)},${(118 + 78 * Math.sin(a)).toFixed(1)}`
      }).join(' ')
      return `
${halo(c)}
<polygon points="${pts}" fill="#0d1d28" stroke="${c}" stroke-width="3.5"/>
<polygon points="${pts}" fill="${c}" opacity="0.1"/>
<g fill="${c}">
<rect x="144" y="70" width="32" height="96" rx="6"/>
<rect x="112" y="102" width="96" height="32" rx="6"/>
</g>
<g fill="#fff" opacity="0.28">
<rect x="144" y="70" width="32" height="96" rx="6"/>
</g>
<path d="M84 178 h34 l10 -20 l14 40 l12 -28 h62"
  fill="none" stroke="${c}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>`
    },
  },
]

await mkdir(OUT, { recursive: true })
let written = 0
for (const r of RELICS) {
  const body = svg(r.id, r.ground, r.art())
  const path = join(OUT, `${r.id}.svg`)
  // Идемпотентность: одинаковое содержимое не переписываем.
  const old = await readFile(path, 'utf8').catch(() => null)
  if (old === body) continue
  await writeFile(path, body)
  written++
}
console.log(`relic art: ${RELICS.length} cards, ${written} written`)
