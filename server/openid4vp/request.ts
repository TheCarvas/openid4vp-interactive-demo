import type { ClaimName, PrepareAuthRequest, PrepareAuthResponse } from '../../shared/contracts/auth.js';
import type { FlowRecord } from '../domain/types.js';

export function buildOpenId4VpRequest(flow: FlowRecord, input: PrepareAuthRequest): PrepareAuthResponse {
  if (input.protocol !== 'openid4vp-v1-unsigned') {
    throw new Error('Signed OpenID4VP requests are not supported yet.');
  }

  return {
    flow_id: flow.id,
    expires_at: new Date(flow.expiresAt).toISOString(),
    protocol: input.protocol,
    data: {
      response_type: 'vp_token',
      response_mode: 'dc_api',
      nonce: flow.nonce,
      dcql_query: {
        credentials: [
          {
            id: 'user_info_query',
            format: 'dc+sd-jwt',
            meta: {
              vct_values: ['UserInfoCredential'],
            },
            claims: input.claims.map((claim: ClaimName) => ({ path: [claim] })),
          },
        ],
      },
    },
  };
}
