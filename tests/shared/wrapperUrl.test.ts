import { describe, expect, it } from "vitest";
import { readRepoFile } from "../helpers/stylesheet";
import {
  WRAPPER_ORIGIN,
  WRAPPER_URL_MESSAGE_TYPE,
  wrapperUrlMessage,
} from "../../src/shared/wrapperUrl";

describe("wrapperUrlMessage", (): void => {
  it("carries the screen params under the shared message type", (): void => {
    expect(wrapperUrlMessage({ view: "player", v: "abc" })).toEqual({
      type: WRAPPER_URL_MESSAGE_TYPE,
      params: { view: "player", v: "abc" },
    });
  });

  it("copies the params, so a later change to the source does not leak in", (): void => {
    const params: { [key: string]: string } = { view: "feed" };
    const message: ReturnType<typeof wrapperUrlMessage> =
      wrapperUrlMessage(params);
    params.view = "history";
    expect(message.params).toEqual({ view: "feed" });
  });
});

// The wrapper (pages/index.html) is plain HTML with no build step, so it
// cannot import the module above. These checks pin that both sides agree.
describe("the installable wrapper", (): void => {
  const wrapperHtml: string = readRepoFile("pages/index.html");

  it("lives on the origin that the app posts its URL to", (): void => {
    expect(readRepoFile("README.md")).toContain(WRAPPER_ORIGIN + "/MyTube/");
  });

  it("listens for the same message type", (): void => {
    expect(wrapperHtml).toContain('"' + WRAPPER_URL_MESSAGE_TYPE + '"');
  });

  it("forwards its own query string to the framed app", (): void => {
    expect(wrapperHtml).toMatch(/location\.search/);
  });

  it("replaces its URL, never pushes one (the framed app owns history)", (): void => {
    expect(wrapperHtml).toMatch(/history\.replaceState/);
    expect(wrapperHtml).not.toMatch(/history\.pushState/);
  });

  it("accepts the message only from a Google sandbox origin", (): void => {
    expect(wrapperHtml).toContain(".googleusercontent.com");
  });
});
