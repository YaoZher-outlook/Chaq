import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

export type OutboundLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export type OutboundPolicyOptions = {
  allowHttp?: boolean;
  lookup?: OutboundLookup;
  requester?: OutboundRequester;
};

type ResolvedAddress = { address: string; family: number };
export type OutboundRequester = (url: URL, init: RequestInit, addresses: ResolvedAddress[]) => Promise<Response>;

const blockedAddresses = new BlockList();
const forbiddenRequestHeaders = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as Array<[string, number]>) {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
}

for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as Array<[string, number]>) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

const defaultLookup: OutboundLookup = async (hostname) => {
  const rows = await dnsLookup(hostname, { all: true, verbatim: true });
  return rows.map((row) => ({ address: row.address, family: row.family }));
};

export class OutboundPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundPolicyError";
  }
}

export async function assertOutboundUrl(value: string, options: OutboundPolicyOptions = {}): Promise<URL> {
  return (await resolveOutboundTarget(value, options)).url;
}

async function resolveOutboundTarget(
  value: string,
  options: OutboundPolicyOptions
): Promise<{ url: URL; addresses: ResolvedAddress[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundPolicyError("Outbound URL is invalid.");
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    throw new OutboundPolicyError("Outbound requests require HTTPS unless HTTP is explicitly allowed.");
  }
  if (url.username || url.password) {
    throw new OutboundPolicyError("Outbound URLs cannot contain embedded credentials.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new OutboundPolicyError("Outbound URL points to a local or private network address.");
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveAddresses(hostname, options.lookup ?? defaultLookup);
  if (!addresses.length || addresses.some((row) => isBlockedAddress(row.address, row.family))) {
    throw new OutboundPolicyError("Outbound URL points to a local, reserved, or private network address.");
  }
  return { url, addresses };
}

export async function safeFetch(
  value: string,
  init: RequestInit,
  options: OutboundPolicyOptions = {}
): Promise<Response> {
  const { url, addresses } = await resolveOutboundTarget(value, options);
  const normalizedInit = {
    ...init,
    headers: normalizeOutboundHeaders(init.headers)
  };
  const response = await (options.requester ?? requestPinned)(url, normalizedInit, addresses);
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutboundPolicyError("Outbound redirects are not allowed.");
  }
  return response;
}

export function normalizeOutboundHeaders(value?: HeadersInit): Headers {
  let headers: Headers;
  try {
    headers = new Headers(value);
  } catch {
    throw new OutboundPolicyError("Outbound request headers are invalid.");
  }

  let controlledName: string | null = null;
  headers.forEach((_headerValue, name) => {
    if (forbiddenRequestHeaders.has(name.toLowerCase())) controlledName = name;
  });
  if (controlledName) {
    throw new OutboundPolicyError(`Outbound request header ${controlledName} is controlled by the transport.`);
  }
  return headers;
}

async function requestPinned(url: URL, init: RequestInit, addresses: ResolvedAddress[]): Promise<Response> {
  const hostname = normalizeHostname(url.hostname);
  const body = requestBody(init.body);
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  const lookup = pinnedLookup(addresses);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    let responseStream: import("node:http").IncomingMessage | null = null;
    const abort = () => {
      const error = new OutboundPolicyError("Outbound request was aborted.");
      responseStream?.destroy(error);
      outgoing.destroy(error);
    };
    const outgoing = request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? "GET",
      headers,
      lookup,
      servername: url.protocol === "https:" && !isIP(hostname) ? hostname : undefined
    }, (incoming) => {
      responseStream = incoming;
      const responseHeaders = new Headers();
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        responseHeaders.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
      }
      const status = incoming.statusCode ?? 500;
      const hasBody = ![101, 204, 205, 304].includes(status);
      const responseBody = hasBody
        ? Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
        : null;
      incoming.once("close", cleanup);
      resolve(new Response(responseBody, {
        status,
        statusText: incoming.statusMessage,
        headers: responseHeaders
      }));
    });
    const cleanup = () => init.signal?.removeEventListener("abort", abort);
    outgoing.once("error", (error) => {
      cleanup();
      reject(error);
    });
    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
    if (body !== null) outgoing.write(body);
    outgoing.end();
  });
}

function pinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const requestedFamily = options.family ?? 0;
    const candidates = requestedFamily
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : addresses;
    if (!candidates.length) {
      const error = new Error("No validated address matches the requested address family.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, candidates.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, candidates[0].address, candidates[0].family);
  };
}

function requestBody(body: BodyInit | null | undefined): string | Uint8Array | null {
  if (body == null) return null;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new OutboundPolicyError("Outbound request body type is not supported.");
}

export async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new OutboundPolicyError(`Outbound response exceeded the ${maxBytes}-byte limit.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    if (size > maxBytes) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function readResponseJsonLimited<T>(response: Response, maxBytes: number): Promise<T> {
  const text = await readResponseTextLimited(response, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OutboundPolicyError("Outbound response was not valid JSON.");
  }
}

function normalizeHostname(value: string): string {
  const lower = value.trim().toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

async function resolveAddresses(hostname: string, resolver: OutboundLookup): Promise<Array<{ address: string; family: number }>> {
  try {
    return await resolver(hostname);
  } catch {
    throw new OutboundPolicyError("Outbound hostname could not be resolved.");
  }
}

function isBlockedAddress(address: string, familyHint: number): boolean {
  const normalized = normalizeHostname(address);
  const family = isIP(normalized) || familyHint;
  if (family === 4) return blockedAddresses.check(normalized, "ipv4");
  if (family === 6) {
    const mapped = mappedIpv4Address(normalized);
    return mapped
      ? blockedAddresses.check(mapped, "ipv4")
      : blockedAddresses.check(normalized, "ipv6");
  }
  return true;
}

function mappedIpv4Address(address: string): string | null {
  const words = parseIpv6Words(address);
  if (!words || words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) return null;
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join(".");
}

function parseIpv6Words(address: string): number[] | null {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const left = ipv6Parts(halves[0]);
  const right = halves.length === 2 ? ipv6Parts(halves[1]) : [];
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv6Parts(value: string): number[] | null {
  if (!value) return [];
  const result: number[] = [];
  for (const part of value.split(":")) {
    if (part.includes(".")) {
      const octets = part.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
      result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    result.push(Number.parseInt(part, 16));
  }
  return result;
}
