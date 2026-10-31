import { describe, expect, it } from "vitest";
import {
  filterPlaylists,
  type PlaylistSummary,
} from "../../src/shared/playlist";

function playlist(title: string): PlaylistSummary {
  return { playlistId: title, title, itemCount: 1, thumbnailUrl: "" };
}

const all: PlaylistSummary[] = [
  playlist("Woodworking"),
  playlist("Música clásica"),
  playlist("Cooking basics"),
  playlist("Talks to rewatch"),
];

describe("filterPlaylists", (): void => {
  it("keeps every playlist, in order, for an empty or blank query", (): void => {
    expect(filterPlaylists(all, "")).toEqual(all);
    expect(filterPlaylists(all, "   ")).toEqual(all);
  });

  it("matches any part of the title, ignoring letter case", (): void => {
    expect(filterPlaylists(all, "WOOD")).toEqual([all[0]]);
    expect(filterPlaylists(all, "basic")).toEqual([all[2]]);
  });

  it("ignores accents on either side", (): void => {
    expect(filterPlaylists(all, "musica")).toEqual([all[1]]);
    expect(filterPlaylists(all, "clásica")).toEqual([all[1]]);
  });

  it("keeps the playlists' own order when several match", (): void => {
    expect(filterPlaylists(all, "o")).toEqual([all[0], all[2], all[3]]);
  });

  it("returns nothing when no title matches", (): void => {
    expect(filterPlaylists(all, "zzz")).toEqual([]);
  });
});
