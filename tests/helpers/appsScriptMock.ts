// In-memory fakes for the Google Apps Script runtime globals the server code
// reaches for (PropertiesService, CacheService, UrlFetchApp, Utilities,
// XmlService, YouTube). The server modules call these as free globals, so
// installing fakes on `globalThis` lets the *real* production code run under
// Node/Vitest with no production changes. See adr/0006 and the Testing section
// of CLAUDE.md.
//
// installAppsScriptMocks() wipes and reinstalls a clean environment and returns
// a handle to seed state and inspect/override behaviour. Call it in beforeEach.

import { DOMParser } from "@xmldom/xmldom";
import { createHash } from "node:crypto";

// Real Apps Script quotas the fakes enforce so an oversized write fails in
// tests the same way it fails in production. Sizes are measured in UTF-8
// bytes, which is what Google's limits count.
const PROPERTIES_MAX_VALUE_BYTES = 9 * 1024;
const PROPERTIES_MAX_TOTAL_BYTES = 500 * 1024;
const CACHE_MAX_VALUE_BYTES = 100 * 1024;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

// ---------------------------------------------------------------------------
// PropertiesService (per-user key/value store; values are strings)
// ---------------------------------------------------------------------------

class FakeProperties {
  private store: { [key: string]: string };

  constructor(initial: { [key: string]: string } = {}) {
    this.store = { ...initial };
  }

  getProperty(key: string): string | null {
    return key in this.store ? this.store[key] : null;
  }

  setProperty(key: string, value: string): FakeProperties {
    this.checkValueSize(key, value);
    this.checkTotalSize({ ...this.store, [key]: value });
    this.store[key] = value;
    return this;
  }

  deleteProperty(key: string): FakeProperties {
    delete this.store[key];
    return this;
  }

  getProperties(): { [key: string]: string } {
    return { ...this.store };
  }

  // GAS: setProperties(properties, deleteAllOthers). When deleteAllOthers is
  // true the store is replaced wholesale, otherwise merged.
  setProperties(
    properties: { [key: string]: string },
    deleteAllOthers?: boolean,
  ): FakeProperties {
    for (const key of Object.keys(properties))
      this.checkValueSize(key, properties[key]);
    const next = deleteAllOthers
      ? { ...properties }
      : { ...this.store, ...properties };
    this.checkTotalSize(next);
    this.store = deleteAllOthers ? next : Object.assign(this.store, properties);
    return this;
  }

  private checkValueSize(key: string, value: string): void {
    const bytes = utf8Bytes(value);
    if (bytes > PROPERTIES_MAX_VALUE_BYTES) {
      throw new Error(
        `FakeProperties: value for "${key}" is ${bytes} bytes; real PropertiesService caps values at ${PROPERTIES_MAX_VALUE_BYTES} bytes`,
      );
    }
  }

  private checkTotalSize(store: { [key: string]: string }): void {
    let total = 0;
    for (const key of Object.keys(store)) total += utf8Bytes(store[key]);
    if (total > PROPERTIES_MAX_TOTAL_BYTES) {
      throw new Error(
        `FakeProperties: store would total ${total} bytes; real PropertiesService caps a property store at ${PROPERTIES_MAX_TOTAL_BYTES} bytes`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CacheService (string cache; TTL is irrelevant in tests so it is ignored)
// ---------------------------------------------------------------------------

class FakeCache {
  private store: { [key: string]: string } = {};

  get(key: string): string | null {
    return key in this.store ? this.store[key] : null;
  }

  getAll(keys: string[]): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    for (const key of keys)
      if (key in this.store) result[key] = this.store[key];
    return result;
  }

  put(key: string, value: string, _ttlSeconds?: number): void {
    this.checkValueSize(key, value);
    this.store[key] = value;
  }

  putAll(values: { [key: string]: string }, _ttlSeconds?: number): void {
    for (const key of Object.keys(values))
      this.checkValueSize(key, values[key]);
    Object.assign(this.store, values);
  }

  private checkValueSize(key: string, value: string): void {
    const bytes = utf8Bytes(value);
    if (bytes > CACHE_MAX_VALUE_BYTES) {
      throw new Error(
        `FakeCache: value for "${key}" is ${bytes} bytes; real CacheService caps values at ${CACHE_MAX_VALUE_BYTES} bytes`,
      );
    }
  }

  remove(key: string): void {
    delete this.store[key];
  }
}

// ---------------------------------------------------------------------------
// LockService — mutual-exclusion locks. Vitest runs single-threaded so the fake
// never actually blocks; it only records acquire/release calls (exposed on the
// handle as `lockCalls`) so tests can assert a mutation took and released the
// lock. `waitLock` runs an optional hook first so a test can simulate another
// execution winning the race while this one "waited".
// ---------------------------------------------------------------------------

class FakeLock {
  private held = false;

  constructor(
    private calls: string[],
    private onWait: () => void,
  ) {}

  waitLock(_timeoutMs: number): void {
    this.onWait();
    this.held = true;
    this.calls.push("acquire");
  }

  tryLock(_timeoutMs: number): boolean {
    this.onWait();
    this.held = true;
    this.calls.push("acquire");
    return true;
  }

  releaseLock(): void {
    this.held = false;
    this.calls.push("release");
  }

  hasLock(): boolean {
    return this.held;
  }
}

// ---------------------------------------------------------------------------
// XmlService — a faithful-enough wrapper over a real namespace-aware DOM parser
// so parseChannelFeed runs against real YouTube RSS XML.
// ---------------------------------------------------------------------------

interface FakeNamespace {
  uri: string;
}

class FakeElement {
  constructor(private node: Element) {}

  // GAS getChildren returns DIRECT element children matching localName +
  // namespace (NOT recursive descendants).
  getChildren(name: string, ns: FakeNamespace): FakeElement[] {
    const result: FakeElement[] = [];
    for (let i = 0; i < this.node.childNodes.length; i += 1) {
      const child = this.node.childNodes[i] as Element;
      if (
        child.nodeType === 1 &&
        child.localName === name &&
        child.namespaceURI === ns.uri
      ) {
        result.push(new FakeElement(child));
      }
    }
    return result;
  }

  getChild(name: string, ns: FakeNamespace): FakeElement | null {
    const matches = this.getChildren(name, ns);
    return matches.length > 0 ? matches[0] : null;
  }

  // GAS getText concatenates the element's own text-node children.
  getText(): string {
    let text = "";
    for (let i = 0; i < this.node.childNodes.length; i += 1) {
      const child = this.node.childNodes[i];
      if (child.nodeType === 3 || child.nodeType === 4)
        text += child.nodeValue ?? "";
    }
    return text;
  }

  getAttribute(name: string): { getValue(): string } | null {
    if (!this.node.hasAttribute(name)) return null;
    const value = this.node.getAttribute(name) ?? "";
    return { getValue: () => value };
  }
}

const fakeXmlService = {
  // GAS exposes getNamespace(uri) and getNamespace(prefix, uri); only the uri
  // is significant for matching, which is always the last argument.
  getNamespace(prefixOrUri: string, uri?: string): FakeNamespace {
    return { uri: uri ?? prefixOrUri };
  },
  parse(xml: string): { getRootElement(): FakeElement } {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const root = doc.documentElement;
    if (!root) throw new Error("XML parse error: no root element");
    return {
      getRootElement: () => new FakeElement(root as unknown as Element),
    };
  },
};

// ---------------------------------------------------------------------------
// UrlFetchApp — responder is supplied per test.
// ---------------------------------------------------------------------------

export interface FakeHttpResponse {
  getResponseCode(): number;
  getContentText(): string;
}

export function httpResponse(code: number, body: string): FakeHttpResponse {
  return { getResponseCode: () => code, getContentText: () => body };
}

interface FetchRequest {
  url: string;
  muteHttpExceptions?: boolean;
}

// ---------------------------------------------------------------------------
// YouTube advanced service — a configurable stub. Tests assign just the methods
// the code under test calls.
// ---------------------------------------------------------------------------

export interface FakeYouTube {
  Subscriptions?: { list: (...args: unknown[]) => unknown };
  Videos?: { list: (...args: unknown[]) => unknown };
  Playlists?: {
    list: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
  };
  PlaylistItems?: {
    list: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
    remove: (...args: unknown[]) => unknown;
  };
}

export interface AppsScriptMocks {
  userProperties: FakeProperties;
  scriptCache: FakeCache;
  userCache: FakeCache;
  /** Override to control RSS / HTTP responses. Default: every request 404s. */
  fetchAll: (requests: FetchRequest[]) => FakeHttpResponse[];
  /** Configure the YouTube advanced service stub. */
  youtube: FakeYouTube;
  /** Records each Utilities.sleep(ms) call so retry/backoff can be asserted. */
  sleeps: number[];
  /** Records "acquire"/"release" for each LockService lock call, in order. */
  lockCalls: string[];
  /**
   * Runs at the start of every waitLock/tryLock. Default no-op; a test can
   * override it to simulate a concurrent execution that mutated state while
   * this one waited for the lock.
   */
  onLockWait: () => void;
}

/**
 * Wipe and install a fresh fake Apps Script environment on globalThis. Returns
 * a mutable handle: seed properties/cache, set `fetchAll`, and populate
 * `youtube` before exercising the code under test.
 */
export function installAppsScriptMocks(): AppsScriptMocks {
  const userProperties = new FakeProperties();
  const scriptCache = new FakeCache();
  const userCache = new FakeCache();

  const mocks: AppsScriptMocks = {
    userProperties,
    scriptCache,
    userCache,
    fetchAll: (requests: FetchRequest[]) =>
      requests.map(() => httpResponse(404, "")),
    youtube: {},
    sleeps: [],
    lockCalls: [],
    onLockWait: () => {},
  };

  const g = globalThis as Record<string, unknown>;

  // One lock shared by all getUserLock/getScriptLock/getDocumentLock calls: this
  // deploy is per-user, so those scopes collapse to the same mutex in tests.
  const lock = new FakeLock(mocks.lockCalls, () => mocks.onLockWait());
  g.LockService = {
    getUserLock: () => lock,
    getScriptLock: () => lock,
    getDocumentLock: () => lock,
  };

  g.PropertiesService = {
    getUserProperties: () => userProperties,
    getScriptProperties: () => userProperties,
    getDocumentProperties: () => userProperties,
  };

  g.CacheService = {
    getScriptCache: () => scriptCache,
    getUserCache: () => userCache,
    getDocumentCache: () => userCache,
  };

  g.UrlFetchApp = {
    fetchAll: (requests: FetchRequest[]) => mocks.fetchAll(requests),
    fetch: (url: string) => mocks.fetchAll([{ url }])[0],
  };

  g.Utilities = {
    sleep: (ms: number) => {
      mocks.sleeps.push(ms);
    },
    DigestAlgorithm: { SHA_256: "SHA_256" },
    // Real Apps Script returns SIGNED bytes (-128..127), so the fake converts
    // Node's unsigned bytes the same way. Production code must undo that sign
    // before it builds hex, and this keeps that conversion under test.
    computeDigest: (algorithm: string, value: string) => {
      if (algorithm !== "SHA_256") {
        throw new Error(`FakeUtilities: unsupported digest ${algorithm}`);
      }
      const digest = createHash("sha256").update(value, "utf8").digest();
      return Array.from(digest, (byte) => (byte > 127 ? byte - 256 : byte));
    },
  };

  g.XmlService = fakeXmlService;

  // YouTube is read through this proxy so tests can assign mocks.youtube.* at
  // any point and the production code (which captures `YouTube` lazily inside
  // each function) still sees the latest stub.
  g.YouTube = new Proxy(
    {},
    {
      get(_target, prop: string) {
        return (mocks.youtube as Record<string, unknown>)[prop];
      },
    },
  );

  return mocks;
}

/** Remove all installed fakes (call in afterEach to keep tests isolated). */
export function uninstallAppsScriptMocks(): void {
  const g = globalThis as Record<string, unknown>;
  for (const key of [
    "PropertiesService",
    "CacheService",
    "UrlFetchApp",
    "Utilities",
    "XmlService",
    "YouTube",
    "LockService",
  ]) {
    delete g[key];
  }
}
