// A top-level comment on a video, shown on the player screen.

export interface VideoComment {
  author: string;
  authorImageUrl: string;
  text: string;
  likeCount: number;
  /** ISO 8601 timestamp. */
  publishedAt: string;
}
