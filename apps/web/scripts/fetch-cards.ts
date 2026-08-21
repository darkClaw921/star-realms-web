/**
 * Download the base-set card art from the publisher's own server.
 *
 * The 2015/04 upload batch on starrealms.com is exactly the 49 base-set faces --
 * the 46 trade-deck cards plus Scout, Viper and Explorer -- at 724x1023 (ships)
 * and 1023x724 (bases). The WordPress REST API hands back a machine-readable
 * name -> URL map with per-image dimensions, unauthenticated.
 *
 * LEGAL: this art is (c) Wise Wizard Games and there is no fan-content licence.
 * Downloading it for a local, personal, non-distributed build is ordinary
 * personal use. The output directory is gitignored and must stay that way: do not
 * commit it, deploy it publicly, or package it. The game runs perfectly well
 * without any of these files -- missing art degrades to a procedural placeholder.
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { CARDS } from '@sr/engine'

const HERE = dirname(fileURLToPath(import.meta.url))
const ART_DIR = join(HERE, '..', 'public', 'cards', 'art')

const FIELDS = '&_fields=slug,title,source_url,media_details'
const BASE_API = 'https://www.starrealms.com/wp-json/wp/v2/media?media_type=image' + FIELDS

/**
 * The upload batches that hold the card faces, one per set.
 *
 * Base set: April 2015, exactly 49 items and nothing else in the window, so one
 * page is the whole set. Frontiers: October 2018, mixed in with a year of other
 * uploads, so it is paged through and filtered by the publisher's own
 * `SRFRN_Card_` naming. Colony Wars: a single day, 19 August 2016 -- 43 faces at
 * 427x600, plus one unrelated convention banner that the name filter drops.
 *
 * Colony Wars was uploaded three more times (2015 at 225x308, 2017 at 300x420,
 * 2018 as foil variants), and the 2016 batch is the one worth taking: it is the
 * only one large enough that the cropped illustration still clears our 320px
 * output without upscaling.
 */
const SOURCES = [
  {
    set: 'core',
    url: `${BASE_API}&per_page=100&after=2015-04-01T00:00:00&before=2015-05-01T00:00:00`,
    pages: 1,
    expect: 49,
    keep: (): boolean => true,
    id: (title: string): string => toCardId(title),
  },
  {
    set: 'frontiers',
    url: `${BASE_API}&per_page=100&after=2018-01-01T00:00:00&before=2018-12-31T00:00:00`,
    pages: 4,
    expect: 48,
    keep: (title: string): boolean =>
      title.startsWith('SRFRN_Card_') && !title.includes('Scorecard'),
    // "SRFRN_Card_HiveQueen" -> "hive-queen". The scans are named in CamelCase
    // with a set prefix rather than by the printed card name.
    id: (title: string): string =>
      title.replace('SRFRN_Card_', '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
  },
  {
    set: 'crisis',
    url: `${BASE_API}&per_page=100&after=2015-05-01T00:00:00&before=2015-06-01T00:00:00`,
    pages: 2,
    expect: 40,
    // The May 2015 batch mixes all four Crisis packs in with re-uploads of the
    // base set. Crisis cards carry a TWO-digit card number in the middle of the
    // name; the base-set re-uploads carry three. That one digit is the whole
    // filter, and it is the publisher's own numbering rather than a guess.
    // The same batch also holds the first promo pack, named WITHOUT a card
    // number -- CardsWBorders_0043_TheArk. Those are matched by name instead,
    // which is also what keeps the base-set re-uploads out: theirs always carry
    // the three-digit number.
    keep: (title: string): boolean =>
      /^CardsWBorders_\d{4}_\d{2}_/.test(title) || /^CardsWBorders_\d{4}_[A-Za-z]/.test(title),
    id: (title: string): string => {
      const bare = title
        .replace(/^CardsWBorders_\d+_(\d+_)?/, '')
        // WordPress duplicate-upload suffixes: " copy" and an en-dash " – Copy".
        .replace(/(\s+copy)?(\s+(&#8211;|–)\s+Copy)?$/i, '')
      return /^CardsWBorders_\d{4}_\d{2}_/.test(title)
        ? bare.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
        : squashed(bare)
    },
  },
  {
    // Stellar Allies and the two promo-year packs, each under its own prefix and
    // spread over years of uploads, so these are matched by name rather than by
    // a window. Foil and plain scans are the same face; whichever comes second
    // wins, and both are correct.
    set: 'stellar-allies',
    url: `${BASE_API}&per_page=100&search=SRSTA`,
    pages: 2,
    // Eight cards, most of them uploaded both plain and foil.
    expect: 17,
    keep: (title: string): boolean =>
      title.startsWith('SRSTA') && SQUASHED_IDS.has(squashKey(title)),
    id: (title: string): string => squashed(title),
  },
  {
    set: 'promo-years',
    url: `${BASE_API}&per_page=100&search=SRY`,
    pages: 2,
    expect: 13,
    keep: (title: string): boolean =>
      /^SRY\dP/.test(title) && SQUASHED_IDS.has(squashKey(title)),
    id: (title: string): string => squashed(title),
  },
  {
    // Mercenary Garrison appears under none of the pack prefixes; the only card
    // face for it is the 2017 alternate-art upload.
    set: 'promo-singles',
    url: `${BASE_API}&per_page=100&search=mercenarygarrison`,
    pages: 1,
    expect: 1,
    keep: (title: string): boolean => title === 'mercenarygarrison-alternate',
    id: (): string => 'mercenary-garrison',
  },
  {
    // Stragglers: cards the batch above them does not contain. Crisis' Supernova
    // is the one such card -- it is absent from the May 2015 upload and only
    // appears in the smaller December 2017 gallery re-upload. Listed by name
    // rather than by window, so it stays one line rather than a whole source.
    set: 'singles',
    url: `${BASE_API}&per_page=100&after=2017-12-14T00:00:00&before=2017-12-16T00:00:00`,
    pages: 3,
    expect: 1,
    keep: (title: string): boolean => title === 'Supernova',
    id: (title: string): string => title.toLowerCase(),
  },
  {
    set: 'high-alert',
    // High Alert is not one upload batch but a decade of them, so this source is
    // driven by the publisher's own naming instead of by a date window: every
    // pack prefixes its card faces SRHAL<pack>_Card_.
    url: `${BASE_API}&per_page=100&search=SRHAL`,
    pages: 3,
    expect: 54,
    keep: (title: string): boolean => /^SRHAL[A-Z]*_Card_/.test(title),
    id: (title: string): string =>
      title.replace(/^SRHAL[A-Z]*_Card_/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
  },
  {
    set: 'united',
    url: `${BASE_API}&per_page=100&after=2016-09-29T00:00:00&before=2016-10-01T00:00:00`,
    pages: 1,
    expect: 24,
    // The whole United release landed on one day, named in squashed lowercase.
    // Missions are in the same batch and are dropped here simply by not
    // matching a card we have -- see SQUASHED_IDS.
    keep: (title: string): boolean => SQUASHED_IDS.has(title.toLowerCase()),
    id: (title: string): string => SQUASHED_IDS.get(title.toLowerCase()) ?? title,
  },
  {
    set: 'colony-wars',
    url: `${BASE_API}&per_page=100&after=2016-08-18T00:00:00&before=2016-08-20T00:00:00`,
    pages: 1,
    expect: 43,
    // Bare CamelCase names, so anything with a digit, dash or entity in it is
    // not a card -- which is exactly the one convention banner in the window.
    // WordPress appends " (1)" on a re-upload; that is part of the title, not
    // of the name.
    keep: (title: string): boolean => /^[A-Z][A-Za-z]*( \(\d+\))?$/.test(title),
    id: (title: string): string =>
      title.replace(/ \(\d+\)$/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase(),
  },
] as const

/**
 * Two publisher-side defects that a naive importer silently gets wrong.
 * Note also that URLs must come from `source_url` and never from slugifying the
 * name: 17 of the 49 files carry a WordPress `-e<epoch>` recrop suffix that
 * cannot be guessed.
 */
const TITLE_FIXES: Record<string, string> = {
  'Trading Port': 'trading-post', // the card is Trading POST
}

/**
 * Every registry id with its hyphens removed, back to the id.
 *
 * The United batch is named in squashed lowercase -- "coalitionfreighter" --
 * with no separators to split on, so word boundaries cannot be recovered from
 * the filename. Matching against the ids we already have recovers them exactly,
 * and has the useful property that a card we have not implemented yet simply
 * fails to match instead of inventing an id nothing will ever look up.
 */
const SQUASHED_IDS = new Map<string, string>(
  [...CARDS.keys()].map((id) => [String(id).replace(/-/g, ''), String(id)]),
)

/**
 * Reduce a scan filename to the key SQUASHED_IDS is built on.
 *
 * Strips the pack prefix (SRSTA_, SRY1P_, ...) and the Card / FoilCard marker,
 * then everything that is not a letter or digit. What is left is the card name
 * with its word boundaries gone, which is exactly what the map is keyed by.
 */
function squashKey(title: string): string {
  return title
    .replace(/^SR[A-Z0-9]*_/, '')
    .replace(/^(Foil)?Card_?/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function squashed(title: string): string {
  return SQUASHED_IDS.get(squashKey(title)) ?? squashKey(title)
}

/**
 * Scans whose filename spells the card differently from the printed card.
 * Applied to the derived id, after each source's own naming rule.
 */
const ID_FIXES: Record<string, string> = {
  'admiral-rasmussen': 'admiral-rasmusson', // the card is Rasmusson
  // High Alert's Heroes are hyphenated on the card and run together in the scan
  // filenames, so the CamelCase split lands one word short.
  'biocaptain-kalle': 'bio-captain-kalle',
  'biowarrior-storm': 'bio-warrior-storm',
  // The 2015 scan is filed as plain "Starbase"; the card is Starbase Omega.
  starbase: 'starbase-omega',
}

interface MediaItem {
  slug: string
  title: { rendered: string }
  source_url: string
  media_details?: { width?: number; height?: number }
}

function toCardId(title: string): string {
  const fixed = TITLE_FIXES[title]
  if (fixed) return fixed
  return title.toLowerCase().replace(/&#\d+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const SIZES = [320, 640] as const

/**
 * The publisher serves COMPLETE CARD FACES, not isolated artwork -- frame, name
 * banner, cost, printed text and all. Layering our own frame over that produces
 * doubled text, so we crop the illustration band out of each scan and use only
 * that.
 *
 * Measured off the real scans: a ship's art runs from 13% to 65% of the card
 * height, a base's from 13% to 71%, both inset slightly from the printed border.
 */
const CROP = {
  portrait: { top: 0.143, height: 0.498, left: 0.032, width: 0.936 },
  landscape: { top: 0.150, height: 0.545, left: 0.030, width: 0.940 },
} as const

/** Reads one source, paging through it and keeping only its own card faces. */
async function collect(src: typeof SOURCES[number]): Promise<{ item: MediaItem; id: string }[]> {
  const out: { item: MediaItem; id: string }[] = []
  for (let page = 1; page <= src.pages; page++) {
    const res = await fetch(`${src.url}&page=${page}`)
    // A page past the end is a 400, not an empty list.
    if (!res.ok) break
    const items = (await res.json()) as MediaItem[]
    if (items.length === 0) break
    for (const item of items) {
      const title = item.title.rendered
      if (!src.keep(title)) continue
      const derived = src.id(title)
      out.push({ item, id: ID_FIXES[derived] ?? derived })
    }
  }
  console.log(`  ${src.set}: ${out.length} card faces (expected ${src.expect})`)
  if (out.length !== src.expect) {
    console.warn(`  ! expected ${src.expect}, got ${out.length} -- continuing anyway`)
  }
  return out
}

async function main(): Promise<void> {
  console.log('Fetching the card media index from starrealms.com ...')
  const found: { item: MediaItem; id: string }[] = []
  for (const src of SOURCES) found.push(...await collect(src))
  const items = found.map((f) => f.item)
  const idOf = new Map(found.map((f) => [f.item.source_url, f.id]))

  await mkdir(ART_DIR, { recursive: true })

  let ok = 0
  let failed = 0

  for (const item of items) {
    const id = idOf.get(item.source_url) ?? toCardId(item.title.rendered)
    try {
      const imgRes = await fetch(item.source_url)
      if (!imgRes.ok) throw new Error(`HTTP ${imgRes.status}`)
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const w = meta.width ?? 0
      const h = meta.height ?? 0

      const orientation = w >= h ? 'landscape' : 'portrait'
      const c = CROP[orientation]
      const box = {
        left: Math.round(w * c.left),
        top: Math.round(h * c.top),
        width: Math.round(w * c.width),
        height: Math.round(h * c.height),
      }
      for (const size of SIZES) {
        await sharp(buf).extract(box).resize({ width: size }).webp({ quality: 82 })
          .toFile(join(ART_DIR, `${id}-${size}.webp`))
      }
      ok++
      process.stdout.write(`  ${id.padEnd(20)} ${w}x${h} -> art ${box.width}x${box.height}\n`)
    } catch (err) {
      failed++
      console.warn(`  ! ${id}: ${(err as Error).message}`)
    }
  }

  // The manifest is built by ONE script, and it is not this one: it reads the
  // art directory rather than this run's results, so a partial download or a
  // hand-deleted file can never leave the manifest claiming art that is not
  // there.
  await new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, 'art-manifest.mjs')], { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`art-manifest exited ${code}`))))
  })

  console.log(`\nDone: ${ok} downloaded, ${failed} failed.`)
  console.log('Reminder: public/cards/art/ is gitignored. Keep it that way.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
