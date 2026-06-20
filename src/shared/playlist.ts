// A user playlist as shown in the Playlists screen. The videos themselves are
// fetched separately and normalized to Video[] (see PLAN.md sections 5 and 13).

export interface PlaylistSummary {
  playlistId: string;
  title: string;
  itemCount: number;
}
