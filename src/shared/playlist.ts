// A user playlist as shown in the Playlists screen. The videos themselves are
// fetched separately and normalized to Video[] (see PLAN.md sections 5 and 13).

export interface PlaylistSummary {
  playlistId: string;
  title: string;
  itemCount: number;
  /** The playlist's cover, from the same snippet (no extra quota). Empty when
   *  YouTube sends none. */
  thumbnailUrl: string;
}

// Lower case without accents, so "musica" finds "Música clásica".
function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** The playlists whose title contains the query, in their own order. A blank
 *  query keeps them all. Case and accents do not matter. */
export function filterPlaylists(
  playlists: PlaylistSummary[],
  query: string,
): PlaylistSummary[] {
  const needle: string = foldForSearch(query.trim());
  if (needle === "") return playlists;
  return playlists.filter((playlist: PlaylistSummary): boolean =>
    foldForSearch(playlist.title).includes(needle),
  );
}
