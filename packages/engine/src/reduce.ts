import { produce, type Draft } from 'immer'
import type { Action, Command } from './actions'
import { TENTACLE_FACTIONS } from './boss'
import { cardDef, EXPLORER, SCOUT, VIPER } from './cards/registry'
import type { ChoiceOption, PendingChoice, PromptKind } from './choices'
import { sameOption } from './choices'
import type { AcquireDest, Condition, Effect, EffectBranch } from './effects'
import type { GameEvent } from './events'
import { WAGER_PRICE, wagerById, wagerFor, wagerProgress, wagerSourceOf } from './wagers'
import {
  allFoesOf, allySlotFaction, allyCountFor, canAttackFace, costFor, defenseOf, effectiveDefId,
  foeOf, foeGroups, foesOf,
  factionsOf,
  findInPlay, isBase,
  isHero, isOutpost, isTech, legalAttackTargets, legalDestroyTargets, objectiveMet,
  upgradeFallback, upgradeTargets, withUpgrade,
} from './helpers'
import type { CardDefId, CardIid, ChoiceId, Faction, PlayerId, Zone } from './ids'
import { asDefId, FACTIONS, opponentOf } from './ids'
import {
  authorityHolder, livePlayers, sharedTurn, type CoopState,
} from './coop'
import { nextHex, nextInt, shuffle } from './rng'
import {
  EXPLORER_COST, TRADE_ROW_SIZE, emptyFactionCounts,
  type CardInstance, type ChoiceCont, type EffectCtx, type GameState, type InPlayCard,
  type PlayerState, type ResolutionFrame,
} from './state'
import { actorsOf } from './state'

export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

export interface ReduceResult {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

type D = Draft<GameState>
type DP = Draft<PlayerState>

/** Guards against a malformed card definition spinning settle() forever. */
const MAX_RESOLUTION_STEPS = 10_000

// ─────────────────────────────── small helpers ───────────────────────────────

function mintId(d: D, len = 10): string {
  const [hex, next] = nextHex(d.rng, len)
  d.rng = next as Draft<GameState>['rng']
  return hex
}

function pushEffects(d: D, effects: readonly Effect[], ctx: EffectCtx): void {
  const frames = effects.map((effect) => ({ f: 'effect' as const, effect, ctx }))
  d.resolution.unshift(...(frames as Draft<GameState>['resolution']))
}

function pushChoice(d: D, choice: PendingChoice, cont?: ChoiceCont): void {
  const frame: ResolutionFrame = cont ? { f: 'choice', choice, cont } : { f: 'choice', choice }
  d.resolution.unshift(frame as Draft<GameState>['resolution'][number])
}

/**
 * The seat that physically holds this seat's Authority.
 *
 * A Hydra team has ONE score. Routing every read and write through here is what
 * makes "gain 5 Authority" gain the team five rather than five each, and a
 * five-damage hit cost the team five rather than five per member.
 */
function holder(d: D, pid: PlayerId): PlayerId {
  return authorityHolder(d.coop as CoopState | null, pid)
}

/** Copy a Hydra team's single score back onto every member, so views agree. */
function syncTeamAuthority(d: D): void {
  const c = d.coop
  if (!c || c.mode !== 'hydra') return
  const head = c.players[0]
  if (!head) return
  const score = d.players[head].authority
  for (const pid of c.players) d.players[pid].authority = score
}

/**
 * Authority lost. Never a negative gain: a loss floors at zero, is not counted
 * as something gained, and is routed to whoever holds the score.
 */
function loseAuthority(d: D, pid: PlayerId, n: number, ev: GameEvent[]): number {
  if (n <= 0) return 0
  const seat = holder(d, pid)
  const before = d.players[seat].authority
  const dealt = Math.min(before, n)
  d.players[seat].authority = before - dealt
  syncTeamAuthority(d)
  ev.push({ e: 'AUTHORITY_LOST', player: pid, n: dealt })
  return dealt
}

function gain(d: D, pid: PlayerId, what: 'trade' | 'combat' | 'authority', n: number, ev: GameEvent[]): void {
  if (n === 0) return
  const p = d.players[pid]
  if (what === 'trade') p.trade += n
  else if (what === 'combat') p.combat += n
  else { d.players[holder(d, pid)].authority += n; syncTeamAuthority(d) }
  // Diversify asks what you GAINED, not what you still have, so a spent point
  // still counts. Losses are not negative gains and are not counted.
  if (n > 0) p.gainedThisTurn[what] += n
  // Pact Dominion. Fires once, on the FIRST authority gain of the turn, and the
  // flag is set before the follow-up runs so a follow-up that also gains
  // authority cannot re-enter.
  if (what === 'authority' && n > 0 && !p.gainedAuthorityThisTurn) {
    p.gainedAuthorityThisTurn = true
    for (const g of p.gambitsInPlay) {
      const then = cardDef(g.def).onFirstAuthority
      if (then && then.length > 0) {
        pushEffects(d, then, { controller: pid, source: g.iid, slot: 'trigger' })
      }
    }
  }
  ev.push({ e: 'GAIN', player: pid, what, n })
}

function win(d: D, who: PlayerId, ev: GameEvent[]): void {
  d.winner = who
  d.phase = 'gameOver'
  // Выигранное пари переживает конец боя.
  //
  // Ставку можно взять тем же ударом, который добивает соперника: пари
  // проверяется раньше победы, потому что игрок должен видеть выплату сразу.
  // Спросить «какую карту улучшить» уже некогда — стола нет, — поэтому
  // невыбранные улучшения считаются и уезжают в забег, а он спросит между
  // боями. Иначе лучший ход партии оставался бы без награды.
  for (const f of d.resolution) {
    const owner = f.f === 'effect'
      ? (f.effect.k === 'UPGRADE_CARD' ? f.ctx.controller : null)
      : (f.choice.prompt === 'UPGRADE_CARD' ? f.choice.actor : null)
    if (owner) d.players[owner as PlayerId].upgradesOwed += 1
  }
  d.resolution = []
  ev.push({ e: 'GAME_OVER', winner: who })
}

/**
 * Zero authority always ends the game, in every scenario -- a mission can add a
 * way to win, never take away the way to lose. Only when nobody is dead does an
 * objective get consulted, so a hero who completes their objective on the same
 * turn they are killed still loses.
 */
/**
 * Losing, at a co-op table.
 *
 * Three shapes, because the rulebook prints three. A Hydra team has one score
 * and dies all at once. Pirates of the Dark Star gives each player their own
 * score and eliminates them one at a time; the Boss wins only when the last one
 * is gone. The Dimensional Horror is the same on this point, having never made
 * the players a team at all.
 *
 * Elimination removes a player from the turn order and from everything that
 * targets a player. Their board is left standing but unreachable, which is what
 * taking their cards off the table amounts to.
 */
function checkCoopWin(d: D, ev: GameEvent[]): void {
  const c = d.coop as CoopState
  const bossId = d.boss?.id
  const head = c.players[0] as PlayerId

  // The Horror has no Authority to spend down: killing it means emptying every
  // tentacle, which the scenario objective below decides.
  if (bossId !== 'dimensional-horror' && d.players[c.boss].authority <= 0) {
    win(d, head, ev)
    return
  }

  if (c.mode === 'hydra') {
    if (d.players[head].authority <= 0) { win(d, c.boss, ev); return }
  } else {
    for (const pid of c.players) {
      if (c.eliminated.includes(pid)) continue
      if (d.players[pid].authority <= 0) {
        c.eliminated.push(pid)
        // "When a player is reduced to 0 or less Authority, they are defeated.
        // Put all the cards that player acquired this game into the scrap
        // heap." Their Scouts and Vipers were never acquired, so they stay.
        const gone = d.players[pid]
        for (const zone of ['deck', 'hand', 'discard'] as const) {
          const keep: CardInstance[] = []
          for (const card of gone[zone]) {
            if (isStarter(card.def)) keep.push(card as CardInstance)
            else d.scrapHeap.push(sameCard(card))
          }
          gone[zone] = keep as never
        }
        for (const card of gone.inPlay) {
          if (!isStarter(card.def)) d.scrapHeap.push(sameCard(card))
        }
        gone.inPlay = []
        ev.push({ e: 'ELIMINATED', player: pid })
      }
    }
    if (livePlayers(c).length === 0) { win(d, c.boss, ev); return }
  }

  const sc = d.scenario
  if (sc?.objective.k === 'DESTROY_TENTACLES') {
    const b = d.boss
    if (b && b.tentaclesEverFed && TENTACLE_FACTIONS.every((f) => b.tentacles[f].length === 0)) {
      win(d, head, ev)
    }
  }
}

function checkWin(d: D, ev: GameEvent[]): void {
  if (d.winner) return
  if (d.coop) return checkCoopWin(d, ev)
  for (const pid of d.seats) {
    if (d.players[pid].authority <= 0) {
      win(d, opponentOf(pid), ev)
      return
    }
    // United's Missions are a second, positive win condition: completing all of
    // the ones you were dealt wins outright, whatever the authority track says.
    const p = d.players[pid]
    if (p.missionsDone.length > 0 && p.missions.length === 0) {
      win(d, pid, ev)
      return
    }
  }

  const sc = d.scenario
  if (!sc) return
  const hero = sc.hero
  switch (sc.objective.k) {
    case 'AUTHORITY':
      return
    case 'SURVIVE':
      // The turn counter has already advanced past the last turn to survive.
      if (d.turn > sc.objective.turns) win(d, hero, ev)
      return
    case 'DESTROY_BASES':
      if (d.basesDestroyed[hero] >= sc.objective.n) win(d, hero, ev)
      return
    case 'REACH_AUTHORITY':
      if (d.players[hero].authority >= sc.objective.n) win(d, hero, ev)
      return
    case 'DESTROY_TENTACLES': {
      // "If all of the tentacles are reduced to zero cards, the players win!"
      // Simultaneously empty, not cumulatively cleared: an emptied tentacle
      // regrows the next time a card of its colour is added.
      const b = d.boss
      if (!b) return
      if (b.tentaclesEverFed && TENTACLE_FACTIONS.every((f) => b.tentacles[f].length === 0)) {
        win(d, hero, ev)
      }
      return
    }
  }
}

/**
 * Draw with lazy reshuffle.
 *
 * Tolerant by design: if both deck and discard are empty we simply draw fewer
 * cards. That is not hypothetical -- Junkyard, Brain World, Machine Base and
 * Patrol Mech's ally permanently remove your own cards, so a deck really can run
 * dry. There is no deck-out loss condition.
 */
/** Turn the discard pile into a fresh deck. No-op when there is nothing to shuffle. */
function reshuffle(d: D, pid: PlayerId, ev: GameEvent[]): void {
  const p = d.players[pid]
  if (p.discard.length === 0) return
  const [shuffled, next] = shuffle(d.rng, p.discard as CardInstance[])
  d.rng = next as Draft<GameState>['rng']
  ev.push({ e: 'RESHUFFLE', player: pid, n: p.discard.length })
  p.deck = shuffled as DP['deck']
  p.discard = []
}

function drawCards(d: D, pid: PlayerId, n: number, ev: GameEvent[]): CardDefId[] {
  const p = d.players[pid]
  const drawn: CardDefId[] = []
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break
      reshuffle(d, pid, ev)
    }
    const c = p.deck.shift()
    if (!c) break
    p.hand.push(c)
    drawn.push(c.def)
  }
  if (drawn.length > 0) ev.push({ e: 'DRAW', player: pid, n: drawn.length, defs: drawn })
  return drawn
}

/**
 * Fill every empty trade row slot, resolving any event that turns up.
 *
 * An event "has its effect as soon as the card enters the Trade Row" and is then
 * replaced immediately, so it never occupies a slot. Because an event can ask a
 * question, this cannot simply loop: it stops at the event, pushes the event and
 * a fresh REFILL_TRADE_ROW onto the resolution stack, and lets settle() come
 * back to the remaining slots once the event has fully resolved.
 */
/**
 * How much incoming face damage this player shrugs off.
 *
 * Only Energy Shield grants it, and only against attacks on the player -- the
 * card is explicit that bases do not benefit.
 */
function shieldOf(d: D, pid: PlayerId): number {
  let n = 0
  for (const g of d.players[pid].gambitsInPlay) n += cardDef(g.def).damageReduction ?? 0
  return n
}

function refillTradeRow(d: D, ev: GameEvent[]): void {
  // Black Market widens the row permanently, for everyone.
  const width = TRADE_ROW_SIZE + d.extraRowSlots
  while (d.tradeRow.length < width) d.tradeRow.push(null)
  for (let i = 0; i < width; i++) {
    if (d.tradeRow[i]) continue
    const c = d.tradeDeck.shift() ?? null
    if (c && cardDef(c.def).type === 'event') {
      // Out of the game the moment it resolves; the slot stays empty and the
      // queued refill fills it from the next card down.
      d.scrapHeap.push(c)
      ev.push({ e: 'EVENT', def: c.def })
      pushEffects(
        d,
        [...cardDef(c.def).primary, { k: 'REFILL_TRADE_ROW' }],
        { controller: d.activePlayer, source: null, slot: 'primary' },
      )
      return
    }
    d.tradeRow[i] = c
    ev.push({ e: 'TRADE_ROW_REFILL', def: c?.def ?? null, slot: i })
  }
}

/**
 * The same card, as a plain instance.
 *
 * Every place that moves a card between zones rebuilds it from `iid` and `def`,
 * and an upgraded copy that went through such a place would come back
 * un-upgraded. So the rebuild goes through here, and the field is carried only
 * when there is one: an ordinary game must not start writing zeroes onto every
 * card in it.
 */
function sameCard(c: { iid: CardIid; def: CardDefId; up?: number }): CardInstance {
  return c.up ? { iid: c.iid, def: c.def, up: c.up } : { iid: c.iid, def: c.def }
}

/**
 * Send a card to the scrap heap -- removed from the game.
 *
 * One exception, and it is a printed rule: an Explorer that would go to the scrap
 * heap goes back to the Explorer pile instead. This applies to genuine Explorer
 * cards only, not to a Stealth Needle that copied one.
 */
function toScrapHeap(d: D, inst: CardInstance, from: Zone, owner: PlayerId | null, ev: GameEvent[]): void {
  // Reclamation Station counts what YOU scrapped, so trade-row scrapping (which
  // has no owner) must not feed the counter.
  if (owner) {
    d.players[owner].scrappedThisTurn += 1
    d.tally[owner].scrapped += 1
    // Converter watches YOUR scrapping from hand or discard -- not the trade
    // row, which has no owner, and not a card scrapping itself out of play.
    if (from === 'hand' || from === 'discard') fireScrapTriggers(d, owner, ev)
  }
  if (inst.def === EXPLORER) {
    d.explorerPile += 1
  } else {
    d.scrapHeap.push(inst)
  }
  ev.push({ e: 'SCRAP', from, owner, iid: inst.iid, def: inst.def })
}

function removeFromZone(d: D, pid: PlayerId, zone: Zone, iid: CardIid): CardInstance | null {
  // The trade row belongs to nobody, so it is pulled by slot and the slot is
  // left empty for the refill rather than closed up. United's Exchange Point is
  // the only card that scraps across owned and shared zones in one choice.
  if (zone === 'tradeRow') {
    const idx = d.tradeRow.findIndex((c) => c?.iid === iid)
    if (idx < 0) return null
    const inst = d.tradeRow[idx] as CardInstance
    d.tradeRow[idx] = null
    return inst
  }
  const p = d.players[pid]
  const list = zone === 'hand' ? p.hand : zone === 'discard' ? p.discard : null
  if (!list) return null
  const idx = list.findIndex((c) => c.iid === iid)
  if (idx < 0) return null
  return list.splice(idx, 1)[0] as CardInstance
}

/** Recompute which factions have had their ally condition met. Never un-unlocks. */
function recomputeAlly(d: D, pid: PlayerId, ev: GameEvent[]): void {
  const p = d.players[pid]
  for (const f of FACTIONS) {
    if (f === 'unaligned') continue
    const n = allyCountFor(p, f)
    // Ally needs one other card of the faction, Double Ally two -- so two and
    // three cards in play respectively, counting the card using the ability.
    if (n >= 2 && !p.allyUnlocked.includes(f)) {
      p.allyUnlocked.push(f)
      ev.push({ e: 'ALLY_UNLOCKED', player: pid, faction: f })
    }
    if (n >= 3 && !p.doubleAllyUnlocked.includes(f)) {
      p.doubleAllyUnlocked.push(f)
      ev.push({ e: 'ALLY_UNLOCKED', player: pid, faction: f, double: true })
    }
  }
}

function acquire(
  d: D, pid: PlayerId, inst: CardInstance, cost: number,
  dest: AcquireDest, ev: GameEvent[],
): void {
  const p = d.players[pid]
  // A Hero "goes directly into play instead of into your discard pile" -- not a
  // redirect the player may decline, but where Heroes simply go.
  // A Hero and a Tech both go straight into play when acquired. They differ in
  // what happens next -- a Hero is spent, a Tech is not -- and not in where they
  // land, so this is one rule for both.
  const acquiredType = cardDef(inst.def).type
  if (acquiredType === 'hero' || acquiredType === 'tech') dest = 'in_play'
  // Two Arena scenarios reroute every acquisition, and they do it before any
  // card's own redirect: the scenario is the rule, the card is the exception.
  const isBaseType = acquiredType === 'base' || acquiredType === 'outpost'
  if (d.variant?.id === 'rushed-defenses' && isBaseType) dest = 'in_play'
  if (d.variant?.id === 'recruiting-drive' && acquiredType === 'ship' && dest === 'discard') {
    dest = 'deck_top'
  }
  // Rapid Construction: only the FIRST acquisition of the turn, and only when it
  // would otherwise have gone to the discard pile.
  if (d.variant?.id === 'rapid-construction' && !p.acquiredThisTurn && dest === 'discard') {
    dest = 'deck_top'
  }
  p.acquiredThisTurn = true
  // A card taken for free off another card's ability was not bought.
  if (cost > 0) d.tally[pid].buys += 1
  ev.push({ e: 'ACQUIRE', player: pid, def: inst.def, dest, cost })
  if (dest === 'deck_top') { p.deck.unshift(inst); fireAcquireSelf(d, pid, inst, ev); return }
  if (dest === 'hand') { p.hand.push(inst); fireAcquireSelf(d, pid, inst, ev); return }
  if (dest === 'deck_shuffle') {
    // Shuffled IN, not put on top: the card is somewhere in the deck and the
    // owner does not know where, which is the whole difference from topdecking.
    p.deck.push(inst)
    const [shuffled, next] = shuffle(d.rng, p.deck as CardInstance[])
    d.rng = next as Draft<GameState>['rng']
    p.deck = shuffled as DP['deck']
    fireAcquireSelf(d, pid, inst, ev)
    return
  }
  if (dest === 'in_play') { enterPlay(d, pid, inst, ev); fireAcquireSelf(d, pid, inst, ev); return }
  p.discard.push(inst)
  fireAcquireSelf(d, pid, inst, ev)
  offerRedirect(d, pid, inst)
}

/**
 * "When you acquire this card, if you've played a Blob card this turn, you may
 * put this card directly into your hand."
 *
 * Fires on the card being acquired rather than on anything already in play,
 * which is why it cannot go through the same loop as Fleet HQ. The condition and
 * the "you may" ride the ordinary effect machinery, so this hook stays three
 * lines and the interesting part stays data.
 */
function fireAcquireSelf(d: D, pid: PlayerId, inst: CardInstance, ev: GameEvent[]): void {
  const def = cardDef(inst.def)
  // A HERO's primary happens when you acquire it, not when you activate it --
  // per the publisher FAQ, "you only use the primary ability at that moment, so
  // you do not get to use it every turn". Crisis' Heroes have no primary at all,
  // so this is uniform across both sets rather than a United special case. The
  // matching half of the rule is in legal.ts, which never offers it.
  if (def.type === 'hero' && def.primary.length > 0) {
    ev.push({ e: 'ABILITY_USED', player: pid, iid: inst.iid, def: inst.def, slot: 'primary' })
    pushEffects(d, def.primary, { controller: pid, source: inst.iid, slot: 'primary' })
  }
  for (const t of def.triggers) {
    if (t.on !== 'ACQUIRE_SELF') continue
    ev.push({ e: 'ABILITY_USED', player: pid, iid: inst.iid, def: inst.def, slot: 'trigger' })
    pushEffects(d, t.effects, { controller: pid, source: inst.iid, slot: 'trigger' })
  }
}

/**
 * Spend one armed redirect on the card just acquired, if any matches.
 *
 * Multiple armed redirects stack and the player picks which to spend, so this
 * asks even when the redirect itself is mandatory: what is mandatory is that ONE
 * of them is consumed, not which. With a single mandatory match there is nothing
 * to decide and the degenerate choice auto-resolves.
 */
function offerRedirect(d: D, pid: PlayerId, inst: CardInstance): void {
  const p = d.players[pid]
  const type = cardDef(inst.def).type
  const isShip = type === 'ship'
  const idxs: number[] = []
  p.pendingRedirects.forEach((r, i) => {
    if (r.filter === 'ship' && !isShip) return
    if (r.filter === 'base' && isShip) return
    idxs.push(i)
  })
  if (idxs.length === 0) return
  const dests = idxs.map((i) => p.pendingRedirects[i]!.dest)
  const mandatory = idxs.some((i) => !p.pendingRedirects[i]!.optional)
  const name = cardDef(inst.def).name
  pushChoice(d, {
    id: mintId(d) as ChoiceId,
    actor: pid,
    prompt: 'REDIRECT_ACQUIRED',
    source: null,
    label: `Where does ${name} go?`,
    min: mandatory ? 1 : 0,
    max: 1,
    options: dests.map((dst, i) => ({
      o: 'BRANCH' as const,
      index: i,
      label: dst === 'hand' ? 'Into your hand' : 'On top of your deck',
    })),
  }, { c: 'REDIRECT', iid: inst.iid, dests, redirects: idxs })
}

/**
 * Put a card into play without playing it from hand.
 *
 * Crisis' Construction Hauler buys a base straight into play. It is NOT a card
 * played: nothing counts it for the faction-played counters, and no PLAY_BASE
 * trigger watches it, because it was never played -- it was acquired.
 */
function enterPlay(d: D, pid: PlayerId, inst: CardInstance, ev: GameEvent[]): void {
  d.players[pid].inPlay.push({
    iid: inst.iid,
    def: inst.def,
    copiedDef: null, chosenFaction: null,
    used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
    playedThisTurn: false,
  } as Draft<InPlayCard>)
  ev.push({ e: 'PLAY_CARD', player: pid, iid: inst.iid, def: inst.def })
}

/**
 * "Whenever you scrap a card from your hand or discard pile, ..." -- Converter.
 *
 * Unbounded per turn, like Fleet HQ, which is why it is a trigger rather than an
 * activated slot. It fires from cards already in play and never from the card
 * being scrapped.
 */
function fireScrapTriggers(d: D, pid: PlayerId, ev: GameEvent[]): void {
  const p = d.players[pid]
  for (const c of p.inPlay) {
    for (const t of cardDef(effectiveDefId(c)).triggers) {
      if (t.on !== 'SCRAP_OWN') continue
      ev.push({ e: 'ABILITY_USED', player: pid, iid: c.iid, def: c.def, slot: 'trigger' })
      pushEffects(d, t.effects, { controller: pid, source: c.iid, slot: 'trigger' })
    }
  }
}

function destroyBase(
  d: D, owner: PlayerId, card: InPlayCard, by: 'combat' | 'effect', ev: GameEvent[],
  by_: PlayerId | null = null,
): void {
  const destroyer = by_ ?? foeOf(d as unknown as GameState, owner)
  const p = d.players[owner]
  const idx = p.inPlay.findIndex((c) => c.iid === card.iid)
  if (idx < 0) return
  // Only enemy bases count. "Destroy target base" may legally target your own,
  // and a mission asking you to break a blockade must not be satisfiable by
  // demolishing your own outpost.
  if (destroyer !== owner) d.basesDestroyed[destroyer] += 1
  p.inPlay.splice(idx, 1)
  // Rushed Defenses: a destroyed base is scrapped rather than going back to its
  // owner's discard pile, which is what makes buying one a real commitment.
  if (cardDef(card.def).removeOnDestroy || d.variant?.id === 'rushed-defenses') {
    // Secret Outpost: a token, not a card you own. Destroyed means gone.
    d.scrapHeap.push(sameCard(card))
    ev.push({ e: 'BASE_DESTROYED', owner, iid: card.iid, def: card.def, by })
    return
  }
  // Destroyed bases go to their OWNER'S discard pile, not the scrap heap --
  // they cycle back into that player's deck.
  p.discard.push(sameCard(card))
  ev.push({ e: 'BASE_DESTROYED', owner, iid: card.iid, def: card.def, by })
}

// ────────────────────────────── choice building ──────────────────────────────

function cardOpts(cards: readonly CardInstance[], zone: Zone, owner: PlayerId): ChoiceOption[] {
  return cards.map((c) => (c.up
    ? { o: 'CARD' as const, iid: c.iid, def: c.def, zone, owner, up: c.up }
    : { o: 'CARD' as const, iid: c.iid, def: c.def, zone, owner }))
}

function makeChoice(
  d: D, actor: PlayerId, prompt: PromptKind, label: string,
  min: number, max: number, options: ChoiceOption[], source: CardIid | null,
): PendingChoice {
  return { id: mintId(d) as ChoiceId, actor, prompt, source, label, min, max, options }
}

// ──────────────────────────────── effect engine ──────────────────────────────

function applyEffect(d: D, effect: Effect, ctx: EffectCtx, ev: GameEvent[]): void {
  const me = ctx.controller
  const p = d.players[me]

  switch (effect.k) {
    case 'GAIN_TRADE': return gain(d, me, 'trade', effect.n, ev)
    case 'GAIN_COMBAT': return gain(d, me, 'combat', effect.n, ev)
    case 'GAIN_AUTHORITY': return gain(d, me, 'authority', effect.n, ev)
    case 'DRAW': { drawCards(d, me, effect.n, ev); return }

    // ── Frontiers ───────────────────────────────────────────────────────────
    case 'SELF_DISCARD': {
      const opts: ChoiceOption[] = cardOpts(p.hand, 'hand', me)
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'hand is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'DISCARD', 'Discard a card',
        Math.min(effect.n, opts.length), Math.min(effect.n, opts.length), opts, ctx.source))
      return
    }

    case 'SCRAP_TRADE_ROW_FOR_COMBAT': {
      const opts: ChoiceOption[] = []
      for (const c of d.tradeRow) {
        if (c) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'trade row is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_ROW_FOR_COMBAT',
        'Scrap a trade row card for combat', effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'SCRAP_FOR_COMBAT': {
      const opts: ChoiceOption[] = []
      for (const z of effect.zones) {
        const list = z === 'hand' ? p.hand : z === 'discard' ? p.discard : []
        opts.push(...cardOpts(list, z, me))
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_FOR_COMBAT',
        'Scrap a card for combat', effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'TOPDECK_FROM_DISCARD': {
      const eligible = (p.discard as CardInstance[]).filter((c) => {
        const def = cardDef(c.def)
        if (effect.filter === 'base' && def.type !== 'base' && def.type !== 'outpost') return false
        return effect.maxCost === null || def.cost <= effect.maxCost
      })
      if (eligible.length === 0) {
        ev.push({ e: 'FIZZLE', label: 'nothing eligible in the discard pile' })
        return
      }
      pushChoice(d, makeChoice(d, me, 'TOPDECK_BASE', 'Put a card on top of your deck',
        effect.min, 1, cardOpts(eligible, 'discard', me), ctx.source))
      return
    }

    case 'DISCARD_FOR_COMBAT': {
      if (p.hand.length === 0) { ev.push({ e: 'FIZZLE', label: 'hand is empty' }); return }
      // "Any number" is min 0, max the whole hand -- one choice, not a loop.
      pushChoice(d, makeChoice(d, me, 'DISCARD_FOR_COMBAT',
        `Discard any number of cards for ${effect.per} combat each`,
        0, p.hand.length, cardOpts(p.hand, 'hand', me), ctx.source))
      return
    }

    case 'COMBAT_PER_SCRAPPED': {
      // The card using this is itself scrapped by the activation, so it is
      // already counted -- which is what "including this one" means.
      gain(d, me, 'combat', effect.per * p.scrappedThisTurn, ev)
      return
    }

    case 'RETURN_SELF_AT_END_OF_TURN': {
      if (ctx.source) p.returnAtEndOfTurn.push(ctx.source)
      return
    }

    case 'SEQ': return pushEffects(d, effect.effects, ctx)

    // ── Frontiers Challenges ────────────────────────────────────────────────
    case 'BOSS_TURN': return pushEffects(d, bossOrderOfPlay(d), ctx)
    case 'BOSS_END_TURN': {
      if (d.boss) d.boss.acting = false
      endTurn(d, ev)
      return
    }
    case 'BOSS_ATTACK': { bossAttacks(d, ev); return }
    case 'BOSS_BLOB_DRAW': {
      // "If the Boss would draw a card, instead it puts the lowest cost base it
      // has in its discard pile into play. If there isn't a base in its discard
      // pile, it gains 7 Combat."
      const bp = d.players[me]
      const bases = bp.discard.filter((c) => isBase({ def: c.def }))
      if (bases.length === 0) { gain(d, me, 'combat', 7, ev); return }
      let best = bases[0] as CardInstance
      for (const c of bases) if (cardDef(c.def).cost < cardDef(best.def).cost) best = c
      const at = bp.discard.findIndex((c) => c.iid === best.iid)
      const inst = bp.discard.splice(at, 1)[0] as CardInstance
      playCardFor(d, me, inst, ev, ctx)
      return
    }
    case 'BOSS_ASSIMILATE': { automatonsStep(d, ev, ctx); return }
    case 'BOSS_GROW': { if (d.boss) d.boss.assimilation += 1; return }
    case 'BOSS_NEMESIS_STEP': { nemesisStep(d, ev, ctx); return }
    case 'BOSS_HORROR_STEP': { horrorStep(d, ev, ctx); return }
    case 'BOSS_PIRATE_STEP': { pirateStep(d, ev, ctx); return }

    case 'DESTROY_BASE_OR_COMBAT': {
      // "destroys target base or gains N": the boss only takes the combat when
      // there is genuinely no base to shoot.
      const targets = legalDestroyTargets(d as unknown as GameState, me)
      if (targets.length === 0) { gain(d, me, 'combat', effect.n, ev); return }
      pushEffects(d, [{ k: 'DESTROY_BASE', min: 1, max: 1 }], ctx)
      return
    }

    case 'TOPDECK_RANDOM_FROM_HAND': {
      // Random, so the engine picks -- and it picks from the seeded stream, not
      // from Math.random, or the replay would diverge.
      // "EACH player", on the Nemesis Beast's card: at a co-op table this is
      // every living player, which is what foesOf returns for the boss.
      for (const foe of foesOf(d as unknown as GameState, me, ctx)) {
        const fp = d.players[foe]
        for (let i = 0; i < effect.n && fp.hand.length > 0; i++) {
          let idx: number
          ;[idx, d.rng] = nextInt(d.rng, fp.hand.length) as [number, typeof d.rng]
          const inst = fp.hand.splice(idx, 1)[0] as CardInstance
          fp.deck.unshift(inst)
          ev.push({ e: 'TOPDECK', player: foe, iid: inst.iid, def: inst.def })
        }
      }
      return
    }

    case 'TOPDECK_STARTER': {
      for (const foe of foesOf(d as unknown as GameState, me, ctx)) {
      const fp = d.players[foe]
      const opts: ChoiceOption[] = [
        ...cardOpts(fp.hand.filter((c) => isStarter(c.def)), 'hand', foe),
        ...cardOpts(fp.discard.filter((c) => isStarter(c.def)), 'discard', foe),
      ]
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'no starter card to top-deck' }); continue }
      pushChoice(d, makeChoice(d, foe, 'TOPDECK_BASE', 'Put a Scout or Viper on top of your deck',
        1, 1, opts, ctx.source))
      }
      return
    }

    case 'DESTROY_ALL_ENEMY_BASES': {
      for (const foe of foesOf(d as unknown as GameState, me, ctx)) {
        const bases = d.players[foe].inPlay.filter((c) => isBase(c))
        for (const b of bases) destroyBase(d, foe, b as InPlayCard, 'effect', ev, me)
      }
      return
    }

    case 'IF': {
      if (evalCondition(d, me, effect.cond)) pushEffects(d, effect.then, ctx)
      return
    }

    case 'PER': {
      const n = effect.ref.counter === 'faction_in_play'
        ? countFactionInPlay(p, effect.ref.faction)
        : p.factionPlayedThisTurn[effect.ref.faction]
      if (n <= 0) { ev.push({ e: 'FIZZLE', label: 'nothing to count' }); return }
      const repeated: Effect[] = []
      for (let i = 0; i < n; i++) repeated.push(...effect.then)
      return pushEffects(d, repeated, ctx)
    }

    case 'MAY': {
      pushChoice(
        d,
        makeChoice(d, me, 'MAY', effect.label, 0, 1, [{ o: 'CONFIRM' }], ctx.source),
        { c: 'MAY', then: effect.then },
      )
      return
    }

    case 'CHOOSE_ONE': {
      const opts: ChoiceOption[] = effect.branches.map((b: EffectBranch, i: number) =>
        ({ o: 'BRANCH', index: i, label: b.label }))
      pushChoice(
        d,
        makeChoice(d, me, 'CHOOSE_BRANCH', 'Choose one', 1, 1, opts, ctx.source),
        { c: 'BRANCHES', branches: effect.branches },
      )
      return
    }

    case 'OPPONENT_DISCARD': {
      // Automatons: "If the Boss makes a player discard cards, each other
      // player must also discard that number of cards." Every other boss aims
      // its discard at the one player it targeted this turn.
      const spreads = d.boss?.id === 'automatons' && me === bossSeat(d) && !ctx.target
      const victims = spreads
        ? allFoesOf(d as unknown as GameState, me)
        : foesOf(d as unknown as GameState, me, ctx)
      // Pushed in reverse so the stack asks the players in seat order.
      for (const target of [...victims].reverse()) {
        const hand = d.players[target].hand as CardInstance[]
        if (hand.length === 0) { ev.push({ e: 'FIZZLE', label: 'opponent has no cards to discard' }); continue }
        const n = Math.min(effect.n, hand.length)
        const label = n === 1 ? 'Discard a card' : `Discard ${n} cards`
        pushChoice(d, makeChoice(d, target, 'DISCARD', label, n, n,
          cardOpts(hand, 'hand', target), ctx.source))
      }
      return
    }

    case 'DESTROY_BASE': {
      const targets = legalDestroyTargets(d as unknown as GameState, me)
      if (targets.length === 0) { ev.push({ e: 'FIZZLE', label: 'no base to destroy' }); return }
      const opts: ChoiceOption[] = targets.map((c) => ({
        o: 'CARD', iid: c.iid, def: c.def, zone: 'inPlay',
        owner: findInPlay(d as unknown as GameState, c.iid)?.owner ?? me,
      }))
      pushChoice(d, makeChoice(d, me, 'DESTROY_BASE', 'Destroy target base', effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'SCRAP_TRADE_ROW': {
      const opts: ChoiceOption[] = []
      for (const c of d.tradeRow) {
        if (c) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'trade row is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_TRADE_ROW', 'Scrap a card in the trade row',
        effect.min, effect.max, opts, ctx.source))
      return
    }

    case 'SCRAP_FROM_ZONES': {
      // Coalition Efficiency replaces a scrap you were about to make, so it is
      // offered BEFORE the scrap choice rather than after it resolves. Once per
      // turn, and only when a scrap from your own zones is on the table.
      const owned = effect.zones.includes('hand') || effect.zones.includes('discard')
      if (owned) {
        const swap = p.gambitsInPlay.find(
          (g) => !g.used.primary && cardDef(g.def).triggers.some((t) => t.on === 'WOULD_SCRAP'),
        )
        if (swap) {
          const t = cardDef(swap.def).triggers.find((x) => x.on === 'WOULD_SCRAP')
          // Marked used before the branch resolves: whichever way it goes, the
          // offer was made, and "once per turn" counts offers, not acceptances.
          swap.used.primary = true
          // "INSTEAD of scrapping", so the two are branches of one choice --
          // taking the substitute must not also perform the scrap.
          pushEffects(d, [{
            k: 'CHOOSE_ONE',
            branches: [
              { label: 'Scrap as normal', then: [{ ...effect }] },
              { label: cardDef(swap.def).name, then: [...(t?.effects ?? [])] },
            ],
          }], { ...ctx, source: swap.iid })
          return
        }
      }
      const opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      if (effect.zones.includes('tradeRow')) {
        for (const c of d.tradeRow) {
          if (c) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
        }
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      const max = Math.min(effect.max, opts.length)
      const min = Math.min(effect.min, opts.length)
      const label = min === 0 ? 'You may scrap a card' : 'Scrap a card'
      pushChoice(d, makeChoice(d, me, 'SCRAP_ZONES', label, min, max, opts, ctx.source))
      return
    }

    case 'UPGRADE_CARD': {
      // Рука, сброс и стол — но не колода: она закрыта даже от владельца, и
      // выбирать из неё значило бы её показать.
      const opts: ChoiceOption[] = [
        ...cardOpts(p.hand as CardInstance[], 'hand', me),
        ...cardOpts(p.discard as CardInstance[], 'discard', me),
        ...p.inPlay.map((c) => (c.up
          ? { o: 'CARD' as const, iid: c.iid, def: c.def, zone: 'inPlay' as Zone, owner: me, up: c.up }
          : { o: 'CARD' as const, iid: c.iid, def: c.def, zone: 'inPlay' as Zone, owner: me })),
      ]
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to upgrade' }); return }
      pushChoice(d, makeChoice(d, me, 'UPGRADE_CARD', 'Upgrade a card',
        1, Math.min(effect.n, opts.length), opts, ctx.source))
      return
    }

    case 'SCRAP_THEN_DRAW': {
      let opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      // Crisis' Death World only eats the OTHER three factions, so the filter
      // lives on the option list rather than on the answer: an illegal card is
      // never offered, and the server never has to reject one.
      const allowed = effect.factions
      if (allowed) {
        opts = opts.filter((o) => o.o === 'CARD' && allowed.includes(cardDef(o.def).faction))
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_THEN_DRAW',
        `Scrap up to ${effect.max} cards, then draw one for each`, 0,
        Math.min(effect.max, opts.length), opts, ctx.source))
      return
    }

    case 'DISCARD_THEN_DRAW': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      pushChoice(d, makeChoice(d, me, 'DISCARD_THEN_DRAW',
        `Discard up to ${effect.max} cards, then draw that many`, 0,
        Math.min(effect.max, opts.length), opts, ctx.source))
      return
    }

    case 'ACQUIRE_FREE': {
      const opts: ChoiceOption[] = []
      d.tradeRow.forEach((c) => {
        if (!c) return
        const def = cardDef(c.def)
        if (effect.filter === 'ship' && def.type !== 'ship') return
        if (effect.filter === 'base' && def.type !== 'base' && def.type !== 'outpost') return
        if (effect.maxCost !== null && def.cost > effect.maxCost) return
        opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      })
      // The Explorer is a ship, so a base-only acquisition must not offer it.
      if (effect.filter !== 'base'
          && d.explorerPile > 0
          && (effect.maxCost === null || EXPLORER_COST <= effect.maxCost)) {
        opts.push({ o: 'EXPLORER' })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to acquire' }); return }
      pushChoice(
        d,
        makeChoice(d, me, 'ACQUIRE_FREE', 'Acquire a card for free', effect.min, 1, opts, ctx.source),
        { c: 'ACQUIRE', dest: effect.dest },
      )
      return
    }

    case 'REDIRECT_NEXT_ACQUIRED': {
      p.pendingRedirects.push({ ...effect.redirect })
      return
    }

    case 'MOVE_SELF_TO_HAND': {
      const src = ctx.source
      if (!src) return
      // The card is wherever the acquisition just put it -- normally the discard
      // pile, but a stacked redirect may already have topdecked it.
      const from = p.discard.findIndex((c) => c.iid === src)
      const inst = from >= 0
        ? (p.discard.splice(from, 1)[0] as CardInstance)
        : (() => {
            const i = p.deck.findIndex((c) => c.iid === src)
            return i >= 0 ? (p.deck.splice(i, 1)[0] as CardInstance) : null
          })()
      if (!inst) return
      p.hand.push(inst)
      ev.push({ e: 'ACQUIRE', player: me, def: inst.def, dest: 'hand', cost: 0 })
      return
    }

    case 'DISCARD_FOR_TRADE_OR_COMBAT': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'hand is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'DISCARD_FOR_TRADE_OR_COMBAT',
        `Discard up to ${effect.max} cards`, 0,
        Math.min(effect.max, opts.length), opts, ctx.source),
        { c: 'DISCARD_RESOURCE', per: effect.per })
      return
    }

    case 'REFILL_TRADE_ROW': { refillTradeRow(d, ev); return }

    case 'GAIN_ALLY': {
      if (!p.allyUnlocked.includes(effect.faction)) {
        p.allyUnlocked.push(effect.faction)
        ev.push({ e: 'ALLY_UNLOCKED', player: me, faction: effect.faction })
      }
      return
    }

    case 'EACH_FOE': {
      // Pushed in reverse so the stack works through the players in seat order.
      const foes = allFoesOf(d as unknown as GameState, me)
      for (const foe of [...foes].reverse()) {
        pushEffects(d, effect.then, { ...ctx, target: foe })
      }
      return
    }

    case 'EACH_PLAYER': {
      // Active player first, and pushed in that order so the stack resolves it
      // first: an event that asks both players a question must ask in turn
      // order, not in whatever order the seats happen to be listed.
      const from = d.seats.indexOf(d.activePlayer)
      const order = d.seats.map((_, i) => d.seats[(from + i) % d.seats.length] as PlayerId)
      for (const pid of [...order].reverse()) {
        pushEffects(d, effect.then, { controller: pid, source: ctx.source, slot: ctx.slot })
      }
      return
    }

    case 'LOSE_AUTHORITY': {
      // A loss is not a negative gain: authority floors at zero, and dropping to
      // zero is a loss condition checked by settle().
      const n = Math.min(effect.n, d.players[holder(d, me)].authority)
      loseAuthority(d, me, n, ev)
      ev.push({ e: 'GAIN', player: me, what: 'authority', n: -n })
      return
    }

    case 'DISCARD_OR_LOSE': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      if (opts.length === 0) {
        // Nothing to discard is not an escape: the penalty is for every card
        // BELOW the maximum, and an empty hand is as far below as it gets.
        pushEffects(d, [{ k: 'LOSE_AUTHORITY', n: effect.max * effect.per }], ctx)
        return
      }
      pushChoice(d, makeChoice(d, me, 'DISCARD_OR_LOSE',
        `Discard up to ${effect.max} cards, or lose authority for each you do not`,
        0, Math.min(effect.max, opts.length), opts, ctx.source),
        { c: 'DISCARD_OR_LOSE', max: effect.max, per: effect.per })
      return
    }

    case 'DESTROY_OWN_BASE_OR_LOSE': {
      const mine = p.inPlay.filter(isBase)
      if (mine.length === 0) { pushEffects(d, [{ k: 'LOSE_AUTHORITY', n: effect.n }], ctx); return }
      // Both halves are offered as branches, because "either ... or" is a real
      // choice even when losing authority is usually the worse one.
      const opts: ChoiceOption[] = mine.map((c) => ({
        o: 'CARD', iid: c.iid, def: c.def, zone: 'inPlay', owner: me,
      }))
      pushChoice(d, makeChoice(d, me, 'DESTROY_OWN_BASE_OR_LOSE',
        `Destroy one of your bases, or lose ${effect.n} authority`,
        0, 1, opts, ctx.source),
        { c: 'DESTROY_OR_LOSE', n: effect.n })
      return
    }

    case 'SCRAP_WHOLE_TRADE_ROW': {
      for (let i = 0; i < d.tradeRow.length; i++) {
        const c = d.tradeRow[i]
        if (!c) continue
        d.tradeRow[i] = null
        toScrapHeap(d, c, 'tradeRow', null, ev)
      }
      // Through the stack, not inline: the replacements may themselves be events.
      pushEffects(d, [{ k: 'REFILL_TRADE_ROW' }], ctx)
      return
    }

    case 'OPPONENT_EFFECT':
      return pushEffects(d, effect.then, { ...ctx, controller: foeOf(d as unknown as GameState, me, ctx) })

    case 'GAIN_PHANTOM': {
      for (let i = 0; i < effect.n; i++) p.phantomFactions.push(effect.faction)
      recomputeAlly(d, me, ev)
      return
    }

    case 'ACQUIRE_EXPLORER_FREE': {
      if (d.explorerPile <= 0) { ev.push({ e: 'FIZZLE', label: 'no Explorer left' }); return }
      if (effect.min === 0) {
        pushChoice(d, makeChoice(d, me, 'MAY', 'Acquire an Explorer for free',
          0, 1, [{ o: 'CONFIRM' }], ctx.source),
          { c: 'MAY', then: [{ ...effect, min: 1 }] })
        return
      }
      d.explorerPile -= 1
      acquire(d, me, { iid: mintId(d, 12) as CardIid, def: EXPLORER }, 0, effect.dest, ev)
      return
    }

    case 'SET_ASIDE_FROM_ROW': {
      const opts: ChoiceOption[] = []
      for (const c of d.tradeRow) {
        if (c) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'tradeRow', owner: null })
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'trade row is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'SET_ASIDE_FROM_ROW',
        'Set a trade row card aside; anyone may acquire it for the rest of the game',
        effect.min, 1, opts, ctx.source))
      return
    }

    case 'DISCOUNT_NEXT_ACQUIRED': {
      p.pendingDiscounts.push({ faction: effect.faction, n: effect.n })
      return
    }

    case 'SCRAP_THEN_GAIN': {
      const opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_THEN_GAIN',
        `Scrap up to ${effect.max} cards`, 0, Math.min(effect.max, opts.length), opts, ctx.source),
        { c: 'SCRAP_GAIN', per: effect.per, what: effect.what })
      return
    }

    case 'SCRAP_DRAW_DISCARD': {
      const opts: ChoiceOption[] = []
      if (effect.zones.includes('hand')) opts.push(...cardOpts(p.hand as CardInstance[], 'hand', me))
      if (effect.zones.includes('discard')) opts.push(...cardOpts(p.discard as CardInstance[], 'discard', me))
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing to scrap' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRAP_THEN_GAIN',
        `Scrap up to ${effect.max} cards, then draw and discard that many`,
        0, Math.min(effect.max, opts.length), opts, ctx.source),
        { c: 'SCRAP_DRAW_DISCARD' })
      return
    }

    case 'DRAW_GAMBIT': {
      for (let i = 0; i < effect.n; i++) {
        if (d.unclaimedGambits.length === 0) break
        const [pick, next] = nextInt(d.rng, d.unclaimedGambits.length)
        d.rng = next as Draft<GameState>['rng']
        p.gambits.push(d.unclaimedGambits.splice(pick, 1)[0] as CardInstance)
      }
      return
    }

    case 'OPEN_BLACK_MARKET': {
      d.extraRowSlots += 1
      d.blackMarketOwner = me
      refillTradeRow(d, ev)
      return
    }

    case 'DEPLOY_TOKEN': {
      const inst = { iid: mintId(d, 12) as CardIid, def: asDefId(effect.def) }
      enterPlay(d, me, inst, ev)
      // A token's on-play triggers fire like any card's -- Secret Outpost picks
      // its faction that way.
      for (const t of cardDef(inst.def).triggers) {
        if (t.on !== 'PLAY_SELF') continue
        pushEffects(d, t.effects, { controller: me, source: inst.iid, slot: 'trigger' })
      }
      return
    }

    case 'BUY_FROM_SCRAP_HEAP': {
      const opts: ChoiceOption[] = d.scrapHeap
        // The same price the purchase below will charge. Offering a different
        // one means a card you can afford is silently missing from the list.
        .filter((c) => costFor(cardDef(c.def), p.inPlay, {
          variant: d.variant, buyer: me, scenario: d.scenario,
        }) <= p.trade)
        .map((c) => ({ o: 'CARD' as const, iid: c.iid, def: c.def, zone: 'scrapHeap' as Zone, owner: null }))
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'nothing affordable in the scrap heap' }); return }
      pushChoice(d, makeChoice(d, me, 'BUY_FROM_SCRAP_HEAP',
        "Pay a scrapped card's cost to take it into your hand", effect.min, 1, opts, ctx.source))
      return
    }

    case 'REVEAL_THREE_SPLIT': {
      if (p.deck.length < 3) reshuffle(d, me, ev)
      const looked = (p.deck as CardInstance[]).slice(0, 3)
      if (looked.length === 0) { ev.push({ e: 'FIZZLE', label: 'deck is empty' }); return }
      pushChoice(d, makeChoice(d, me, 'REVEAL_SPLIT',
        'Put one of these into your hand', 1, 1, cardOpts(looked, 'deck', me), ctx.source),
        { c: 'REVEAL_SPLIT', iids: looked.map((c) => c.iid), dest: 'hand' })
      return
    }

    case 'SCRAP_SELF': {
      const src = ctx.source
      if (!src) return
      const idx = p.inPlay.findIndex((c) => c.iid === src)
      if (idx < 0) return
      const card = p.inPlay[idx] as Draft<InPlayCard>
      p.inPlay.splice(idx, 1)
      toScrapHeap(d, sameCard(card), 'inPlay', me, ev)
      return
    }

    case 'CHOOSE_OWN_FACTION': {
      const src = ctx.source
      if (!src) return
      const opts: ChoiceOption[] = FACTIONS
        .filter((f) => f !== 'unaligned')
        .map((f, i) => ({ o: 'BRANCH' as const, index: i, label: f }))
      pushChoice(d, makeChoice(d, me, 'CHOOSE_FACTION', "Choose this card's faction",
        1, 1, opts, src), { c: 'OWN_FACTION', iid: src })
      return
    }

    case 'DISCARD_FOR_RESOURCE_PLUS': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      pushChoice(d, makeChoice(d, me, 'DISCARD_FOR_TRADE_OR_COMBAT',
        'Discard any number of cards', 0, opts.length, opts, ctx.source),
        { c: 'DISCARD_PLUS', plus: effect.plus })
      return
    }

    case 'STEAL_FROM_DISCARD': {
      const foe = foeOf(d as unknown as GameState, me, ctx)
      const opts = cardOpts(d.players[foe].discard as CardInstance[], 'discard', foe)
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'their discard pile is empty' }); return }
      const n = Math.min(effect.n, opts.length)
      pushChoice(d, makeChoice(d, me, 'STEAL_FROM_DISCARD',
        "Move a card from an opponent's discard pile to yours", n, n, opts, ctx.source))
      return
    }

    case 'SHUFFLE_DISCARD_INTO_DECK': {
      if (p.discard.length === 0) return
      const [shuffled, next] = shuffle(d.rng, [...p.deck, ...p.discard] as CardInstance[])
      d.rng = next as Draft<GameState>['rng']
      ev.push({ e: 'RESHUFFLE', player: me, n: p.discard.length })
      p.deck = shuffled as DP['deck']
      p.discard = []
      return
    }

    case 'DISCARD_TO_HAND':
    case 'DISCARD_TO_DECK_TOP': {
      const opts = cardOpts(p.discard as CardInstance[], 'discard', me)
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'discard pile is empty' }); return }
      const toHand = effect.k === 'DISCARD_TO_HAND'
      pushChoice(d, makeChoice(d, me, toHand ? 'DISCARD_TO_HAND' : 'TOPDECK_BASE',
        toHand ? 'Put a card from your discard pile into your hand'
          : 'Put a card from your discard pile on top of your deck',
        effect.min, 1, opts, ctx.source))
      return
    }

    case 'SCRY_MANY': {
      if (p.deck.length < effect.n) reshuffle(d, me, ev)
      const looked = (p.deck as CardInstance[]).slice(0, effect.n)
      if (looked.length === 0) { ev.push({ e: 'FIZZLE', label: 'deck is empty' }); return }
      // "Any number", so min is 0 -- looking and keeping everything is legal.
      pushChoice(d, makeChoice(d, me, 'SCRY',
        `Look at the top ${looked.length}; discard any number of them`,
        0, looked.length, cardOpts(looked, 'deck', me), ctx.source))
      return
    }

    case 'COPY_USED_ALLY': {
      // Only abilities used BEFORE this one, and the Lancer's own ally is not on
      // the list yet because the list is appended after the ability resolves.
      // "Already used": not the one being used right now, which is on the list
      // by the time its effects resolve.
      const used = p.alliesUsedThisTurn
        .filter((u) => u.iid !== ctx.source)
        .map((u) => ({ def: u.def, slot: u.slot }))
      if (used.length === 0) { ev.push({ e: 'FIZZLE', label: 'no ally ability used yet' }); return }
      const opts: ChoiceOption[] = used.map((u, i) => ({
        o: 'BRANCH' as const, index: i, label: cardDef(u.def).name,
      }))
      pushChoice(d, makeChoice(d, me, 'COPY_USED_ALLY',
        'Copy an ally ability used this turn', 1, 1, opts, ctx.source),
        { c: 'COPY_ALLY', used })
      return
    }

    case 'PHANTOM_FACTION': {
      const opts: ChoiceOption[] = FACTIONS
        .filter((f) => f !== 'unaligned')
        .map((f, i) => ({ o: 'BRANCH' as const, index: i, label: f }))
      pushChoice(d, makeChoice(d, me, 'CHOOSE_FACTION', 'Choose a faction', 1, 1, opts, ctx.source),
        { c: 'PHANTOM', n: effect.n })
      return
    }

    case 'SCRY': {
      if (p.deck.length < effect.n) reshuffle(d, me, ev)
      // The cards STAY in the deck while the choice is open. "Look at" is
      // exactly the redaction the choice already provides -- options go to the
      // actor and nobody else -- and leaving them in place means an abandoned
      // or invalid answer cannot strand them outside any zone.
      const looked = (p.deck as CardInstance[]).slice(0, effect.n)
      if (looked.length <= 1) { ev.push({ e: 'FIZZLE', label: 'not enough cards to look at' }); return }
      pushChoice(d, makeChoice(d, me, 'SCRY',
        'Put one of these into your discard pile; the other goes back on top',
        1, 1, cardOpts(looked, 'deck', me), ctx.source))
      return
    }

    case 'OPPONENT_DRAW': {
      drawCards(d, foeOf(d as unknown as GameState, me, ctx), effect.n, ev)
      return
    }

    case 'DRAW_THEN_TOPDECK': {
      // "Those cards": only what this draw produced is eligible, so the hand is
      // snapshotted first and the choice is built from the difference.
      const before = new Set(p.hand.map((c) => c.iid))
      drawCards(d, me, effect.draw, ev)
      const drawn = (p.hand as CardInstance[]).filter((c) => !before.has(c.iid))
      const n = Math.min(effect.back, drawn.length)
      if (n === 0) { ev.push({ e: 'FIZZLE', label: 'nothing drawn' }); return }
      pushChoice(d, makeChoice(d, me, 'TOPDECK_FROM_HAND',
        `Put ${n} of the drawn cards back on top of your deck, in order`,
        n, n, cardOpts(drawn, 'hand', me), ctx.source))
      return
    }

    case 'TOPDECK_FROM_HAND': {
      const opts = cardOpts(p.hand as CardInstance[], 'hand', me)
      const n = Math.min(effect.n, opts.length)
      if (n === 0) { ev.push({ e: 'FIZZLE', label: 'hand is empty' }); return }
      // Mandatory and exactly n: Warp Jump puts two back, not "up to two".
      pushChoice(d, makeChoice(d, me, 'TOPDECK_FROM_HAND',
        `Put ${n} cards back on top of your deck, in order`, n, n, opts, ctx.source))
      return
    }

    case 'RETURN_BASE_TO_HAND': {
      // Returning is not an attack, so unlike DESTROY_BASE it is NOT filtered
      // through the outpost shield: the shield is worded against attacks and
      // against destruction targeting, and Mega Mech does neither.
      const opts: ChoiceOption[] = []
      for (const pid of d.seats) {
        for (const c of d.players[pid].inPlay) {
          if (isBase(c)) opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'inPlay', owner: pid })
        }
      }
      if (opts.length === 0) { ev.push({ e: 'FIZZLE', label: 'no base to return' }); return }
      pushChoice(d, makeChoice(d, me, 'RETURN_BASE_TO_HAND',
        "Return target base to its owner's hand", effect.min, 1, opts, ctx.source))
      return
    }

    case 'COPY_BASE': {
      const src = ctx.source
      // "Any base in play" -- both sides. Copying an enemy outpost is a real and
      // intended play, so the option list is not filtered to your own side.
      const opts: ChoiceOption[] = []
      for (const pid of d.seats) {
        for (const c of d.players[pid].inPlay) {
          if (c.iid === src) continue
          if (!isBase(c)) continue
          opts.push({ o: 'CARD', iid: c.iid, def: c.def, zone: 'inPlay', owner: pid })
        }
      }
      if (opts.length === 0) {
        // Same rule as the Needle: the tower still enters play, as a plain
        // Machine Cult base with no abilities. Never block the play.
        ev.push({ e: 'FIZZLE', label: 'no base to copy' })
        return
      }
      pushChoice(d, makeChoice(d, me, 'COPY_BASE', 'Copy a base in play', 1, 1, opts, src))
      return
    }

    case 'COPY_SHIP': {
      const src = ctx.source
      const opts: ChoiceOption[] = p.shipsPlayedThisTurn
        .filter((c) => c.iid !== src)
        .map((c) => ({ o: 'CARD' as const, iid: c.iid, def: c.def, zone: 'inPlay' as Zone, owner: me }))
      if (opts.length === 0) {
        // No legal target: the Needle still enters play, as a plain Machine Cult
        // ship with no abilities. Never block the play, never softlock the prompt.
        ev.push({ e: 'FIZZLE', label: 'no ship to copy' })
        return
      }
      pushChoice(d, makeChoice(d, me, 'COPY_SHIP', 'Copy a ship you played this turn', 1, 1, opts, src))
      return
    }
  }
}

/**
 * Cards of a faction currently in play, dual-faction cards counted once.
 *
 * Deliberately NOT allyCountFor: that one folds in Mech World's wildcard and
 * Stealth's phantom card, which satisfy ally conditions without being cards you
 * "have in play" -- and Lunar Landing pays out per card, not per satisfied
 * condition.
 */
function countFactionInPlay(p: Draft<PlayerState>, faction: Faction): number {
  let n = 0
  for (const c of p.inPlay) {
    const def = cardDef(c.def)
    if (def.faction === faction || def.faction2 === faction) n++
  }
  return n
}

function evalCondition(d: D, me: PlayerId, cond: Condition): boolean {
  switch (cond.c) {
    case 'BASES_IN_PLAY_AT_LEAST':
      return d.players[me].inPlay.filter(isBase).length >= cond.n
    case 'OPPONENT_BASES_AT_LEAST':
      return foesOf(d as unknown as GameState, me)
        .some((f) => d.players[f].inPlay.filter(isBase).length >= cond.n)
    case 'FACTION_PLAYED_THIS_TURN':
      return d.players[me].factionPlayedThisTurn[cond.faction] >= cond.n
    case 'BASE_PLAYED_THIS_TURN':
      // "Including this one": the card asking has already entered play, so the
      // ordinary in-play scan answers the question with no special case.
      return d.players[me].inPlay.some((c) => c.playedThisTurn && isBase(c))
    case 'SCRAPPED_THIS_TURN':
      return d.players[me].scrappedThisTurn >= cond.n
  }
}

// ─────────────────────────────── choice resolution ───────────────────────────

type ChoiceFrame = Extract<ResolutionFrame, { f: 'choice' }>

function resolveChoice(d: D, frame: ChoiceFrame, selected: readonly ChoiceOption[], ev: GameEvent[]): void {
  const c = frame.choice
  const cont = frame.cont
  const me = c.actor
  const p = d.players[me]
  const ctx: EffectCtx = { controller: me, source: c.source, slot: 'primary' }

  switch (c.prompt) {
    case 'DISCARD': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (inst) {
          p.discard.push(inst)
          ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
        }
      }
      return
    }

    case 'SCRAP_ZONES': {
      let fromRow = false
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        if (!inst) continue
        if (o.zone === 'tradeRow') fromRow = true
        // Scrapping a card FROM hand or discard never triggers that card's own
        // scrap ability -- only a card using its own scrap ability from play does.
        // The trade row has no owner, so its scraps do not feed your own counter.
        toScrapHeap(d, inst, o.zone, o.zone === 'tradeRow' ? null : me, ev)
      }
      if (fromRow) refillTradeRow(d, ev)
      return
    }

    case 'UPGRADE_CARD': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        // Карта улучшается НА МЕСТЕ: вынимать её из зоны нельзя — улучшение
        // разыгранного корабля не должно снимать его со стола, а улучшение
        // карты в руке не должно её разыгрывать.
        const zones = [p.hand, p.discard, p.inPlay] as { iid: CardIid; up?: number }[][]
        for (const zone of zones) {
          const card = zone.find((c) => c.iid === o.iid)
          if (!card) continue
          const level = (card.up ?? 0) + 1
          card.up = level
          ev.push({ e: 'CARD_UPGRADED', player: me, iid: o.iid, def: o.def, level })
          break
        }
      }
      return
    }

    case 'SCRAP_THEN_DRAW': {
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        if (inst) { toScrapHeap(d, inst, o.zone, me, ev); n++ }
      }
      if (n > 0) pushEffects(d, [{ k: 'DRAW', n }], ctx)
      return
    }

    case 'DISCARD_THEN_DRAW': {
      // All discards land BEFORE any draw: if the deck empties during the draws,
      // the reshuffled discard pile already contains what was just discarded.
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (inst) {
          p.discard.push(inst)
          ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
          n++
        }
      }
      if (n > 0) pushEffects(d, [{ k: 'DRAW', n }], ctx)
      return
    }

    case 'SCRAP_TRADE_ROW': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
        if (idx < 0) continue
        const inst = d.tradeRow[idx] as CardInstance
        d.tradeRow[idx] = null
        toScrapHeap(d, inst, 'tradeRow', null, ev)
      }
      refillTradeRow(d, ev)
      return
    }

    case 'DESTROY_BASE': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const found = findInPlay(d as unknown as GameState, o.iid)
        // `me` resolves the choice, so `me` is the destroyer -- which matters
        // because the target may legally be one of their own bases.
        if (found) destroyBase(d, found.owner, found.card, 'effect', ev, me)
      }
      return
    }

    case 'SCRAP_ROW_FOR_COMBAT': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
        if (idx < 0) continue
        const inst = d.tradeRow[idx] as CardInstance
        d.tradeRow[idx] = null
        toScrapHeap(d, inst, 'tradeRow', null, ev)
        gain(d, me, 'combat', cardDef(inst.def).cost, ev)
      }
      refillTradeRow(d, ev)
      return
    }

    case 'SCRAP_FOR_COMBAT': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        if (!inst) continue
        toScrapHeap(d, inst, o.zone, me, ev)
        gain(d, me, 'combat', cardDef(inst.def).cost, ev)
      }
      return
    }

    case 'TOPDECK_BASE': {
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'discard', o.iid)
        if (inst) {
          p.deck.unshift(inst)
          ev.push({ e: 'TOPDECK', player: me, iid: inst.iid, def: inst.def })
        }
      }
      return
    }

    case 'DISCARD_FOR_COMBAT': {
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (!inst) continue
        p.discard.push(inst)
        ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
        n++
      }
      // The per-card value lives on the effect, not on the choice, so it is read
      // back from the frame that pushed this choice.
      if (n > 0) gain(d, me, 'combat', n * 2, ev)
      return
    }

    case 'CHOOSE_BRANCH': {
      const o = selected[0]
      if (!o || o.o !== 'BRANCH') return
      const branch = cont?.c === 'BRANCHES' ? cont.branches[o.index] : undefined
      if (branch) pushEffects(d, branch.then, ctx)
      return
    }

    case 'MAY': {
      // Declining is simply selecting nothing; the body never gets pushed.
      if (selected.length > 0 && cont?.c === 'MAY') pushEffects(d, cont.then, ctx)
      return
    }

    case 'ACQUIRE_FREE': {
      const o = selected[0]
      if (!o) return
      const dest = cont?.c === 'ACQUIRE' ? cont.dest : 'discard'
      if (o.o === 'EXPLORER') {
        if (d.explorerPile <= 0) return
        d.explorerPile -= 1
        acquire(d, me, { iid: mintId(d, 12) as CardIid, def: EXPLORER }, 0, dest, ev)
        return
      }
      if (o.o !== 'CARD') return
      const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
      if (idx < 0) return
      const inst = d.tradeRow[idx] as CardInstance
      d.tradeRow[idx] = null
      acquire(d, me, inst, 0, dest, ev)
      refillTradeRow(d, ev)
      return
    }

    case 'REDIRECT_ACQUIRED': {
      const o = selected[0]
      if (!o || o.o !== 'BRANCH' || cont?.c !== 'REDIRECT') return
      const dest = cont.dests[o.index]
      const armed = cont.redirects[o.index]
      if (dest === undefined || armed === undefined) return
      const idx = p.discard.findIndex((x) => x.iid === cont.iid)
      if (idx < 0) return
      const inst = p.discard.splice(idx, 1)[0] as CardInstance
      if (dest === 'hand') p.hand.push(inst)
      else if (dest === 'in_play') enterPlay(d, me, inst, ev)
      else p.deck.unshift(inst)
      // Consume exactly the redirect that was chosen, not merely one of the
      // matching ones: they can differ in destination, and spending the wrong
      // one silently changes where the NEXT acquisition lands.
      p.pendingRedirects.splice(armed, 1)
      ev.push({ e: 'ACQUIRE', player: me, def: inst.def, dest, cost: 0 })
      return
    }

    case 'DISCARD_FOR_TRADE_OR_COMBAT': {
      if (cont?.c === 'DISCARD_PLUS') {
        // Midgate Station: ONE resource choice for the whole lot, and the count
        // is the cards discarded PLUS one -- so discarding nothing still pays.
        let n = 0
        for (const o of selected) {
          if (o.o !== 'CARD') continue
          const inst = removeFromZone(d, me, 'hand', o.iid)
          if (!inst) continue
          p.discard.push(inst)
          ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
          n++
        }
        const total = n + cont.plus
        pushEffects(d, [{
          k: 'CHOOSE_ONE',
          branches: [
            { label: `{trade:${total}}`, then: [{ k: 'GAIN_TRADE', n: total }] },
            { label: `{combat:${total}}`, then: [{ k: 'GAIN_COMBAT', n: total }] },
          ],
        }], ctx)
        return
      }
      const per = cont?.c === 'DISCARD_RESOURCE' ? cont.per : 2
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (!inst) continue
        p.discard.push(inst)
        ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
        // One choice per card discarded, so a mixed split is legal -- which is
        // what "gain 2 Trade or 2 Combat for EACH card" says.
        pushEffects(d, [{
          k: 'CHOOSE_ONE',
          branches: [
            { label: `{trade:${per}}`, then: [{ k: 'GAIN_TRADE', n: per }] },
            { label: `{combat:${per}}`, then: [{ k: 'GAIN_COMBAT', n: per }] },
          ],
        }], ctx)
      }
      return
    }

    case 'COPY_USED_ALLY': {
      const o = selected[0]
      if (!o || o.o !== 'BRANCH' || cont?.c !== 'COPY_ALLY') return
      const pick = cont.used[o.index]
      if (!pick) return
      const def = cardDef(pick.def)
      const effects = def[pick.slot as 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly']
      // Copied, not re-activated: the original card's once-per-turn flag is
      // untouched, and the copy does not itself join the list.
      if (effects.length > 0) pushEffects(d, effects, ctx)
      return
    }

    case 'CHOOSE_FACTION': {
      const o = selected[0]
      if (!o || o.o !== 'BRANCH') return
      const faction = FACTIONS.filter((f) => f !== 'unaligned')[o.index]
      if (!faction) return
      if (cont?.c === 'PHANTOM') {
        for (let i = 0; i < cont.n; i++) p.phantomFactions.push(faction)
      } else if (cont?.c === 'OWN_FACTION') {
        const card = p.inPlay.find((x) => x.iid === cont.iid)
        if (!card) return
        card.chosenFaction = faction
      }
      // Either way a new faction is now present, so the unlock has to be
      // recomputed exactly as it is when a real card enters play.
      recomputeAlly(d, me, ev)
      return
    }

    case 'SCRY': {
      // The unchosen cards need no move: they were never taken out of the deck,
      // so removing the chosen ones leaves the rest exactly on top, in order.
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const idx = p.deck.findIndex((x) => x.iid === o.iid)
        if (idx < 0) continue
        p.discard.push(p.deck.splice(idx, 1)[0] as CardInstance)
        ev.push({ e: 'DISCARD', player: me, iid: o.iid, def: o.def })
      }
      return
    }

    case 'DISCARD_TO_HAND': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const inst = removeFromZone(d, me, 'discard', o.iid)
      if (inst) p.hand.push(inst)
      return
    }

    case 'SCRAP_THEN_GAIN': {
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, o.zone, o.iid)
        if (!inst) continue
        toScrapHeap(d, inst, o.zone, me, ev)
        n++
      }
      if (n === 0) return
      if (cont?.c === 'SCRAP_GAIN') {
        gain(d, me, cont.what, n * cont.per, ev)
      } else {
        // Mech Battleship: draw as many as were scrapped, then discard as many.
        pushEffects(d, [{ k: 'DRAW', n }, { k: 'SELF_DISCARD', n }], ctx)
      }
      return
    }

    case 'BUY_FROM_SCRAP_HEAP': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const idx = d.scrapHeap.findIndex((x) => x.iid === o.iid)
      if (idx < 0) return
      const inst = d.scrapHeap[idx] as CardInstance
      const price = costFor(cardDef(inst.def), p.inPlay, {
        variant: d.variant, buyer: me, scenario: d.scenario,
      })
      if (p.trade < price) return
      p.trade -= price
      d.scrapHeap.splice(idx, 1)
      p.hand.push(inst)
      ev.push({ e: 'ACQUIRE', player: me, def: inst.def, dest: 'hand', cost: price })
      return
    }

    case 'REVEAL_SPLIT': {
      const o = selected[0]
      if (!o || o.o !== 'CARD' || cont?.c !== 'REVEAL_SPLIT') return
      const idx = p.deck.findIndex((x) => x.iid === o.iid)
      if (idx < 0) return
      const inst = p.deck.splice(idx, 1)[0] as CardInstance
      if (cont.dest === 'hand') p.hand.push(inst)
      else p.discard.push(inst)
      const rest = cont.iids.filter((x) => x !== o.iid)
      if (cont.dest === 'hand' && rest.length > 1) {
        // Two left and two destinations: the third needs no prompt, because it
        // is already on top of the deck and staying there.
        const remaining = (p.deck as CardInstance[]).filter((c) => rest.includes(c.iid))
        pushChoice(d, makeChoice(d, me, 'REVEAL_SPLIT',
          'Put one of these into your discard pile; the other stays on top',
          1, 1, cardOpts(remaining, 'deck', me), c.source),
          { c: 'REVEAL_SPLIT', iids: rest, dest: 'discard' })
      }
      return
    }

    case 'SET_ASIDE_FROM_ROW': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const idx = d.tradeRow.findIndex((x) => x?.iid === o.iid)
      if (idx < 0) return
      d.setAside.push(d.tradeRow[idx] as CardInstance)
      d.tradeRow[idx] = null
      ev.push({ e: 'SET_ASIDE', def: o.def })
      refillTradeRow(d, ev)
      return
    }

    case 'STEAL_FROM_DISCARD': {
      const foe = foeOf(d as unknown as GameState, me)
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, foe, 'discard', o.iid)
        // Into YOUR discard pile: it joins your deck on the next reshuffle.
        if (inst) p.discard.push(inst)
      }
      return
    }

    case 'DISCARD_OR_LOSE': {
      const cfg = cont?.c === 'DISCARD_OR_LOSE' ? cont : { max: 2, per: 4 }
      let n = 0
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (!inst) continue
        p.discard.push(inst)
        ev.push({ e: 'DISCARD', player: me, iid: inst.iid, def: inst.def })
        n++
      }
      const short = Math.max(0, cfg.max - n)
      if (short > 0) pushEffects(d, [{ k: 'LOSE_AUTHORITY', n: short * cfg.per }], ctx)
      return
    }

    case 'DESTROY_OWN_BASE_OR_LOSE': {
      const cfg = cont?.c === 'DESTROY_OR_LOSE' ? cont : { n: 6 }
      const o = selected[0]
      if (!o || o.o !== 'CARD') {
        pushEffects(d, [{ k: 'LOSE_AUTHORITY', n: cfg.n }], ctx)
        return
      }
      const found = findInPlay(d as unknown as GameState, o.iid)
      // Self-inflicted, so the destroyer is the owner and it must not count
      // towards a "destroy enemy bases" objective.
      if (found) destroyBase(d, found.owner, found.card, 'effect', ev, found.owner)
      return
    }

    case 'TOPDECK_FROM_HAND': {
      // Selection order IS the deck order: "in any order" is the player's call,
      // and the last one selected ends up on top.
      for (const o of selected) {
        if (o.o !== 'CARD') continue
        const inst = removeFromZone(d, me, 'hand', o.iid)
        if (!inst) continue
        p.deck.unshift(inst)
        ev.push({ e: 'TOPDECK', player: me, iid: inst.iid, def: inst.def })
      }
      return
    }

    case 'RETURN_BASE_TO_HAND': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const found = findInPlay(d as unknown as GameState, o.iid)
      if (!found) return
      const owner = d.players[found.owner]
      const idx = owner.inPlay.findIndex((x) => x.iid === o.iid)
      if (idx < 0) return
      owner.inPlay.splice(idx, 1)
      // To HAND, not to the discard pile: its owner replays it for free.
      owner.hand.push(sameCard(found.card))
      ev.push({ e: 'RETURN_TO_HAND', owner: found.owner, iid: found.card.iid, def: found.card.def })
      return
    }

    case 'COPY_BASE': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const tower = c.source ? p.inPlay.find((x) => x.iid === c.source) : undefined
      if (!tower) return
      tower.copiedDef = o.def
      ev.push({ e: 'COPY_SHIP', player: me, iid: tower.iid, copied: o.def })
      // A base's primary is activated, not resolved on play, so unlike the
      // Needle nothing is pushed here: the tower simply now HAS that base's
      // abilities, and the player activates them when they choose.
      return
    }

    case 'COPY_SHIP': {
      const o = selected[0]
      if (!o || o.o !== 'CARD') return
      const needle = c.source ? p.inPlay.find((x) => x.iid === c.source) : undefined
      if (!needle) return
      needle.copiedDef = o.def
      ev.push({ e: 'COPY_SHIP', player: me, iid: needle.iid, copied: o.def })
      // The Needle becomes a full copy: resolve the copied ship's primary now, and
      // it gains that ship's ally/scrap for the rest of the turn. Its faction set
      // grows too -- but the copy does NOT count as a card played, so the
      // faction-played counters (Blob World) are deliberately untouched.
      pushEffects(d, cardDef(o.def).primary, { controller: me, source: needle.iid, slot: 'primary' })
      return
    }
  }
}

// ─────────────────────────────────── settle ──────────────────────────────────

/**
 * Run the resolution stack until it is empty or blocked on a real choice.
 *
 * Implements the rulebook's general partial-resolution rule -- "if you cannot
 * resolve part of an ability, just do as much as you can in the order written" --
 * as ONE rule here rather than ad hoc per card: a mandatory choice with no legal
 * options fizzles instead of deadlocking.
 */
/**
 * Вырожденный выбор, который бьёт по своим.
 *
 * «Уничтожьте выбранную базу» обязательно, а своя база — законная цель, и
 * когда у соперника баз нет, единственной целью оказывается собственная. Формально
 * решать тут нечего, и раньше движок сносил её молча: игрок нажимал «все союзы»,
 * а со стола пропадал его аванпост — без вопроса, без паузы, посреди очереди
 * свойств.
 *
 * Правило от этого не меняется: база всё равно будет уничтожена, отказаться
 * нельзя. Но выбор предъявляется, а значит очередь свойств останавливается и
 * игрок видит, чем именно платит.
 */
function selfHarm(c: PendingChoice): boolean {
  if (c.prompt !== 'DESTROY_BASE') return false
  return c.options.every((o) => o.o === 'CARD' && o.owner === c.actor)
}

/**
 * Выигранное пари платит сразу, а не в конце хода.
 *
 * Проверяется там же, где победа — после каждой команды: игрок должен видеть,
 * что ставка взята, в тот момент, когда она взята, иначе остаток хода он
 * доигрывает вслепую. Флаг `won` ставится ДО выдачи улучшения: выбор карты
 * попадёт в стек разрешения, settle прокрутится ещё раз, и без флага пари
 * выплатилось бы столько раз, сколько кругов сделает цикл.
 */
function checkWagers(d: D, ev: GameEvent[]): void {
  for (const pid of d.seats) {
    const p = d.players[pid]
    const w = p.wager
    if (!w || w.won) continue
    const spec = wagerById(w.id)
    if (!spec) continue
    if (!wagerProgress(spec, wagerSourceOf(d.tally[pid], p as unknown as PlayerState)).met) continue
    p.wager = { ...w, won: true }
    ev.push({ e: 'WAGER_WON', player: pid, id: w.id })
    pushEffects(d, [{ k: 'UPGRADE_CARD', n: 1 }], { controller: pid, source: null, slot: 'primary' })
  }
}

export function settle(d: D, ev: GameEvent[]): void {
  let steps = 0
  for (;;) {
    if (++steps > MAX_RESOLUTION_STEPS) throw new Error('settle: resolution did not converge')
    for (const pid of d.seats) recomputeAlly(d, pid, ev)
    checkWagers(d, ev)
    checkWin(d, ev)
    if (d.phase === 'gameOver') return

    const top = d.resolution[0]
    if (!top) return

    if (top.f === 'effect') {
      d.resolution.shift()
      applyEffect(d, top.effect as Effect, top.ctx as EffectCtx, ev)
      continue
    }

    const choice = top.choice as PendingChoice
    if (choice.options.length === 0) {
      const frame = d.resolution.shift() as unknown as ChoiceFrame
      if (choice.min > 0) {
        // Nothing to pick and something was required: partial resolution says
        // do as much as you can, which here is nothing.
        ev.push({ e: 'FIZZLE', label: choice.label })
        continue
      }
      // Nothing to pick and nothing was required: that IS the answer, and the
      // continuation still has to run. Midgate Station pays for discarding no
      // cards; a fizzle here would silently swallow the payout.
      resolveChoice(d, frame, [], ev)
      continue
    }
    if (choice.options.length <= choice.min && !selfHarm(choice)) {
      // No meaningful decision: resolve it silently but still narrate it.
      const frame = d.resolution.shift() as unknown as ChoiceFrame
      ev.push({ e: 'CHOICE_AUTO_RESOLVED', player: choice.actor, label: choice.label })
      resolveChoice(d, frame, choice.options, ev)
      continue
    }
    return // blocked on real input
  }
}

// ────────────────────────────────── actions ──────────────────────────────────

function playCard(d: D, me: PlayerId, iid: CardIid, ev: GameEvent[]): void {
  const p = d.players[me]
  const idx = p.hand.findIndex((c) => c.iid === iid)
  if (idx < 0) throw new IllegalActionError(`card ${iid} is not in hand`)
  const inst = p.hand.splice(idx, 1)[0] as CardInstance
  const def = cardDef(inst.def)

  const card: InPlayCard = {
    iid: inst.iid,
    def: inst.def,
    ...(inst.up ? { up: inst.up } : {}),
    copiedDef: null, chosenFaction: null,
    used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
    playedThisTurn: true,
  }
  p.inPlay.push(card as Draft<InPlayCard>)
  p.factionPlayedThisTurn[def.faction] += 1
  if (def.type === 'ship') p.shipsPlayedThisTurn.push(inst)
  ev.push({ e: 'PLAY_CARD', player: me, iid: inst.iid, def: inst.def })

  const ctx: EffectCtx = { controller: me, source: inst.iid, slot: 'primary' }
  const queued: Effect[] = []
  // Commitment to the Cause: the three starter ships each produce one more.
  if (d.variant?.id === 'commitment-to-the-cause') {
    if (inst.def === SCOUT || inst.def === EXPLORER) queued.push({ k: 'GAIN_TRADE', n: 1 })
    if (inst.def === VIPER) queued.push({ k: 'GAIN_COMBAT', n: 1 })
  }
  if (def.type === 'ship') {
    // A ship's primary ability is mandatory and immediate. A base's is not: the
    // player chooses when to activate it during their main phase.
    //
    // Улучшение поднимает САМО свойство, а не приписывает очко сбоку: у карты
    // с «ИЛИ» поднимаются обе ветки, и что бы игрок ни выбрал, улучшение с ним.
    // База получает своё при активации — см. activate().
    const up = inst.up ?? 0
    queued.push(...withUpgrade(def.primary, up))
    // Поднимать было нечего (свойство вида «за каждую») — тогда плоская
    // добавка, иначе улучшение на такой карте не значило бы ничего.
    if (up > 0 && upgradeTargets(def.primary, up).length === 0) {
      queued.push(...upgradeFallback(def, up))
    }
    card.used.primary = true
  }
  // The card's own on-play triggers (Stealth Tower). Deliberately NOT its
  // primary: a base's primary is an activated ability, and folding the two
  // together would spend the tower's activation on the copying.
  for (const t of def.triggers) {
    if (t.on !== 'PLAY_SELF') continue
    queued.push(...t.effects)
  }
  // Triggered abilities of cards ALREADY in play (Fleet HQ), and of revealed
  // gambits, which watch from beside the board rather than on it.
  const on = def.type === 'ship' ? 'PLAY_SHIP' : 'PLAY_BASE'
  const watchers = [...p.inPlay, ...p.gambitsInPlay]
  for (const other of watchers) {
    if (other.iid === inst.iid) continue
    for (const t of cardDef(effectiveDefId({ ...other, copiedDef: null })).triggers) {
      if (t.on !== on) continue
      // Colony Wars' Command Center fires only on Star Empire ships; Veteran
      // Pilots fires only on Vipers.
      if (t.faction && t.faction !== def.faction && t.faction !== def.faction2) continue
      if (t.cardId && t.cardId !== inst.def) continue
      queued.push(...t.effects)
      ev.push({ e: 'ABILITY_USED', player: me, iid: other.iid, def: other.def, slot: 'trigger' })
    }
  }
  if (queued.length > 0) pushEffects(d, queued, ctx)
}

/**
 * The three Shards a Splinter ability would spend, or an empty list.
 *
 * "Play three matching Shards on a turn, then discard that set of three from
 * play." Command Shard counts as any name, so it fills a gap in a set rather
 * than forming one of its own.
 */
export function splinterSet(
  p: { inPlay: readonly Pick<InPlayCard, 'iid' | 'def' | 'playedThisTurn'>[] },
  card: Pick<InPlayCard, 'iid' | 'def'>,
): Pick<InPlayCard, 'iid' | 'def'>[] {
  const played = p.inPlay.filter((c) => c.playedThisTurn)
  const same = played.filter((c) => c.def === card.def)
  const wild = played.filter((c) => c.def !== card.def && cardDef(c.def).splinterWildcard)
  const set = [...same, ...wild].slice(0, 3)
  return set.length === 3 && set.some((c) => c.iid === card.iid) ? set : []
}

function activate(
  d: D, me: PlayerId, iid: CardIid,
  slot:
    | 'primary' | 'ally' | 'ally2' | 'ally3' | 'ally4' | 'doubleAlly' | 'scrap' | 'splinter',
  ev: GameEvent[],
): void {
  const p = d.players[me]
  // Revealed gambits are activated exactly like cards in play; they simply live
  // beside the board rather than on it.
  const card = p.inPlay.find((c) => c.iid === iid) ?? p.gambitsInPlay.find((c) => c.iid === iid)
  if (!card) throw new IllegalActionError(`card ${iid} is not in play`)
  // A gambit or scenario card is not on the table, it is beside it: the rules
  // about what a ship's primary means do not apply to it.
  const besideTheBoard = p.gambitsInPlay.some((c) => c.iid === iid)
  if (card.used[slot]) throw new IllegalActionError(`${slot} already used this turn`)

  const def = cardDef(effectiveDefId(card))
  const effects = def[slot]
  if (effects.length === 0) throw new IllegalActionError(`card has no ${slot} ability`)

  if (slot === 'ally' || slot === 'ally2' || slot === 'ally3' || slot === 'ally4') {
    // A pinned faction (United's per-faction slots) needs that faction; an
    // unpinned one needs ANY of the card's own factions, which covers both the
    // ordinary case and United's "Coalition Ally (Machine Cult or Trade
    // Federation)", where either half will do.
    const pinned = allySlotFaction(def, slot)
    const need = pinned ? [pinned] : factionsOf(card)
    if (!need.some((f) => p.allyUnlocked.includes(f))) {
      throw new IllegalActionError('ally condition not met')
    }
  }
  if (slot === 'doubleAlly') {
    const factions = factionsOf(card)
    if (!factions.some((f) => p.doubleAllyUnlocked.includes(f))) {
      throw new IllegalActionError('double ally condition not met')
    }
  }
  if (slot === 'primary' && !besideTheBoard && cardDef(card.def).type === 'ship') {
    throw new IllegalActionError('a ship primary resolves on play')
  }
  if (slot === 'primary' && cardDef(card.def).type === 'hero') {
    throw new IllegalActionError('a hero primary resolves on acquisition')
  }
  // High Alert's Tech is the one ability you PAY for. The trade is spent whether
  // or not the effect finds a target, exactly as a purchase is.
  const price = slot === 'primary' ? (def.primaryCost ?? 0) : 0
  if (price > 0) {
    if (p.trade < price) throw new IllegalActionError('not enough trade to activate')
    p.trade -= price
    ev.push({ e: 'GAIN', player: me, what: 'trade', n: -price })
  }

  card.used[slot] = true
  ev.push({ e: 'ABILITY_USED', player: me, iid: card.iid, def: card.def, slot })
  // Remembered for Needle Lancer, which copies an ally ability used earlier this
  // turn. Stored as definition + slot so it survives the card leaving play.
  if (slot !== 'primary' && slot !== 'scrap' && slot !== 'splinter') {
    // A copy ability is not itself copyable: there would be nothing behind it,
    // and two Needle Lancers pointing at each other would never terminate.
    if (!effects.some((e) => e.k === 'COPY_USED_ALLY')) {
      p.alliesUsedThisTurn.push({ iid: card.iid, def: effectiveDefId(card), slot })
    }
  }

  if (slot === 'splinter') {
    // The cost of a Splinter ability is the three matching Shards themselves:
    // they are discarded from play, and their primaries have already resolved.
    const set = splinterSet(p, card)
    for (const c of set) {
      const at = p.inPlay.findIndex((x) => x.iid === c.iid)
      if (at < 0) continue
      p.inPlay.splice(at, 1)
      p.discard.push(sameCard(c))
      ev.push({ e: 'DISCARD', player: me, iid: c.iid, def: c.def })
    }
    for (const g of p.gambitsInPlay) {
      for (const t of cardDef(g.def).triggers) {
        if (t.on !== 'SPLINTER') continue
        pushEffects(d, t.effects, { controller: me, source: g.iid, slot: 'trigger' })
      }
    }
  }

  if (slot === 'scrap') {
    // Alignment Ingenuity watches this: "whenever you use a scrap ability of a
    // ship or base". Gambits scrap themselves too, and are not ships or bases,
    // so the watcher only fires for cards that were in play.
    for (const g of p.gambitsInPlay) {
      for (const t of cardDef(g.def).triggers) {
        if (t.on !== 'SCRAP_ABILITY') continue
        pushEffects(d, t.effects, { controller: me, source: g.iid, slot: 'trigger' })
      }
    }
    // Using a card's own scrap ability removes it from play permanently. Its
    // other abilities may have been used first, which is the standard line.
    const idx = p.inPlay.findIndex((c) => c.iid === iid)
    p.inPlay.splice(idx, 1)
    toScrapHeap(d, sameCard(card), 'inPlay', me, ev)
  }
  // Улучшение поднимает ЛЮБОЕ свойство этой копии, а не только первое: игрок
  // улучшал карту, а не её верхнюю строчку. Гамбитов и реликвий это не
  // касается — их не улучшают.
  const up = besideTheBoard ? 0 : (card.up ?? 0)
  pushEffects(d, withUpgrade(effects, up), { controller: me, source: iid, slot })
  if (up > 0 && upgradeTargets(effects, up).length === 0) {
    pushEffects(d, upgradeFallback(def, up), { controller: me, source: iid, slot })
  }
}

function buyFromRow(d: D, me: PlayerId, iid: CardIid, ev: GameEvent[]): void {
  const p = d.players[me]
  const idx = d.tradeRow.findIndex((c) => c?.iid === iid)
  // A set-aside card is bought "as if it were in the trade row" -- same price,
  // same routing -- but its slot is not refilled, because it never had one.
  if (idx < 0) {
    const aside = d.setAside.findIndex((c) => c.iid === iid)
    if (aside < 0) throw new IllegalActionError('card is not in the trade row')
    const card = d.setAside[aside] as CardInstance
    // With the same context legal.ts uses. Without it the two disagreed, and a
    // discounted set-aside card was offered and then refused.
    const price = costFor(cardDef(card.def), p.inPlay, {
      variant: d.variant, buyer: me, scenario: d.scenario,
    })
    if (p.trade < price) throw new IllegalActionError('not enough trade')
    p.trade -= price
    d.setAside.splice(aside, 1)
    acquire(d, me, card, price, 'discard', ev)
    return
  }
  const inst = d.tradeRow[idx] as CardInstance
  // High Alert prices some cards against your board, so the price is computed
  // here rather than read off the card -- see costFor.
  let cost = costFor(cardDef(inst.def), p.inPlay, {
    variant: d.variant, buyer: me, counters: d.marketCounters[inst.iid] ?? 0,
    scenario: d.scenario,
  })
  // Black Market: one point off, once per turn, for whoever revealed it, and
  // only from the slots the Black Market itself added.
  const fromMarket = idx >= TRADE_ROW_SIZE
    && d.blackMarketOwner === me
    && !d.blackMarketUsedThisTurn
  if (fromMarket) cost = Math.max(0, cost - 1)
  // Federation Scout: one armed discount, spent on the next card of its faction.
  const discount = p.pendingDiscounts.findIndex(
    (x) => factionsOf({ def: inst.def, copiedDef: null }).includes(x.faction),
  )
  if (discount >= 0) {
    cost = Math.max(0, cost - (p.pendingDiscounts[discount]?.n ?? 0))
    p.pendingDiscounts.splice(discount, 1)
  }
  if (p.trade < cost) throw new IllegalActionError('not enough trade')
  p.trade -= cost
  if (fromMarket) d.blackMarketUsedThisTurn = true
  d.tradeRow[idx] = null
  acquire(d, me, inst, cost, 'discard', ev)
  refillTradeRow(d, ev)
}

function buyExplorer(d: D, me: PlayerId, ev: GameEvent[]): void {
  const p = d.players[me]
  if (d.explorerPile <= 0) throw new IllegalActionError('explorer pile is empty')
  if (p.trade < EXPLORER_COST) throw new IllegalActionError('not enough trade')
  p.trade -= EXPLORER_COST
  d.explorerPile -= 1
  // The Explorer pile is never refilled from the trade deck and never enters the row.
  acquire(d, me, { iid: mintId(d, 12) as CardIid, def: EXPLORER }, EXPLORER_COST, 'discard', ev)
}

/**
 * One seat's Discard and Draw Phases.
 *
 * Split out from endTurn because a Hydra team "shares their Main, Discard, and
 * Draw Phases": every living teammate discards and redraws when the team's one
 * turn ends, so this has to be callable per seat rather than only for whoever
 * happens to hold `activePlayer`.
 */
function endTurnFor(d: D, me: PlayerId, ev: GameEvent[]): void {
  const p = d.players[me]
  ev.push({ e: 'TURN_END', player: me })

  // A script boss has, per its challenge, "no hand, deck or Discard Pile". So it
  // skips the discard-and-draw phase entirely: what it has taken stays on the
  // table as its armada. Running the normal phase would quietly hand it a deck
  // -- the discarded ships get shuffled back on the next empty draw -- which is
  // exactly the thing the challenge says it does not have.
  const scriptBoss = d.boss?.kind === 'script' && me === bossSeat(d)

  // Discard phase. Unspent trade and combat are LOST.
  p.trade = 0
  p.combat = 0
  if (!scriptBoss) {
    const staying: Draft<InPlayCard>[] = []
    for (const c of p.inPlay) {
      // Bases stay, and so do Heroes and Tech: they wait in the play area across
      // turns, which is the whole of what makes them what they are.
      if (isBase(c) || isHero(c) || isTech(c)) { staying.push(c); continue }
      p.discard.push(sameCard(c))
    }
    p.inPlay = staying
    // Docking: a card that would be discarded goes back to hand instead, if you
    // have a base of its faction standing. Handled here rather than as a trigger
    // because it fires during the discard phase, when no ability can be used.
    const docked: typeof p.hand = []
    // Ready Reserves: nothing in hand is discarded, and every card kept is one
    // fewer drawn -- so the hand is topped back up to its size rather than
    // refilled, and holding a card costs a draw exactly as the card says.
    const keepAll = d.variant?.id === 'ready-reserves'
    for (const c of p.hand) {
      const dock = cardDef(c.def).docking
      if (keepAll || (dock && p.inPlay.some((b) => isBase(b) && factionsOf(b).includes(dock)))) {
        docked.push(c)
        if (!keepAll) ev.push({ e: 'DOCKED', player: me, iid: c.iid, def: c.def })
        continue
      }
      p.discard.push(c)
    }
    p.hand = docked
  }

  // Mobile Market: it comes back from the scrap heap at end of turn. Done here,
  // before the per-turn reset, so the card lands in the discard pile and is part
  // of the deck again on the next reshuffle.
  for (const iid of p.returnAtEndOfTurn) {
    const idx = d.scrapHeap.findIndex((c) => c.iid === iid)
    if (idx < 0) continue
    const inst = d.scrapHeap.splice(idx, 1)[0] as CardInstance
    p.discard.push(inst)
    ev.push({ e: 'RETURN_FROM_SCRAP', player: me, iid: inst.iid, def: inst.def })
  }
  p.returnAtEndOfTurn = []

  // Пари гасится в конце ТОГО ЖЕ хода, на который взято: ставка на один ход,
  // и переносить её на следующий значило бы дать бесплатную попытку. Ничего не
  // отнимается: цена уже уплачена вперёд, и наказывать второй раз за один
  // проигрыш — это две цены за одну ставку.
  const bet = p.wager
  if (bet) {
    if (!bet.won) ev.push({ e: 'WAGER_LOST', player: me, id: bet.id, n: WAGER_PRICE })
    p.wager = null
  }

  // Per-turn bookkeeping that is easy to forget and silently wrong if missed.
  p.factionPlayedThisTurn = emptyFactionCounts()
  p.shipsPlayedThisTurn = []
  p.allyUnlocked = []
  p.doubleAllyUnlocked = []
  p.pendingRedirects = []
  p.scrappedThisTurn = 0
  p.phantomFactions = []
  p.alliesUsedThisTurn = []
  p.gainedThisTurn = { trade: 0, combat: 0, authority: 0 }
  p.gainedAuthorityThisTurn = false
  p.acquiredThisTurn = false
  p.pendingDiscounts = []
  // Buyer's Market: at the end of each player's turn, a counter goes on the most
  // expensive card or cards in the row. Printed cost, not the discounted one --
  // otherwise a card would keep discounting itself further every turn.
  if (d.variant?.id === 'buyers-market') {
    let top = 0
    for (const c of d.tradeRow) if (c) top = Math.max(top, cardDef(c.def).cost)
    for (const c of d.tradeRow) {
      if (c && cardDef(c.def).cost === top) {
        d.marketCounters[c.iid] = (d.marketCounters[c.iid] ?? 0) + 1
      }
    }
  }
  // Stealth Tower copies a base "until your turn ends", so the copy is dropped
  // HERE rather than at the start of your next turn. The difference is not
  // cosmetic: a copied outpost left standing would shield you through the
  // opponent's attack, which is exactly the turn the printed wording excludes.
  for (const c of p.inPlay) c.copiedDef = null

  // Fleeting Opportunities: at the start of each player's turn the far card is
  // scrapped and the row slides down. Done at the turn boundary, which is where
  // the row is otherwise untouched, so it reads in one place.
  if (d.variant?.id === 'fleeting-opportunities') {
    slideTradeRow(d, ev)
  }

  // A deck boss draws what its challenge card says, not the standard five.
  const bossHand = d.boss && d.boss.kind === 'deck' && me === bossSeat(d) ? d.boss.handSize : 0
  // Cards kept in hand count against the draw, so the hand ends the turn at its
  // size however many were held.
  const target = bossHand > 0 ? bossHand : p.handSize
  if (!scriptBoss) drawCards(d, me, Math.max(0, target - p.hand.length), ev)
}

/** One seat's start-of-turn reset. Per seat, for the same reason as above. */
function startTurnFor(d: D, seat: PlayerId, ev: GameEvent[]): void {
  const next = d.players[seat]
  // "The first time the Boss makes 'target opponent discard a card' on its
  // turn, randomly determine which player it targets. It will target the same
  // player for the remainder of the turn" (Defy the Empire, challenge rules).
  // Rolled once here rather than lazily on the first such ability, which lands
  // in the same place and keeps the RNG out of the effect handlers. A table
  // taking individual turns names its target by whose turn just ended instead.
  const c = d.coop
  if (c && seat === c.boss && sharedTurn(c.mode)) {
    const live = livePlayers(c)
    if (live.length > 0) {
      let i: number
      ;[i, d.rng] = nextInt(d.rng, live.length) as [number, typeof d.rng]
      c.bossTarget = live[i] as PlayerId
    }
  }
  // Blob Assault: "On its turn, the Boss plays the top card of the Blob Deck.
  // When playing with more than one player, it then 'draws a card' for each
  // player beyond the first." The played card is its ordinary one-card hand;
  // the extra draws are these.
  if (c && seat === c.boss && d.boss?.id === 'blob-assault') {
    const extra = c.players.length - 1
    if (extra > 0) {
      pushEffects(d, Array.from({ length: extra }, () => ({ k: 'BOSS_BLOB_DRAW' as const })),
        { controller: seat, source: null, slot: 'primary' })
    }
  }
  next.trade = 0
  next.combat = 0
  next.factionPlayedThisTurn = emptyFactionCounts()
  next.shipsPlayedThisTurn = []
  next.allyUnlocked = []
  next.doubleAllyUnlocked = []
  next.pendingRedirects = []
  next.scrappedThisTurn = 0
  next.phantomFactions = []
  next.alliesUsedThisTurn = []
  next.gainedThisTurn = { trade: 0, combat: 0, authority: 0 }
  next.gainedAuthorityThisTurn = false
  next.acquiredThisTurn = false
  next.pendingDiscounts = []
  // The fight tally rolls over HERE and not at end of turn: a fight that ends
  // mid-turn must leave that turn's numbers standing, because they are what
  // the run reads afterwards.
  const t = d.tally[seat]
  t.dmgBest = Math.max(t.dmgBest, t.dmg)
  t.dmg = 0
  t.buysBest = Math.max(t.buysBest, t.buys)
  t.buys = 0
  // Revealed gambits recharge with everything else in play.
  for (const g of next.gambitsInPlay) {
    g.used = {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    }
  }
  d.blackMarketUsedThisTurn = false
  // Frontier Fleet and its kind: an ongoing gambit that pays at the start of
  // every one of your turns, so it is granted here rather than by an action.
  for (const g of next.gambitsInPlay) {
    const def = cardDef(g.def)
    // An ACTIVATED gambit waits to be asked; only the automatic ones pay here.
    const turnStart = def.activated ? [] : def.primary
    if (turnStart.length > 0) {
      pushEffects(d, turnStart, { controller: seat, source: g.iid, slot: 'primary' })
    }
  }
  for (const c of next.inPlay) {
    c.used = {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    }
    c.playedThisTurn = false
    // Copy state is cleared when its own turn ends, not here -- see above.
  }
  // A scenario's per-turn funding is granted like any other gain: at the start
  // of the turn, spendable by the normal rules, and lost at end of turn if
  // unspent. This is the whole of what makes a boss a boss -- no second card
  // type, no special-cased combat.
  const sc = d.scenario
  if (sc) {
    const combat = sc.turnStartCombat[seat] ?? 0
    const trade = sc.turnStartTrade[seat] ?? 0
    if (combat > 0) gain(d, seat, 'combat', combat, ev)
    if (trade > 0) gain(d, seat, 'trade', trade, ev)
  }
}

/**
 * Whose turn it is next.
 *
 * A duel alternates. A co-op table alternates between the players and the Boss,
 * and how the players' half is spent is what the three team modes disagree
 * about: a Hydra team and a Pirates table take ONE shared turn together, while
 * the Dimensional Horror's table takes individual turns with a Boss turn
 * squeezed in after each of them -- aimed, per its card, at the player whose
 * turn just ended.
 */
function advanceSeat(d: D): void {
  const c = d.coop
  const me = d.activePlayer
  if (!c) { d.activePlayer = opponentOf(me); return }
  const live = livePlayers(c)
  if (me === c.boss) {
    if (c.mode === 'individual') {
      const at = c.bossTarget ? live.indexOf(c.bossTarget) : -1
      d.activePlayer = (live[(at + 1) % live.length] ?? c.boss) as PlayerId
      return
    }
    d.activePlayer = (live[0] ?? c.boss) as PlayerId
    return
  }
  if (c.mode === 'individual') c.bossTarget = me
  d.activePlayer = c.boss
}

/** The seats that share the turn now ending, in seat order. */
function turnSeats(d: D, seat: PlayerId): readonly PlayerId[] {
  const c = d.coop
  if (c && sharedTurn(c.mode) && c.players.includes(seat)) {
    const live = livePlayers(c)
    return live.length > 0 ? live : [seat]
  }
  return [seat]
}

/**
 * `skipped` — ход, которого не было: его некому доигрывать.
 *
 * Так закрывается пропуск по уровню сложности. Без этого босс на пропущенном
 * ходу сбрасывал руку и добирал новую — в журнале это выглядело как его ход,
 * то есть ровно то, чего пропуск и должен избежать.
 */
function endTurn(d: D, ev: GameEvent[], skipped = false): void {
  const ending = turnSeats(d, d.activePlayer)
  // Кто именно сейчас доигрывает: после advanceSeat это уже не узнать, а
  // двойной первый ход босса решается ровно этим.
  const bossEnding = d.boss?.kind === 'deck' && d.activePlayer === bossSeat(d)
  if (!skipped) for (const seat of ending) endTurnFor(d, seat, ev)

  advanceSeat(d)
  // Эксперт: первый ход босса считается за два. Босс со сценарием играет их
  // одним ходом из двух BOSS_TURN, но колодный босс играет руку, а не список
  // эффектов, — его второй ход выдаётся здесь, возвратом хода тому же месту.
  if (bossEnding && d.boss?.headStart) {
    d.boss.headStart = false
    d.activePlayer = bossSeat(d)
  }
  d.turn += 1

  const b = d.boss
  // Difficulty: the boss sits out its first turns entirely.
  //
  // Two things about where this sits. It belongs to the LEVEL, not to the kind
  // of boss: living inside the script branch below meant the four deck bosses
  // answered the player's opening turn even on Beginner, where the player is
  // owed three turns first -- and nothing looked wrong at setup, because
  // `graceTurns` was counted correctly and merely never read.
  //
  // And it comes BEFORE the turn starts, so a skipped turn really is skipped:
  // the boss neither draws a hand nor announces a turn it does not take.
  if (b && b.graceTurns > 0 && d.activePlayer === bossSeat(d)) {
    b.graceTurns -= 1
    ev.push({ e: 'TURN_SKIPPED', player: d.activePlayer, turn: d.turn })
    endTurn(d, ev, true)
    return
  }

  for (const seat of turnSeats(d, d.activePlayer)) startTurnFor(d, seat, ev)

  ev.push({ e: 'TURN_START', player: d.activePlayer, turn: d.turn })

  // A SURVIVE objective is decided by the clock, so the clock has to be read
  // where it advances.
  checkWin(d, ev)
  if (d.winner) return

  // A script boss has no hand to play, so its whole turn is pushed onto the
  // resolution stack here. Anything in it that asks the player something simply
  // suspends until they answer -- the boss does not need a driver loop.
  if (b && b.kind === 'script' && d.activePlayer === bossSeat(d)) {
    const turns: Effect[] = b.headStart
      ? [{ k: 'BOSS_TURN' }, { k: 'BOSS_TURN' }]
      : [{ k: 'BOSS_TURN' }]
    b.headStart = false
    b.acting = true
    pushEffects(d, [...turns, { k: 'BOSS_END_TURN' }], BOSS_CTX(d))
  }
}


// ═══════════════════════════ Frontiers Challenges ═══════════════════════════
//
// Everything below implements the rulebook's Challenge rules for a solo game.
// The boss's turn is a list of effects rather than a loop, so a step that asks
// the player something suspends the boss and resumes when they answer.

const BOSS_CTX = (d: D): EffectCtx =>
  ({ controller: bossSeat(d), source: null, slot: 'primary' })

const isStarter = (def: CardDefId): boolean => def === SCOUT || def === VIPER

function bossSeat(d: D): PlayerId {
  // Solo: the player is p1 and the boss p2. The scenario's hero is the player.
  return d.bossSeat ?? (d.scenario ? opponentOf(d.scenario.hero) : 'p2')
}

/** The card furthest from the trade deck: rulebook language for the last slot. */
function farthestRowIndex(d: D): number {
  for (let i = d.tradeRow.length - 1; i >= 0; i--) if (d.tradeRow[i]) return i
  return -1
}

/** Take the far card and slide the row down, as the challenges describe. */
function takeFarthest(d: D): CardInstance | null {
  const i = farthestRowIndex(d)
  if (i < 0) return null
  const card = d.tradeRow[i] as CardInstance
  d.tradeRow[i] = null
  return card
}

/**
 * Fleeting Opportunities, printed in full: "scrap the card furthest from the
 * trade deck, slide all the cards in the trade row over one space, then add the
 * top card of the trade deck to the trade row".
 *
 * The slide is the whole scenario, and it is easy to drop. Scrapping the far
 * card and simply refilling looks right for one turn and is wrong for the game:
 * the refill lands back in the slot just vacated, so the SAME slot is eaten
 * every turn and the other four cards stand there for the rest of the match.
 * With the slide, every card walks the row and leaves after five turns, which
 * is the pressure the card exists to create.
 */
function slideTradeRow(d: D, ev: GameEvent[]): void {
  const gone = takeFarthest(d)
  if (gone) toScrapHeap(d, gone, 'tradeRow', null, ev)
  // Bought cards leave holes; the survivors close them up as they slide, and
  // the near end of the row is what the refill below fills from the deck.
  const width = TRADE_ROW_SIZE + d.extraRowSlots
  const rest = d.tradeRow.filter((c): c is CardInstance => c !== null)
  d.tradeRow = Array.from({ length: width }, (_, i) => {
    const from = i - (width - rest.length)
    return from >= 0 ? (rest[from] as CardInstance) : null
  })
  refillTradeRow(d, ev)
}

/**
 * Boss Attacks, verbatim from the rulebook (page 24): for each attack, make the
 * first possible attack from the list, spending the minimum combat needed, and
 * repeat until no combat remains.
 *
 *   1. defeat a player outright if possible -- the one with the HIGHEST
 *      Authority that it can defeat
 *   2. the highest-defense outpost it can destroy (ties: highest cost)
 *   3. the highest-defense non-outpost base it can destroy (ties: highest cost)
 *   4. attack the player with the LOWEST Authority
 *
 * "If tied, it attacks one of them at random" -- and random here means the
 * seeded stream inside the state, not Math.random, so the same replay still
 * produces the same attacks.
 *
 * A side is a GROUP of seats, not a seat: a Hydra team shares one Authority
 * score and one Outpost shield, so the boss aims at the team. In the other
 * co-op modes and in a duel every group is a single player, and this collapses
 * back to what it was.
 */
function bossAttacks(d: D, ev: GameEvent[]): void {
  const me = bossSeat(d)
  const boss = d.players[me]
  let guard = 0

  /** Ties are broken from the seeded stream, exactly as the rulebook says. */
  const atRandom = <T,>(xs: readonly T[]): T => {
    if (xs.length === 1) return xs[0] as T
    let i: number
    ;[i, d.rng] = nextInt(d.rng, xs.length) as [number, typeof d.rng]
    return xs[i] as T
  }

  while (boss.combat > 0 && guard++ < 64) {
    const state = d as unknown as GameState
    const groups = foeGroups(state, me).filter((g) => g.length > 0)
    const scoreOf = (g: readonly PlayerId[]): number =>
      d.players[holder(d, g[0] as PlayerId)].authority
    // A shielded side cannot be hit in the face at all, by the boss or anyone.
    const open = groups.filter((g) => canAttackFace(state, me, g[0] as PlayerId))

    // 1. A killing blow beats everything else, aimed at the biggest score it
    //    can still finish off.
    const killable = open.filter((g) => scoreOf(g) > 0 && boss.combat >= scoreOf(g))
    if (killable.length > 0) {
      const best = Math.max(...killable.map(scoreOf))
      const g = atRandom(killable.filter((x) => scoreOf(x) === best))
      const victim = g[0] as PlayerId
      const n = scoreOf(g)
      boss.combat -= n
      loseAuthority(d, victim, n, ev)
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target: victim, n })
      return
    }

    const targets = legalAttackTargets(state, me)
      .map((c) => ({ c, def: cardDef(c.def).defense ?? 0, cost: cardDef(c.def).cost, out: isOutpost(c) }))
      .filter((t) => t.def <= boss.combat)

    const pick = (outposts: boolean): typeof targets[number] | undefined => {
      const pool = targets.filter((t) => t.out === outposts)
      if (pool.length === 0) return undefined
      const topDef = Math.max(...pool.map((t) => t.def))
      const byDef = pool.filter((t) => t.def === topDef)
      const topCost = Math.max(...byDef.map((t) => t.cost))
      return atRandom(byDef.filter((t) => t.cost === topCost))
    }

    // 2 and 3: outposts first, then plain bases.
    const target = pick(true) ?? pick(false)
    if (target) {
      boss.combat -= target.def
      const owner = findInPlay(state, target.c.iid)?.owner
      if (owner) destroyBase(d, owner, target.c, 'combat', ev, me)
      continue
    }

    // 4. Whatever is left goes to the smallest score still reachable.
    if (open.length > 0) {
      const worst = Math.min(...open.map(scoreOf))
      const g = atRandom(open.filter((x) => scoreOf(x) === worst))
      const victim = g[0] as PlayerId
      const n = boss.combat
      boss.combat = 0
      loseAuthority(d, victim, n, ev)
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target: victim, n })
      return
    }

    // Outposts stand and nothing is affordable: the combat is simply wasted.
    return
  }
}

/**
 * Automatons, from the challenge card:
 *
 *   "On its turn, the Boss plays the top card of the trade deck. Then, if the
 *    total cost of the cards it played that turn is lower than the Assimilation
 *    Count, it plays the next card off the top of the trade deck. It will
 *    continue this process until the total cost of the cards played is equal to
 *    or greater than the Assimilation Count. After the Boss attacks, add 1 to
 *    the Assimilation Count."
 *
 * The cards are PLAYED, so their primaries resolve for the boss -- which is why
 * this pushes them through the normal play path rather than dropping them into
 * play. The count going up after the attack is what makes each turn heavier
 * than the last.
 */
function automatonsStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  let spent = 0
  let guard = 0
  do {
    const next = d.tradeDeck.shift()
    if (!next) break
    spent += cardDef(next.def).cost
    playCardFor(d, me, next, ev, ctx)
  } while (spent < b.assimilation && guard++ < 40)
}

/** Puts a card into play for a side and resolves what playing it does. */
function playCardFor(d: D, pid: PlayerId, inst: CardInstance, ev: GameEvent[], ctx: EffectCtx): void {
  const p = d.players[pid]
  const def = cardDef(inst.def)
  p.inPlay.push({
    iid: inst.iid, def: inst.def, copiedDef: null, chosenFaction: null,
    used: {
      primary: false, ally: false, ally2: false, ally3: false, ally4: false,
      doubleAlly: false, scrap: false, splinter: false,
    },
    playedThisTurn: true,
  })
  ev.push({ e: 'PLAY_CARD', player: pid, iid: inst.iid, def: inst.def })
  if (def.type === 'ship') {
    p.shipsPlayedThisTurn.push({ iid: inst.iid, def: inst.def })
    p.factionPlayedThisTurn[def.faction] += 1
    pushEffects(d, def.primary, { ...ctx, controller: pid, source: inst.iid })
  }
  recomputeAlly(d, pid, ev)
}

/**
 * Nemesis Beast: scrap the far card face down, gain combat equal to the pile,
 * then gain an ability decided by the faction of the card that replaces it.
 *
 * The scrap-and-count half is the rulebook's. The faction table is ours: the
 * printed one exists only on the Challenge Card. It follows the published
 * description of what the beast does -- wreck your hand, blow up your bases,
 * spoil your draws, or simply grow.
 */
function nemesisStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  const card = takeFarthest(d)
  if (card) {
    b.facedown.push({ iid: card.iid, def: card.def })
    ev.push({ e: 'SCRAP', owner: null, iid: card.iid, def: card.def, from: 'tradeRow' })
  }
  gain(d, me, 'combat', b.facedown.length, ev)

  refillTradeRow(d, ev)
  const revealed = d.tradeRow[farthestRowIndex(d)] ?? d.tradeRow.find((c) => c !== null)
  const faction = revealed ? cardDef(revealed.def).faction : 'unaligned'
  pushEffects(d, nemesisAbility(faction), ctx)
}

/**
 * The Nemesis Beast's faction table, exactly as printed on the challenge card.
 *
 *   yellow -- Each player discards two cards.
 *   green  -- For each player, the Boss destroys target base or gains 3 combat.
 *   red    -- Each player puts a random card in their hand on top of their deck.
 *   blue   -- For each player, the Boss gains 5 authority.
 *
 * Every entry is per PLAYER, and the card back is explicit that the green one
 * counts players rather than bases: "if in a three player game, one player had
 * two bases in play, and the other players had none, the Boss would destroy
 * both bases and gain 3 Combat." EACH_FOE is exactly that repetition, and at
 * one player it collapses to what this always did.
 */
function nemesisAbility(faction: Faction): Effect[] {
  const each = (then: Effect[]): Effect[] => [{ k: 'EACH_FOE', then }]
  switch (faction) {
    case 'star_empire': return each([{ k: 'OPPONENT_DISCARD', n: 2 }])
    case 'blob': return each([{ k: 'DESTROY_BASE_OR_COMBAT', n: 3 }])
    case 'machine_cult': return each([{ k: 'TOPDECK_RANDOM_FROM_HAND', n: 1 }])
    case 'trade_federation': return each([{ k: 'GAIN_AUTHORITY', n: 5 }])
    default: return []
  }
}

/**
 * The Dimensional Horror's faction table, as printed:
 *
 *   yellow -- You discard two cards.
 *   green  -- The Boss gains 3 combat.
 *   red    -- Put a Scout or Viper from your hand or discard pile on top of
 *             your deck.
 *   blue   -- The Boss destroys all of your bases.
 */
function horrorAbility(faction: Faction): Effect[] {
  switch (faction) {
    case 'star_empire': return [{ k: 'OPPONENT_DISCARD', n: 2 }]
    case 'blob': return [{ k: 'GAIN_COMBAT', n: 3 }]
    case 'machine_cult': return [{ k: 'TOPDECK_STARTER', n: 1 }]
    case 'trade_federation': return [{ k: 'DESTROY_ALL_ENEMY_BASES' }]
    default: return []
  }
}

/**
 * The Pirates' table keys off the revealed card's faction AND cost:
 *
 *   yellow -- attacks with 2x the cost; that player discards two cards
 *   green  -- attacks with 3x the cost
 *   red    -- attacks with 2x the cost of the highest-cost card
 *   blue   -- attacks with, and gains authority equal to, 2x the cost
 */
function pirateAbility(faction: Faction, cost: number, highest: number): Effect[] {
  switch (faction) {
    case 'star_empire':
      return [{ k: 'GAIN_COMBAT', n: 2 * cost }, { k: 'OPPONENT_DISCARD', n: 2 }]
    case 'blob': return [{ k: 'GAIN_COMBAT', n: 3 * cost }]
    case 'machine_cult': return [{ k: 'GAIN_COMBAT', n: 2 * highest }]
    case 'trade_federation':
      return [{ k: 'GAIN_COMBAT', n: 2 * cost }, { k: 'GAIN_AUTHORITY', n: 2 * cost }]
    default: return []
  }
}

/**
 * Dimensional Horror, per its challenge card:
 *
 *   1. take the trade row card furthest from the deck into its own colour's
 *      tentacle;
 *   2. refill the row, and any replacement of that same colour is swallowed too;
 *   3. the boss gains the ability of the colour it fed, once, however many
 *      cards went in;
 *   4. it gains combat equal to the number of cards in the LONGEST tentacle;
 *   5. it attacks.
 *
 * A card that is not a single faction is scrapped and replaced from the top of
 * the trade deck instead of being swallowed, per the card's special rules.
 */
function horrorStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  const b = d.boss
  if (!b) return
  const me = bossSeat(d)
  const card = takeFarthest(d)
  let fed: Faction | null = null
  if (card) {
    const f = cardDef(card.def).faction
    if (f === 'unaligned') {
      // Not a single faction: scrap it and feed the trade deck's top card.
      toScrapHeap(d, card, 'tradeRow', null, ev)
      const sub = d.tradeDeck.shift()
      if (sub) {
        fed = cardDef(sub.def).faction
        if (fed === 'unaligned') { toScrapHeap(d, sub, 'tradeRow', null, ev); fed = null }
        else {
          b.tentacles[fed].push({ iid: sub.iid, def: sub.def })
          b.tentaclesEverFed = true
          ev.push({ e: 'TENTACLE_FED', faction: fed, def: sub.def })
        }
      }
    } else {
      fed = f
      b.tentacles[f].push({ iid: card.iid, def: card.def })
      b.tentaclesEverFed = true
      ev.push({ e: 'TENTACLE_FED', faction: f, def: card.def })
    }
  }

  // Refill; a replacement of the fed colour goes straight into the tentacle.
  let guard = 0
  while (d.tradeRow.some((c) => c === null) && d.tradeDeck.length > 0 && guard++ < 20) {
    const next = d.tradeDeck.shift()
    if (!next) break
    if (fed && cardDef(next.def).faction === fed) {
      b.tentacles[fed].push({ iid: next.iid, def: next.def })
      b.tentaclesEverFed = true
      ev.push({ e: 'TENTACLE_FED', faction: fed, def: next.def })
      continue
    }
    const slot = d.tradeRow.findIndex((c) => c === null)
    if (slot < 0) break
    d.tradeRow[slot] = next
    ev.push({ e: 'TRADE_ROW_REFILL', slot, def: next.def })
  }

  // "It gains the ability only once regardless of the number of cards added."
  if (fed) pushEffects(d, horrorAbility(fed), ctx)
  gain(d, me, 'combat', longestTentacle(d), ev)
}

function longestTentacle(d: D): number {
  const b = d.boss
  if (!b) return 0
  return Math.max(0, ...TENTACLE_FACTIONS.map((f) => b.tentacles[f].length))
}

/**
 * Pirates of the Dark Star, per its challenge card: scrap the far trade row
 * card, reveal its replacement, and the replacement's faction and cost decide
 * what is done to you. The raid IS the attack, so the combat it gains is spent
 * by the ordinary boss attack that follows.
 */
function pirateStep(d: D, ev: GameEvent[], ctx: EffectCtx): void {
  // "For each player remaining in the game, scrap one card in the Trade Row
  // furthest from the Trade Deck ... The faction and cost of the first card
  // revealed determines what the Boss does to the first player. The second card
  // revealed determines what the Boss does to the second player, and so on."
  const victims = allFoesOf(d as unknown as GameState, bossSeat(d))
  const revealed: (CardInstance | null)[] = []
  for (let i = 0; i < victims.length; i++) {
    const card = takeFarthest(d)
    if (card) toScrapHeap(d, card, 'tradeRow', null, ev)
    refillTradeRow(d, ev)
    revealed.push(d.tradeRow[farthestRowIndex(d)] ?? d.tradeRow.find((c) => c !== null) ?? null)
  }
  // "2x the cost of the highest-cost card" -- of the trade row, which is the
  // only set of cards the challenge has in front of it.
  const highest = Math.max(0, ...d.tradeRow.filter((c) => c !== null)
    .map((c) => cardDef((c as CardInstance).def).cost))
  // Reverse, so the LIFO stack still deals with the players in seat order.
  for (let i = victims.length - 1; i >= 0; i--) {
    const card = revealed[i]
    const victim = victims[i] as PlayerId
    if (!card) continue
    const def = cardDef(card.def)
    pushEffects(d, pirateAbility(def.faction, def.cost, highest), { ...ctx, target: victim })
  }
}

/** The Order of Play for whichever boss is in the game. */
function bossOrderOfPlay(d: D): Effect[] {
  const b = d.boss
  if (!b) return []
  switch (b.id) {
    case 'automatons':
      // "After the Boss attacks, add 1 to the Assimilation Count."
      return [{ k: 'BOSS_ASSIMILATE' }, { k: 'BOSS_ATTACK' }, { k: 'BOSS_GROW' }]
    case 'nemesis-beast':
      return [{ k: 'BOSS_NEMESIS_STEP' }, { k: 'BOSS_ATTACK' }]
    case 'dimensional-horror':
      return [{ k: 'BOSS_HORROR_STEP' }, { k: 'BOSS_ATTACK' }]
    case 'pirates-of-the-dark-star':
      // The pirates' raid IS their attack: steps 1-5 with no separate attack.
      return [{ k: 'BOSS_PIRATE_STEP' }, { k: 'BOSS_ATTACK' }]
    default:
      // Deck bosses take an ordinary turn; nothing to script.
      return []
  }
}

function applyAction(d: D, cmd: Command, ev: GameEvent[]): void {
  const { actor, action } = cmd
  const me = actor

  switch (action.t) {
    case 'PLAY_CARD': return playCard(d, me, action.card, ev)

    case 'PLAY_ALL': {
      // Play ships until one of them needs a decision; the player finishes the
      // rest manually after resolving it.
      for (;;) {
        if (d.resolution.length > 0) return
        const next = d.players[me].hand.find((c) => cardDef(c.def).type === 'ship')
        if (!next) return
        playCard(d, me, next.iid, ev)
        settle(d, ev)
        if (d.phase === 'gameOver') return
      }
    }

    case 'ACTIVATE': return activate(d, me, action.card, action.slot, ev)
    case 'BUY_CARD': return buyFromRow(d, me, action.card, ev)
    case 'BUY_EXPLORER': return buyExplorer(d, me, ev)

    case 'ATTACK_PLAYER': {
      const p = d.players[me]
      const target = foeOf(d as unknown as GameState, me)
      if (!canAttackFace(d as unknown as GameState, me, target)) {
        throw new IllegalActionError('opponent has an outpost in play')
      }
      if (action.amount < 1 || action.amount > p.combat) throw new IllegalActionError('invalid combat amount')
      p.combat -= action.amount
      // Energy Shield reduces damage to the PLAYER, not to their bases, so the
      // reduction lives here and not in the base-attack path.
      const shield = shieldOf(d, target)
      const dealt = Math.max(0, action.amount - shield)
      loseAuthority(d, target, dealt, ev)
      // Counted here rather than in loseAuthority, which knows the victim but
      // not who did it -- and fires for cards that hurt their own owner.
      d.tally[me].dmg += dealt
      ev.push({ e: 'ATTACK_PLAYER', attacker: me, target, n: dealt })
      return
    }

    case 'REVEAL_GAMBIT': {
      const p = d.players[me]
      const idx = p.gambits.findIndex((c) => c.iid === action.card)
      if (idx < 0) throw new IllegalActionError('not one of your gambits')
      const inst = p.gambits.splice(idx, 1)[0] as CardInstance
      const def = cardDef(inst.def)
      ev.push({ e: 'GAMBIT_REVEALED', player: me, iid: inst.iid, def: inst.def })
      // An ongoing gambit stays face up and keeps applying; a one-shot pays out
      // and is gone. Which it is, is whether it has a scrap ability -- the
      // printed trash icon.
      if (def.scrap.length > 0) {
        d.scrapHeap.push(inst)
      } else {
        p.gambitsInPlay.push({
          iid: inst.iid, def: inst.def, copiedDef: null, chosenFaction: null,
          used: {
            primary: false, ally: false, ally2: false, ally3: false, ally4: false,
            doubleAlly: false, scrap: false, splinter: false,
          },
          playedThisTurn: false,
        } as Draft<InPlayCard>)
      }
      const onReveal = def.onReveal ?? []
      const body = def.scrap.length > 0 ? def.scrap : []
      if (onReveal.length + body.length > 0) {
        pushEffects(d, [...onReveal, ...body], { controller: me, source: inst.iid, slot: 'scrap' })
      }
      return
    }

    case 'CLAIM_MISSION': {
      const p = d.players[me]
      const idx = p.missions.findIndex((c) => c.iid === action.card)
      if (idx < 0) throw new IllegalActionError('not one of your missions')
      const inst = p.missions[idx] as CardInstance
      const def = cardDef(inst.def)
      if (!def.objective || !objectiveMet(p, def.objective)) {
        throw new IllegalActionError('objective not met')
      }
      p.missions.splice(idx, 1)
      p.missionsDone.push(inst.def)
      ev.push({ e: 'MISSION_COMPLETE', player: me, def: inst.def })
      pushEffects(d, def.primary, { controller: me, source: inst.iid, slot: 'primary' })
      return
    }

    case 'ATTACK_BASE': {
      const p = d.players[me]
      const targets = legalAttackTargets(d as unknown as GameState, me)
      const target = targets.find((c) => c.iid === action.base)
      if (!target) throw new IllegalActionError('not a legal base target')
      const owner = findInPlay(d as unknown as GameState, target.iid)?.owner as PlayerId
      const defense = defenseOf(d as unknown as GameState, owner, cardDef(target.def).defense ?? 0)
      if (p.combat < defense) throw new IllegalActionError('not enough combat')
      // Spend EXACTLY the defense value; the remainder stays in the pool.
      p.combat -= defense
      destroyBase(d, owner, target, 'combat', ev, me)
      return
    }

    case 'RESOLVE_CHOICE': {
      const top = d.resolution[0]
      if (!top || top.f !== 'choice') throw new IllegalActionError('no choice is pending')
      const choice = top.choice as PendingChoice
      if (choice.id !== action.choiceId) throw new IllegalActionError('stale choice id')
      if (choice.actor !== me) throw new IllegalActionError('not your choice to make')
      const sel = action.selected
      if (sel.length < choice.min || sel.length > choice.max) {
        throw new IllegalActionError(`select between ${choice.min} and ${choice.max}`)
      }
      for (const o of sel) {
        if (!choice.options.some((x) => sameOption(x, o))) throw new IllegalActionError('illegal option')
      }
      for (let i = 0; i < sel.length; i++) {
        for (let j = i + 1; j < sel.length; j++) {
          if (sameOption(sel[i] as ChoiceOption, sel[j] as ChoiceOption)) {
            throw new IllegalActionError('duplicate selection')
          }
        }
      }
      const frame = d.resolution.shift() as unknown as ChoiceFrame
      resolveChoice(d, frame, sel, ev)
      return
    }

    case 'MULLIGAN_ROW': {
      // Rulebook: once per challenge, a player may scrap the entire trade row.
      const b = d.boss
      if (!b) throw new IllegalActionError('the mulligan is a challenge rule')
      if (b.mulliganUsed) throw new IllegalActionError('the trade row has already been mulliganed')
      b.mulliganUsed = true
      for (let i = 0; i < d.tradeRow.length; i++) {
        const c = d.tradeRow[i]
        if (!c) continue
        d.tradeRow[i] = null
        d.scrapHeap.push({ iid: c.iid, def: c.def })
        ev.push({ e: 'SCRAP', owner: null, iid: c.iid, def: c.def, from: 'tradeRow' })
      }
      refillTradeRow(d, ev)
      return
    }

    case 'ATTACK_TENTACLE': {
      // "Players may destroy cards in a tentacle by spending Combat equal to
      // that card's cost." One card at a time, any number of attacks per turn.
      const b = d.boss
      if (!b || b.id !== 'dimensional-horror') throw new IllegalActionError('no tentacles to attack')
      const pile = b.tentacles[action.faction]
      const idx = pile.findIndex((c) => c.iid === action.card)
      if (idx < 0) throw new IllegalActionError('that card is not in that tentacle')
      const inst = pile[idx] as CardInstance
      const cost = cardDef(inst.def).cost
      const attacker = d.players[me]
      if (attacker.combat < cost) throw new IllegalActionError('not enough combat')
      attacker.combat -= cost
      pile.splice(idx, 1)
      toScrapHeap(d, inst, 'tradeRow', null, ev)
      ev.push({ e: 'TENTACLE_HIT', faction: action.faction, def: inst.def, cost })
      return
    }

    case 'TRANSFER': {
      const c = d.coop
      if (!c || c.mode === 'individual') {
        throw new IllegalActionError('there is no pool to transfer into')
      }
      if (action.to === me || !c.players.includes(action.to)) {
        throw new IllegalActionError('not a teammate')
      }
      if (c.eliminated.includes(action.to)) throw new IllegalActionError('that player is out')
      const from = d.players[me]
      if (action.n < 1 || action.n > from[action.what]) {
        throw new IllegalActionError('not that much to give')
      }
      from[action.what] -= action.n
      d.players[action.to][action.what] += action.n
      ev.push({ e: 'TRANSFER', from: me, to: action.to, what: action.what, n: action.n })
      return
    }

    case 'TAKE_WAGER': {
      const p = d.players[me]
      if (!d.scenario?.wagers) throw new IllegalActionError('no wagers in this game')
      if (p.wager) throw new IllegalActionError('a wager is already on the table')
      if (d.activePlayer !== me) throw new IllegalActionError('not your turn')
      const w = wagerFor(d.matchId, d.turn, me)
      // Ставку нельзя взять уже выполненной: пари — обещание доиграть ход, а
      // не награда за то, что уже сделано.
      if (wagerProgress(w, wagerSourceOf(d.tally[me], p as unknown as PlayerState)).met) {
        throw new IllegalActionError('that turn has already happened')
      }
      // Цена платится вперёд, и заплатить её насмерть нельзя: авторитета должно
      // остаться хотя бы очко, иначе пари было бы способом проиграть бой.
      if (p.authority <= WAGER_PRICE) throw new IllegalActionError('not enough authority')
      loseAuthority(d, me, WAGER_PRICE, ev)
      p.wager = { id: w.id, turn: d.turn, won: false }
      ev.push({ e: 'WAGER_TAKEN', player: me, id: w.id })
      return
    }

    case 'END_TURN': {
      if (d.resolution.length > 0) throw new IllegalActionError('resolve the pending choice first')
      if (d.boss?.acting) throw new IllegalActionError('the boss is still acting')
      return endTurn(d, ev)
    }
  }
}

/**
 * Apply one command. The ONLY way state changes.
 *
 * Throws IllegalActionError rather than returning a result type so that an
 * illegal command can never be mistaken for a legal no-op by a caller that
 * forgot to check.
 */
export function reduce(state: GameState, cmd: Command): ReduceResult {
  const events: GameEvent[] = []
  const next = produce(state, (d: D) => {
    if (d.phase === 'gameOver') throw new IllegalActionError('the game is over')
    // Input ownership, not turn ownership: a forced discard is answered by the
    // non-active player.
    // Several seats may be legal actors at once: a co-op team shares one turn.
    const expected = actorsOf(d as unknown as GameState)
    if (!expected.includes(cmd.actor)) {
      throw new IllegalActionError(`it is ${expected.join('/')}'s turn to act`)
    }
    applyAction(d, cmd, events)
    settle(d, events)
    d.version += 1
  })
  return { state: next, events }
}

export type { Action }
