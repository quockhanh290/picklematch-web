import { isPreviewResponseCurrent } from '../../features/host/session-detail/next-round-v2/preview-consistency'

describe('preview staleness after persisted responses', () => {
  it('keeps a just-persisted preview current when polling has already caught up to the persisted version', () => {
    const requestVersion = 41
    const persistedPreviewVersion = 42
    const pollSnapshotVersion = 42

    expect(isPreviewResponseCurrent({
      requestVersion,
      responseVersion: persistedPreviewVersion,
      currentVersion: pollSnapshotVersion,
      allowResponseAdvance: true,
    })).toBe(true)
  })

  it('still rejects a persisted preview when a newer state arrived after it', () => {
    const requestVersion = 41
    const persistedPreviewVersion = 42
    const newerPollSnapshotVersion = 43

    expect(isPreviewResponseCurrent({
      requestVersion,
      responseVersion: persistedPreviewVersion,
      currentVersion: newerPollSnapshotVersion,
      allowResponseAdvance: true,
    })).toBe(false)
  })
})
