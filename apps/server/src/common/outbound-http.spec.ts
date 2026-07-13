import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOutboundUrl,
  normalizeOutboundHeaders,
  readResponseTextLimited,
  safeFetch
} from "./outbound-http";

test("outbound policy blocks IPv4, bracketed IPv6, and DNS-resolved private targets", async () => {
  await assert.rejects(assertOutboundUrl("http://127.0.0.1/internal", { allowHttp: true }), /private network/);
  await assert.rejects(assertOutboundUrl("http://[::1]/internal", { allowHttp: true }), /private network/);
  await assert.rejects(assertOutboundUrl("http://[::ffff:7f00:1]/internal", { allowHttp: true }), /private network/);
  await assert.rejects(assertOutboundUrl("https://service.example/internal", {
    lookup: async () => [{ address: "10.20.30.40", family: 4 }]
  }), /private network/);
  await assert.doesNotReject(assertOutboundUrl("https://service.example/v1", {
    lookup: async () => [{ address: "93.184.216.34", family: 4 }]
  }));
  await assert.doesNotReject(assertOutboundUrl("https://[::ffff:5db8:d822]/v1"));
});

test("safe fetch refuses redirects and bounded response reading rejects oversized bodies", async () => {
  await assert.rejects(
    safeFetch("https://93.184.216.34/start", { method: "GET" }, {
      requester: async () => new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" }
      })
    }),
    /redirects are not allowed/
  );

  await assert.rejects(
    readResponseTextLimited(new Response("123456"), 5),
    /exceeded the 5-byte limit/
  );
});

test("outbound transport rejects caller-controlled framing and routing headers", async () => {
  for (const name of ["Host", "Content-Length", "Transfer-Encoding", "Connection", "Proxy-Authorization"]) {
    assert.throws(
      () => normalizeOutboundHeaders({ [name]: "attacker-controlled" }),
      /controlled by the transport/
    );
  }

  let requested = false;
  await assert.rejects(
    safeFetch("https://93.184.216.34/", { headers: { Host: "internal.example" } }, {
      requester: async () => {
        requested = true;
        return new Response("ok");
      }
    }),
    /controlled by the transport/
  );
  assert.equal(requested, false);
  assert.equal(normalizeOutboundHeaders({ Authorization: "Bearer safe", "Content-Type": "application/json" }).get("authorization"), "Bearer safe");
});
