import {
  parseRollingHorizonDetail,
  summarizeRollingHorizonDetails,
} from '../../../lib/next-round-suggester/planner/rolling-diagnostics'

const first = 'court=2;candidates=4;evaluated=4;orders=3;depth=2;calls=9;cache=3;exhausted=0;elapsed=121.5;pick=1;quality=4.20;fairness=30.00;flex=0.75;score=80.00;worst=60.00;no_future=0;reject=0;reject_delta=2.50;reject_worst=62.00'
const second = 'court=4;candidates=5;evaluated=3;orders=2;depth=2;calls=8;cache=2;exhausted=1;elapsed=300.4;pick=0;quality=3.00;fairness=20.00;flex=1.00;score=70.00;worst=55.00;no_future=1;reject=-1;reject_delta=na;reject_worst=na'

describe('rolling planner diagnostics', () => {
  it('parses the compact counterfactual event', () => {
    expect(parseRollingHorizonDetail(first)).toMatchObject({
      court: 2,
      candidates: 4,
      selected_candidate_index: 1,
      best_rejected_candidate_index: 0,
      best_rejected_delta: 2.5,
      exhausted: false,
    })
  })

  it('aggregates runtime, fallback pressure, cache, and close decisions', () => {
    expect(summarizeRollingHorizonDetails([first, second, 'not-a-rolling-event'])).toEqual({
      decisions: 2,
      budget_exhausted: 1,
      avg_elapsed_ms: 210.95,
      max_elapsed_ms: 300.4,
      future_search_calls: 17,
      future_cache_hits: 5,
      paths_without_future: 1,
      avg_best_rejected_delta: 2.5,
      close_decisions_delta_lte_5: 1,
      decisions_without_rejected_candidate: 1,
    })
  })
})
