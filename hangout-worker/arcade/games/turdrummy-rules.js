/* TurdRummy melds, deadwood, layoffs, and settlement for solo and room play. */
(function (root) {
  'use strict';

  const SUIT_ORDER = { C: 0, D: 1, H: 2, S: 3 };
  const balance = Object.freeze({ knockLimit: 10, ginBonus: 25, undercutBonus: 25, matchTarget: 100 });

  function cardDeadwoodValue(card) {
    if (card.rank === 1) {return 1;}
    if (card.rank >= 10) {return 10;}
    return card.rank;
  }

  function sortByRankThenSuit(a, b) {
    if (a.rank !== b.rank) {return a.rank - b.rank;}
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  }

  function getCombinations(cards, k) {
    const out = [];
    function helper(start, choose, acc) {
      if (choose === 0) {
        out.push(acc.slice());
        return;
      }
      for (let i = start; i <= cards.length - choose; i += 1) {
        acc.push(cards[i]);
        helper(i + 1, choose - 1, acc);
        acc.pop();
      }
    }
    helper(0, k, []);
    return out;
  }

  function createMeld(type, cards, indexById) {
    let mask = 0;
    for (const card of cards) {
      const idx = indexById.get(card.id);
      mask |= (1 << idx);
    }
    return {
      type,
      cards: cards.slice().sort(sortByRankThenSuit),
      mask
    };
  }

  function isBetterAnalysis(a, b) {
    if (!b) {return true;}
    if (a.deadwoodScore !== b.deadwoodScore) {return a.deadwoodScore < b.deadwoodScore;}
    if (a.meldCardCount !== b.meldCardCount) {return a.meldCardCount > b.meldCardCount;}
    return a.deadwoodCards.length < b.deadwoodCards.length;
  }

  function collectCandidateMelds(cards) {
    const indexById = new Map(cards.map((card, idx) => [card.id, idx]));
    const melds = [];

    const byRank = new Map();
    for (const card of cards) {
      if (!byRank.has(card.rank)) {byRank.set(card.rank, []);}
      byRank.get(card.rank).push(card);
    }
    byRank.forEach((group) => {
      if (group.length >= 3) {
        const triples = getCombinations(group, 3);
        for (const combo of triples) {
          melds.push(createMeld('set', combo, indexById));
        }
        if (group.length === 4) {
          melds.push(createMeld('set', group, indexById));
        }
      }
    });

    const bySuit = new Map();
    for (const card of cards) {
      if (!bySuit.has(card.suit)) {bySuit.set(card.suit, []);}
      bySuit.get(card.suit).push(card);
    }
    bySuit.forEach((group) => {
      group.sort((a, b) => a.rank - b.rank);
      for (let start = 0; start < group.length; start += 1) {
        const run = [group[start]];
        for (let end = start + 1; end < group.length; end += 1) {
          if (group[end].rank === group[end - 1].rank + 1) {
            run.push(group[end]);
            if (run.length >= 3) {
              melds.push(createMeld('run', run, indexById));
            }
          } else {
            break;
          }
        }
      }
    });

    return melds;
  }

  function analyzeHand(hand) {
    const cards = hand.slice().sort(sortByRankThenSuit);
    const melds = collectCandidateMelds(cards);

    const memo = new Map();
    function solve(meldIdx, usedMask) {
      const key = String(meldIdx) + '|' + String(usedMask);
      if (memo.has(key)) {return memo.get(key);}

      let result;
      if (meldIdx >= melds.length) {
        const deadwoodCards = [];
        let deadwoodScore = 0;
        for (let i = 0; i < cards.length; i += 1) {
          if ((usedMask & (1 << i)) === 0) {
            deadwoodCards.push(cards[i]);
            deadwoodScore += cardDeadwoodValue(cards[i]);
          }
        }
        result = {
          deadwoodScore,
          deadwoodCards,
          melds: [],
          meldCardCount: cards.length - deadwoodCards.length
        };
      } else {
        const skip = solve(meldIdx + 1, usedMask);
        let best = skip;
        const meld = melds[meldIdx];
        if ((usedMask & meld.mask) === 0) {
          const withMeld = solve(meldIdx + 1, usedMask | meld.mask);
          const candidate = {
            deadwoodScore: withMeld.deadwoodScore,
            deadwoodCards: withMeld.deadwoodCards,
            melds: [{ type: meld.type, cards: meld.cards.slice() }].concat(withMeld.melds),
            meldCardCount: withMeld.meldCardCount
          };
          if (isBetterAnalysis(candidate, best)) {
            best = candidate;
          }
        }
        result = best;
      }

      memo.set(key, result);
      return result;
    }

    return solve(0, 0);
  }

  function cloneMelds(melds) {
    return melds.map((meld) => ({
      type: meld.type,
      cards: meld.cards.map((card) => ({ suit: card.suit, rank: card.rank, id: card.id }))
    }));
  }

  function canCardAttachToMeld(card, meld) {
    if (meld.type === 'set') {
      if (card.rank !== meld.cards[0].rank) {return false;}
      if (meld.cards.length >= 4) {return false;}
      return !meld.cards.some((m) => m.suit === card.suit);
    }
    if (meld.type === 'run') {
      if (card.suit !== meld.cards[0].suit) {return false;}
      const ranks = meld.cards.map((m) => m.rank).sort((a, b) => a - b);
      const min = ranks[0];
      const max = ranks[ranks.length - 1];
      return card.rank === min - 1 || card.rank === max + 1;
    }
    return false;
  }

  function attachCardToMeld(card, meld) {
    meld.cards.push({ suit: card.suit, rank: card.rank, id: card.id });
    if (meld.type === 'run') {meld.cards.sort((a, b) => a.rank - b.rank);}
  }

  function isBetterLayoff(a, b) {
    if (!b) {return true;}
    if (a.deadwoodScore !== b.deadwoodScore) {return a.deadwoodScore < b.deadwoodScore;}
    if (a.laidOffCards.length !== b.laidOffCards.length) {return a.laidOffCards.length > b.laidOffCards.length;}
    return a.deadwoodCards.length < b.deadwoodCards.length;
  }

  function applyLayoff(defenderHand, knockerMelds) {
    const base = analyzeHand(defenderHand);
    if (!knockerMelds || knockerMelds.length === 0 || base.deadwoodCards.length === 0) {
      return { deadwoodScore: base.deadwoodScore, deadwoodCards: base.deadwoodCards.slice(), laidOffCards: [] };
    }
    const cards = defenderHand.slice().sort(sortByRankThenSuit);
    const candidateMelds = collectCandidateMelds(cards);
    const tableMelds = cloneMelds(knockerMelds);
    const partitionMemo = new Map();
    const unusedMaskMemo = new Map();

    function searchDeadwood(deadwoodCards) {
      const layoffMemo = new Map();

      function search(remaining, melds) {
        // Equivalent attachment orders reach the same remaining cards and
        // table. Cache those states rather than exploring every permutation.
        const key = JSON.stringify([remaining, melds.map((meld) => [
          meld.type,
          meld.cards.slice().sort(sortByRankThenSuit).map((card) => [card.suit, card.rank])
        ])]);
        if (layoffMemo.has(key)) {return layoffMemo.get(key);}

        const keptCards = remaining.map((index) => deadwoodCards[index]);
        let best = {
          deadwoodScore: keptCards.reduce((total, card) => total + cardDeadwoodValue(card), 0),
          deadwoodCards: keptCards,
          laidOffCards: []
        };

        // A card that cannot attach yet stays available. For example, a 7 can
        // join 3-4-5 only after the 6 extends it. Explore each destination too:
        // placing that 6 on a rank set instead could strand the 7.
        for (let position = 0; position < remaining.length; position += 1) {
          const card = deadwoodCards[remaining[position]];
          for (let i = 0; i < melds.length; i += 1) {
            if (!canCardAttachToMeld(card, melds[i])) {continue;}
            const nextMelds = cloneMelds(melds);
            attachCardToMeld(card, nextMelds[i]);
            const nextRemaining = remaining.filter((_index, at) => at !== position);
            const continuation = search(nextRemaining, nextMelds);
            if (continuation.deadwoodScore < best.deadwoodScore) {
              best = {
                deadwoodScore: continuation.deadwoodScore,
                deadwoodCards: continuation.deadwoodCards,
                laidOffCards: [card].concat(continuation.laidOffCards)
              };
              // Scores cannot be negative. The receipt retains the legal
              // attachment order that actually reached this best outcome.
              if (best.deadwoodScore === 0) {
                layoffMemo.set(key, best);
                return best;
              }
            }
          }
        }
        layoffMemo.set(key, best);
        return best;
      }

      return search(deadwoodCards.map((_card, index) => index), tableMelds);
    }

    function layoffUnused(usedMask) {
      if (unusedMaskMemo.has(usedMask)) {return unusedMaskMemo.get(usedMask);}
      const unusedCards = [];
      for (let i = 0; i < cards.length; i += 1) {
        if ((usedMask & (1 << i)) === 0) {unusedCards.push(cards[i]);}
      }
      unusedCards.sort((a, b) => cardDeadwoodValue(b) - cardDeadwoodValue(a));
      const result = searchDeadwood(unusedCards);
      unusedMaskMemo.set(usedMask, result);
      return result;
    }

    function solve(meldIdx, usedMask) {
      const key = String(meldIdx) + '|' + String(usedMask);
      if (partitionMemo.has(key)) {return partitionMemo.get(key);}

      let best;
      if (meldIdx >= candidateMelds.length) {
        best = layoffUnused(usedMask);
      } else {
        best = solve(meldIdx + 1, usedMask);
        const meld = candidateMelds[meldIdx];
        if ((usedMask & meld.mask) === 0) {
          const withMeld = solve(meldIdx + 1, usedMask | meld.mask);
          if (isBetterLayoff(withMeld, best)) {best = withMeld;}
        }
      }

      partitionMemo.set(key, best);
      return best;
    }

    return solve(0, 0);
  }

  function scoreRound(knocker, defenderHand, gin = knocker.deadwoodScore === 0) {
    const defender = gin ? analyzeHand(defenderHand) : applyLayoff(defenderHand, knocker.melds);
    const defenderDeadwood = defender.deadwoodScore;
    const laidOffCards = defender.laidOffCards || [];
    if (gin) {
      return { kind: 'gin', points: balance.ginBonus + defenderDeadwood, defenderDeadwood, laidOffCards };
    }
    const difference = defenderDeadwood - knocker.deadwoodScore;
    return difference > 0
      ? { kind: 'knock', points: difference, defenderDeadwood, laidOffCards }
      : { kind: 'undercut', points: balance.undercutBonus - difference, defenderDeadwood, laidOffCards };
  }

  root.TurdRummyRules = Object.freeze({
    balance, analyzeHand, applyLayoff, scoreRound, cardDeadwoodValue, sortByRankThenSuit,
    canCardAttachToMeld, attachCardToMeld, cloneMelds
  });
})(globalThis);
