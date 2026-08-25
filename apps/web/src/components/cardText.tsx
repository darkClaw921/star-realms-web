import { Icon, type IconName } from './Icons'

/**
 * Card text is DATA with `{trade:2}`-style tokens, parsed once into React nodes.
 *
 * Not pre-authored JSX per card: that would cost the game log, aria-labels,
 * search, translation and diffable balance changes. The arrow only ever points
 * effects -> text, never text -> logic.
 */
const TOKEN = /\{(trade|combat|authority):(-?\d+)\}/g

export interface TextNode {
  readonly kind: 'text' | 'glyph'
  readonly value: string
  readonly icon?: IconName
}

const cache = new Map<string, TextNode[]>()

export function tokenize(src: string): TextNode[] {
  const hit = cache.get(src)
  if (hit) return hit
  const out: TextNode[] = []
  let last = 0
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > last) out.push({ kind: 'text', value: src.slice(last, m.index) })
    out.push({ kind: 'glyph', value: m[2] as string, icon: m[1] as IconName })
    last = m.index + m[0].length
  }
  if (last < src.length) out.push({ kind: 'text', value: src.slice(last) })
  cache.set(src, out)
  return out
}

/**
 * One function turns the same nodes into a plain sentence, reused for
 * aria-labels, the game log and tooltips. Three payoffs, one implementation.
 */
const SPOKEN: Record<string, string> = {
  trade: 'очк. торговли',
  combat: 'очк. боя',
  authority: 'очк. влияния',
  draw: 'карт',
  outpost: 'аванпост',
}

export function speak(src: string): string {
  return tokenize(src)
    .map((n) => (n.kind === 'text' ? n.value : ` ${n.value} ${SPOKEN[n.icon as string] ?? n.icon} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * `boost` — прибавка улучшенной копии, которую надо показать В САМОМ ЧИСЛЕ.
 *
 * Иначе карта врёт: она говорит «1 очко боя», рядом стоит печать «+2», а даёт
 * она три, и складывать приходится игроку. Прибавка идёт в ПЕРВЫЙ значок
 * нужного вида — ровно туда, куда её кладёт движок (см. upgradeGain), — и
 * помечается, чтобы число не выглядело опечаткой типографии.
 */
export function CardText(
  { src, boost }: { src: string; boost?: { icon: IconName; n: number } | undefined },
): React.JSX.Element {
  let bumped = false
  return (
    <>
      {tokenize(src).map((n, i) => {
        if (n.kind === 'text') return <span key={i}>{n.value}</span>
        const lift = !bumped && boost !== undefined && n.icon === boost.icon
        if (lift) bumped = true
        return (
          <span key={i} className={`glyph glyph--${n.icon}${lift ? ' is-up' : ''}`}>
            <Icon name={n.icon as IconName} />
            {lift ? Number(n.value) + boost.n : n.value}
          </span>
        )
      })}
    </>
  )
}
