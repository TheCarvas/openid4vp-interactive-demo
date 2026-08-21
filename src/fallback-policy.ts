export type SampleFallbackState = {
  hasPreparedFlow: boolean;
  browserApiAvailable: boolean;
  browserProtocolAllowed: boolean;
  credentialRequestRejected: boolean;
};

export function shouldOfferSampleCredential(state: SampleFallbackState): boolean {
  return state.hasPreparedFlow
    && (!state.browserApiAvailable || !state.browserProtocolAllowed || state.credentialRequestRejected);
}
