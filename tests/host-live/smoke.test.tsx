import { waitFor } from '@testing-library/react-native'
import { renderHostLiveScreen } from './helpers/renderHostLive'

describe('NextRoundSuggesterScreenV2 host-live harness', () => {
  it('renders host-live screen without crashing', async () => {
    const { toJSON } = renderHostLiveScreen()
    expect(toJSON()).toBeTruthy()

    // The screen kicks off several async effects on mount (settings hydration,
    // avoid-pairs load, live session query). Let them settle so later host-live
    // tests don't inherit dangling act() warnings from this smoke test.
    await waitFor(() => {
      expect(toJSON()).toBeTruthy()
    })
  })
})
