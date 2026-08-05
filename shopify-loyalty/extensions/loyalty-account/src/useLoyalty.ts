import {useEffect, useState} from 'preact/hooks';

import {createCustomerAccountClient, loadLoyaltyState, type LoyaltyState} from './loyalty';

type LoyaltyLoadState =
  | {status: 'loading'}
  | {status: 'loaded'; loyalty: LoyaltyState}
  | {status: 'failed'};

export function useLoyalty(): LoyaltyLoadState {
  const [state, setState] = useState<LoyaltyLoadState>({status: 'loading'});

  useEffect(() => {
    let active = true;
    loadLoyaltyState(createCustomerAccountClient(fetch))
      .then(loyalty => {
        if (active) setState({status: 'loaded', loyalty});
      })
      .catch(() => {
        if (active) setState({status: 'failed'});
      });
    return () => { active = false; };
  }, []);

  return state;
}
