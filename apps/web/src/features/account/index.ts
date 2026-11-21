/**
 * User accounts (docs/DECISIONS.md P-012): sign-in in the top right, a private
 * vibe history, and a map theme that follows the user's top vibes.
 *
 * The Vibe Engine records readings with `store.recordVibe(signal)`.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { startThemeController } from '../vibeTheme/controller';
import { createAccountClient, createSupabaseBackend } from './backend';
import { createAccountStore, type AccountStore } from './session';
import { mountAccountUi } from './ui';

export type { AccountState, AccountStore, RecordResult } from './session';

export function mountAccount(container: HTMLElement, opts: { map: MapLibreMap }): { store: AccountStore; destroy(): void } {
  const client = createAccountClient();
  const store = createAccountStore(client ? createSupabaseBackend(client) : null, { includeDev: import.meta.env.DEV });
  const unmountUi = mountAccountUi(container, store);
  const theme = startThemeController(opts.map, store);
  void store.start();

  if (import.meta.env.DEV) {
    // Dev only: sample vibes, so the theme can be seen before the Vibe Engine ships.
    // recordVibe writes real `dev` rows for the signed-in user; previewTaste saves nothing.
    Object.assign(window, {
      vibentaAccount: {
        store,
        recordVibe: (scores: unknown) => store.recordVibe({ scores, source: 'dev' }),
        previewTaste: theme.preview,
      },
    });
  }

  return {
    store,
    destroy() {
      theme.destroy();
      unmountUi();
    },
  };
}
