import { describe, expect, it } from 'vitest'
import { asDefId } from '../src/ids'
import { IllegalActionError, reduce } from '../src/reduce'
import {
  byBranch, byDef, choose, chooseMany, decline, handIid, inPlay, legalFor,
  pending, playIid, rowIid, run, scenario,
} from './scenario'

const D = asDefId

describe('1. triggered abilities (Fleet HQ)', () => {
  it('fires once per ship played, unbounded per turn', () => {
    const s = scenario({ me: { hand: ['scout', 'scout', 'viper'], inPlay: [inPlay('fleet-hq')] } })
    const { state } = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'scout') },
      { t: 'PLAY_CARD', card: s.players.p1.hand[1]!.iid },
      { t: 'PLAY_CARD', card: s.players.p1.hand[2]!.iid },
    )
    // 3 ships played -> 3 combat from Fleet HQ, plus Viper's own 1 combat.
    expect(state.players.p1.combat).toBe(4)
    expect(state.players.p1.trade).toBe(2)
  })

  it('does not fire when a base is played', () => {
    const s = scenario({ me: { hand: ['blob-wheel'], inPlay: [inPlay('fleet-hq')] } })
    const { state } = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-wheel') })
    expect(state.players.p1.combat).toBe(0)
  })

  it('has no activatable primary', () => {
    const s = scenario({ me: { inPlay: [inPlay('fleet-hq')] } })
    expect(legalFor(s, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'primary')).toBe(false)
  })
})

describe('2. acquisition routing (topdeck effects)', () => {
  it('offers to top-deck the next acquired ship and stacks', () => {
    const s = scenario({
      me: { hand: ['freighter', 'federation-shuttle'], trade: 0 },
      tradeRow: ['ram', 'cutter', 'scout', 'viper', 'explorer'],
    })
    // Freighter + Shuttle both TF -> ally unlocked; Freighter's ally arms a topdeck.
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'freighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'federation-shuttle') },
    ).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'freighter'), slot: 'ally' }).state
    expect(st.players.p1.pendingRedirects).toHaveLength(1)

    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'ram') }).state
    expect(pending(st)?.prompt).toBe('REDIRECT_ACQUIRED')
    st = run(st, choose(st, byBranch(0))).state
    expect(st.players.p1.deck[0]?.def).toBe(D('ram'))
    expect(st.players.p1.pendingRedirects).toHaveLength(0)
  })

  it('lets the player decline, leaving the card in the discard pile', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('central-office')], trade: 5 },
      tradeRow: ['ram', 'cutter', 'scout', 'viper', 'explorer'],
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'central-office'), slot: 'primary' }).state
    st = run(st, { t: 'BUY_CARD', card: rowIid(st, 'ram') }).state
    st = run(st, decline(st)).state
    expect(st.players.p1.discard.some((c) => c.def === D('ram'))).toBe(true)
    expect(st.players.p1.deck[0]?.def).not.toBe(D('ram'))
  })

  it('Blob Carrier top-decks mandatorily, with no prompt to decline', () => {
    const s = scenario({
      me: { hand: ['blob-carrier', 'blob-fighter'] },
      tradeRow: ['mothership', 'blob-wheel', 'scout', 'viper', 'explorer'],
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-carrier') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
    ).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-carrier'), slot: 'ally' }).state
    expect(pending(st)?.prompt).toBe('ACQUIRE_FREE')
    // Blob Wheel is a base, so it is not a legal "any ship" target.
    const opts = st.resolution[0]!.f === 'choice' ? st.resolution[0]!.choice.options : []
    expect(opts.some((o) => o.o === 'CARD' && o.def === D('blob-wheel'))).toBe(false)
    st = run(st, choose(st, byDef('mothership'))).state
    expect(st.players.p1.deck[0]?.def).toBe(D('mothership'))
  })
})

describe('3. partial resolution -- do as much as you can', () => {
  it('fizzles a mandatory destroy with no legal target instead of deadlocking', () => {
    const s = scenario({ me: { hand: ['command-ship', 'cutter'] }, them: { inPlay: [] } })
    const { state } = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'command-ship') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'cutter') },
    )
    const st = run(state, { t: 'ACTIVATE', card: playIid(state, 'p1', 'command-ship'), slot: 'ally' }).state
    expect(pending(st)).toBeNull()
    expect(st.resolution).toHaveLength(0)
  })

  it('fizzles a forced discard against an empty hand', () => {
    const s = scenario({ me: { hand: ['imperial-fighter'] }, them: { hand: [] } })
    const { state, events } = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'imperial-fighter') })
    expect(state.players.p1.combat).toBe(2)
    expect(events.some((e) => e.e === 'FIZZLE')).toBe(true)
    expect(pending(state)).toBeNull()
  })
})

describe('4. forced discard resolves immediately, and the victim chooses', () => {
  it('hands input ownership to the non-active player', () => {
    const s = scenario({ me: { hand: ['imperial-fighter'] }, them: { hand: ['scout', 'viper', 'ram'] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'imperial-fighter') }).state
    const p = pending(st)
    expect(p?.prompt).toBe('DISCARD')
    expect(p?.actor).toBe('p2')          // the VICTIM chooses, not the attacker
    expect(st.activePlayer).toBe('p1')   // but it is still p1's turn
    // p1 has no legal action while p2 owes an answer.
    expect(legalFor(st, 'p1')).toEqual([])
    expect(legalFor(st, 'p2').length).toBeGreaterThan(0)
  })

  it('refuses the attacker answering on the victim\'s behalf', () => {
    const s = scenario({ me: { hand: ['imperial-fighter'] }, them: { hand: ['scout', 'viper'] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'imperial-fighter') }).state
    const action = choose(st, byDef('scout'))
    expect(() => run(st, action)).not.toThrow() // as p2 (run uses the real actor)
    expect(() => reduce(st, { actor: 'p1', action })).toThrow(IllegalActionError)
  })
})

describe('5-6. ally abilities: retroactive, order-independent, and sticky', () => {
  it('unlocks the first card\'s ally when the second is played later', () => {
    const s = scenario({ me: { hand: ['blob-fighter', 'ram'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') }).state
    expect(st.players.p1.allyUnlocked).not.toContain('blob')
    st = run(st, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'ram') }).state
    expect(st.players.p1.allyUnlocked).toContain('blob')
    // The card played FIRST can now use its ally ability.
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-fighter'), slot: 'ally' }).state
    expect(st.players.p1.hand.length).toBe(1) // drew a card
  })

  it('keeps the ally available after the enabling card is scrapped away', () => {
    const s = scenario({ me: { hand: ['blob-fighter', 'ram'] } })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'ram') },
    ).state
    // Scrap Ram for trade -- the only other Blob card leaves play.
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'ram'), slot: 'scrap' }).state
    expect(st.players.p1.inPlay.some((c) => c.def === D('ram'))).toBe(false)
    // Blob stays unlocked: the rulebook is trigger-then-use.
    expect(st.players.p1.allyUnlocked).toContain('blob')
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'ally')).toBe(true)
  })

  it('resets ally unlocks at end of turn', () => {
    const s = scenario({ me: { hand: ['blob-fighter', 'ram'], deck: ['scout', 'scout', 'scout', 'scout', 'scout'] } })
    const st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'ram') },
      { t: 'END_TURN' },
    ).state
    expect(st.players.p1.allyUnlocked).toEqual([])
    expect(st.players.p1.factionPlayedThisTurn.blob).toBe(0)
  })
})

describe('7-8. outpost shield and destroy-target-base', () => {
  it('blocks attacking the player and non-outpost bases while an outpost stands', () => {
    const s = scenario({
      me: { combat: 20 },
      them: { inPlay: [inPlay('battle-station'), inPlay('blob-wheel')] },
    })
    const legal = legalFor(s, 'p1')
    expect(legal.some((a) => a.t === 'ATTACK_PLAYER')).toBe(false)
    const attackable = legal.filter((a) => a.t === 'ATTACK_BASE').map((a) => a.base)
    expect(attackable).toContain(playIid(s, 'p2', 'battle-station'))
    expect(attackable).not.toContain(playIid(s, 'p2', 'blob-wheel'))
  })

  it('shields non-outpost bases from a free destroy effect too', () => {
    const s = scenario({
      me: { hand: ['missile-mech'] },
      them: { inPlay: [inPlay('battle-station'), inPlay('blob-wheel')] },
    })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'missile-mech') }).state
    const opts = st.resolution[0]!.f === 'choice' ? st.resolution[0]!.choice.options : []
    const defs = opts.filter((o) => o.o === 'CARD').map((o) => o.def)
    expect(defs).toContain(D('battle-station'))
    expect(defs).not.toContain(D('blob-wheel'))
  })

  it('allows targeting your OWN base, per the physical rules', () => {
    const s = scenario({
      me: { hand: ['missile-mech'], inPlay: [inPlay('blob-wheel')] },
      them: { inPlay: [] },
    })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'missile-mech') }).state
    const opts = st.resolution[0]!.f === 'choice' ? st.resolution[0]!.choice.options : []
    expect(opts.some((o) => o.o === 'CARD' && o.def === D('blob-wheel'))).toBe(true)
  })

  it('spends exactly the defense value and returns the base to its owner\'s discard', () => {
    const s = scenario({ me: { combat: 10 }, them: { inPlay: [inPlay('blob-wheel')] } })
    const st = run(s, { t: 'ATTACK_BASE', base: playIid(s, 'p2', 'blob-wheel') }).state
    expect(st.players.p1.combat).toBe(5)                       // 10 - 5 defense
    expect(st.players.p2.discard.some((c) => c.def === D('blob-wheel'))).toBe(true)
    expect(st.scrapHeap.some((c) => c.def === D('blob-wheel'))).toBe(false)
  })
})

describe('9. optionality is not uniform', () => {
  it('makes Trade Bot\'s scrap optional but Junkyard\'s mandatory', () => {
    const s1 = scenario({ me: { hand: ['trade-bot'], discard: ['scout'] } })
    const st1 = run(s1, { t: 'PLAY_CARD', card: handIid(s1, 'p1', 'trade-bot') }).state
    expect(pending(st1)?.min).toBe(0) // "You may scrap"

    const s2 = scenario({ me: { hand: [], inPlay: [inPlay('junkyard')], discard: ['scout'] } })
    const st2 = run(s2, { t: 'ACTIVATE', card: playIid(s2, 'p1', 'junkyard'), slot: 'primary' }).state
    // Only one card available and min is 1 -> auto-resolved, nothing left pending.
    expect(pending(st2)).toBeNull()
    expect(st2.scrapHeap.some((c) => c.def === D('scout'))).toBe(true)
  })

  it('resolves a ship primary immediately and does not offer it as an activation', () => {
    const s = scenario({ me: { hand: ['cutter'] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'cutter') }).state
    expect(st.players.p1.authority).toBe(54)
    expect(st.players.p1.trade).toBe(2)
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'primary')).toBe(false)
  })
})

describe('10. once per turn, per instance', () => {
  it('gives three Blob Wheels three independent activations', () => {
    const s = scenario({ me: { inPlay: [inPlay('blob-wheel'), inPlay('blob-wheel'), inPlay('blob-wheel')] } })
    const ids = s.players.p1.inPlay.map((c) => c.iid)
    const st = run(s,
      { t: 'ACTIVATE', card: ids[0]!, slot: 'primary' },
      { t: 'ACTIVATE', card: ids[1]!, slot: 'primary' },
      { t: 'ACTIVATE', card: ids[2]!, slot: 'primary' },
    ).state
    expect(st.players.p1.combat).toBe(3)
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'primary')).toBe(false)
  })

  it('refuses a second use of the same slot', () => {
    const s = scenario({ me: { inPlay: [inPlay('blob-wheel')] } })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'blob-wheel'), slot: 'primary' }).state
    expect(() => reduce(st, {
      actor: 'p1', action: { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-wheel'), slot: 'primary' },
    })).toThrow(IllegalActionError)
  })
})

describe('11. Stealth Needle', () => {
  it('copies a ship played this turn, gaining its abilities and faction', () => {
    const s = scenario({ me: { hand: ['blob-fighter', 'stealth-needle'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') }).state
    st = run(st, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-needle') }).state
    // Exactly one legal copy target, so there is no decision to make and the
    // choice auto-resolves -- but it is still narrated as an event.
    expect(pending(st)).toBeNull()

    const needle = st.players.p1.inPlay.find((c) => c.def === D('stealth-needle'))!
    expect(needle.copiedDef).toBe(D('blob-fighter'))
    expect(st.players.p1.combat).toBe(6) // 3 from the Fighter + 3 from the copy

    // The Needle counts as Blob AND Machine Cult, so two Blob cards are in play
    // and BOTH may use the Blob ally to draw.
    expect(st.players.p1.allyUnlocked).toContain('blob')
    const allies = legalFor(st, 'p1').filter((a) => a.t === 'ACTIVATE' && a.slot === 'ally')
    expect(allies).toHaveLength(2)
  })

  it('offers a real choice when several ships could be copied', () => {
    const s = scenario({ me: { hand: ['blob-fighter', 'trade-pod', 'stealth-needle'] } })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'trade-pod') },
    ).state
    st = run(st, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-needle') }).state
    expect(pending(st)?.prompt).toBe('COPY_SHIP')
    expect(pending(st)?.n).toBe(2)
    st = run(st, choose(st, byDef('trade-pod'))).state
    expect(st.players.p1.trade).toBe(6) // 3 from Trade Pod + 3 from the copy
  })

  it('does NOT count as a Blob card played, for Blob World', () => {
    const s = scenario({
      me: { hand: ['blob-fighter', 'stealth-needle'], inPlay: [inPlay('blob-world')], deck: ['scout', 'scout', 'scout'] },
    })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') }).state
    st = run(st, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-needle') }).state
    expect(st.players.p1.factionPlayedThisTurn.blob).toBe(1) // NOT 2

    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-world'), slot: 'primary' }).state
    st = run(st, choose(st, byBranch(1))).state
    expect(st.players.p1.hand).toHaveLength(1) // exactly one card drawn
  })

  it('enters play harmlessly when there is no ship to copy', () => {
    const s = scenario({ me: { hand: ['stealth-needle'] } })
    const { state, events } = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-needle') })
    expect(state.players.p1.inPlay.some((c) => c.def === D('stealth-needle'))).toBe(true)
    expect(events.some((e) => e.e === 'FIZZLE')).toBe(true)
    expect(pending(state)).toBeNull()
  })

  it('can copy a ship that was played and then scrapped this turn', () => {
    const s = scenario({ me: { hand: ['battle-blob', 'stealth-needle'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'battle-blob') }).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'battle-blob'), slot: 'scrap' }).state
    expect(st.players.p1.inPlay.some((c) => c.def === D('battle-blob'))).toBe(false)
    st = run(st, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'stealth-needle') }).state
    const needle = st.players.p1.inPlay.find((c) => c.def === D('stealth-needle'))!
    expect(needle.copiedDef).toBe(D('battle-blob'))
    expect(st.players.p1.combat).toBe(20) // 8 played + 4 scrapped + 8 from the copy's primary
  })
})

describe('12. Mech World', () => {
  it('satisfies every faction\'s ally condition at once', () => {
    const s = scenario({ me: { hand: ['blob-fighter'], inPlay: [inPlay('mech-world')] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') }).state
    expect(st.players.p1.allyUnlocked).toContain('blob')
    expect(legalFor(st, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'ally')).toBe(true)
  })

  it('does not count as a Blob card played for Blob World', () => {
    const s = scenario({ me: { hand: ['mech-world'], inPlay: [inPlay('blob-world')] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'mech-world') }).state
    expect(st.players.p1.factionPlayedThisTurn.blob).toBe(0)
    expect(st.players.p1.factionPlayedThisTurn.machine_cult).toBe(1)
  })

  it('offers no primary to activate', () => {
    const s = scenario({ me: { inPlay: [inPlay('mech-world')] } })
    expect(legalFor(s, 'p1').some((a) => a.t === 'ACTIVATE' && a.slot === 'primary')).toBe(false)
  })
})

describe('13. Blob World counts cards played this turn', () => {
  it('counts itself on the turn it is played, and Blob cards played before it', () => {
    const s = scenario({
      me: { hand: ['blob-fighter', 'trade-pod', 'blob-world'], deck: ['scout', 'scout', 'scout', 'scout'] },
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'trade-pod') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-world') },
    ).state
    expect(st.players.p1.factionPlayedThisTurn.blob).toBe(3)
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'blob-world'), slot: 'primary' }).state
    st = run(st, choose(st, byBranch(1))).state
    expect(st.players.p1.hand).toHaveLength(3)
  })

  it('does not count itself on later turns', () => {
    const s = scenario({
      me: { hand: [], inPlay: [inPlay('blob-world')], deck: ['scout', 'scout'] },
    })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'blob-world'), slot: 'primary' }).state
    // Branch 2 would draw zero, so only the combat branch is meaningful; picking
    // the draw branch must fizzle rather than misfire.
    const st2 = run(st, choose(st, byBranch(1))).state
    expect(st2.players.p1.hand).toHaveLength(0)
  })
})

describe('14. scrapping from hand/discard never triggers the card\'s own scrap ability', () => {
  it('does not grant Explorer combat when an Explorer is scrapped from hand', () => {
    const s = scenario({ me: { hand: ['trade-bot', 'explorer'] } })
    let st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'trade-bot') }).state
    st = run(st, choose(st, byDef('explorer'))).state
    expect(st.players.p1.combat).toBe(0)
    // ...and the Explorer goes back to its pile rather than the scrap heap.
    expect(st.explorerPile).toBe(11)
    expect(st.scrapHeap.some((c) => c.def === D('explorer'))).toBe(false)
  })
})

describe('15. Recycling Station discards fully before drawing', () => {
  it('can redraw a card it just discarded when the deck runs out', () => {
    const s = scenario({
      me: { inPlay: [inPlay('recycling-station')], hand: ['ram', 'cutter'], deck: [], discard: [] },
    })
    let st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'recycling-station'), slot: 'primary' }).state
    st = run(st, choose(st, byBranch(1))).state
    expect(pending(st)?.prompt).toBe('DISCARD_THEN_DRAW')
    st = run(st, chooseMany(st, [byDef('ram'), byDef('cutter')])).state
    // Deck and discard were empty; both discards land first, so both are available
    // to be reshuffled and drawn back.
    expect(st.players.p1.hand).toHaveLength(2)
    expect(st.players.p1.deck.length + st.players.p1.discard.length).toBe(0)
  })
})

describe('16. Machine Base draws first, then scraps from hand only', () => {
  it('can scrap the card it just drew, and never from the discard pile', () => {
    const s = scenario({
      me: { inPlay: [inPlay('machine-base')], hand: [], deck: ['ram'], discard: ['cutter'] },
    })
    const st = run(s, { t: 'ACTIVATE', card: playIid(s, 'p1', 'machine-base'), slot: 'primary' }).state
    // Ram was drawn, then it is the only hand card -> forced scrap, auto-resolved.
    expect(st.scrapHeap.some((c) => c.def === D('ram'))).toBe(true)
    expect(st.players.p1.discard.some((c) => c.def === D('cutter'))).toBe(true)
  })
})

describe('17. decks can genuinely run out', () => {
  it('draws fewer cards rather than crashing, with no loss condition', () => {
    const s = scenario({ me: { hand: [], deck: [], discard: [], inPlay: [] } })
    const st = run(s, { t: 'END_TURN' }).state
    expect(st.players.p1.hand).toHaveLength(0)
    expect(st.phase).toBe('main')
    expect(st.winner).toBeNull()
  })
})

describe('18. end-of-turn bookkeeping', () => {
  it('clears every per-turn counter and keeps bases in play', () => {
    const s = scenario({
      me: {
        hand: ['blob-fighter', 'freighter', 'federation-shuttle'],
        inPlay: [inPlay('blob-wheel')],
        deck: ['scout', 'scout', 'scout', 'scout', 'scout'],
        trade: 7, combat: 4,
      },
    })
    let st = run(s,
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'blob-fighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'freighter') },
      { t: 'PLAY_CARD', card: handIid(s, 'p1', 'federation-shuttle') },
    ).state
    st = run(st, { t: 'ACTIVATE', card: playIid(st, 'p1', 'freighter'), slot: 'ally' }).state
    expect(st.players.p1.pendingRedirects).toHaveLength(1)

    st = run(st, { t: 'END_TURN' }).state
    const p = st.players.p1
    expect(p.trade).toBe(0)                       // unspent trade is LOST
    expect(p.combat).toBe(0)                      // unspent combat is LOST
    expect(p.pendingRedirects).toEqual([])        // armed topdeck expires
    expect(p.factionPlayedThisTurn.blob).toBe(0)
    expect(p.shipsPlayedThisTurn).toEqual([])
    expect(p.allyUnlocked).toEqual([])
    expect(p.hand).toHaveLength(5)                // old hand discarded, next hand drawn
    expect(p.inPlay.map((c) => c.def)).toEqual([D('blob-wheel')]) // bases stay
    expect(p.inPlay[0]!.used).toEqual({ primary: false, ally: false, scrap: false })
  })

  it('refuses to end the turn while a choice is pending', () => {
    const s = scenario({ me: { hand: ['imperial-fighter'] }, them: { hand: ['scout', 'viper'] } })
    const st = run(s, { t: 'PLAY_CARD', card: handIid(s, 'p1', 'imperial-fighter') }).state
    expect(() => reduce(st, { actor: 'p2', action: { t: 'END_TURN' } })).toThrow(IllegalActionError)
  })
})

describe('setup and win condition', () => {
  it('deals 3 cards to the first player and 5 to the second', () => {
    const s = scenario({})
    expect(s.players.p1.hand).toHaveLength(3)
    expect(s.players.p2.hand).toHaveLength(5)
    expect(s.players.p1.authority).toBe(50)
    expect(s.tradeRow.filter(Boolean)).toHaveLength(5)
    expect(s.explorerPile).toBe(10)
    expect(s.tradeDeck).toHaveLength(75)
  })

  it('wins on authority reaching zero or below', () => {
    const s = scenario({ me: { combat: 9 }, them: { authority: 4, inPlay: [] } })
    const st = run(s, { t: 'ATTACK_PLAYER', amount: 9 }).state
    expect(st.phase).toBe('gameOver')
    expect(st.winner).toBe('p1')
  })
})
