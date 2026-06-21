// A top-level comment on a video, shown on the player screen.

export interface VideoComment {
  author: string;
  authorImageUrl: string;
  text: string;
  likeCount: number;
  /** ISO 8601 timestamp. */
  publishedAt: string;
}

/** Comment sort order, mapped to the YouTube API's commentThreads order param. */
export type CommentOrder = "relevance" | "time";

/** One page of comments plus the token to fetch the next page. */
export interface CommentPage {
  comments: VideoComment[];
  /** Token for the next page, or "" when there are no more. */
  nextPageToken: string;
}
