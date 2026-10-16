/**
 * React hook wrapping {@link createFilterUrlSync} for Vite apps on the apps/ track.
 *
 * Pass stable `serialize` / `hydrate` callbacks (useCallback). When filter state
 * changes, call `sync()` from an effect or event handler — same as the vanilla page.
 */

import { useEffect, useMemo, useRef } from "react";
import { createFilterUrlSync } from "../js/filter-url.js";

/**
 * @param {Parameters<typeof createFilterUrlSync>[0]} config
 * @returns {{ sync: (opts?: { replace?: boolean }) => void, hydrate: () => void }}
 */
export function useFilterUrlSync(config) {
  const onReplayRef = useRef(config.onReplay);
  onReplayRef.current = config.onReplay;

  const syncApi = useMemo(
    () => createFilterUrlSync({
      serialize: config.serialize,
      hydrate: config.hydrate,
      historyState: config.historyState,
      onReplay: () => onReplayRef.current?.(),
    }),
    [config.serialize, config.hydrate, config.historyState],
  );

  useEffect(() => syncApi.installPopstate(), [syncApi]);

  return syncApi;
}
