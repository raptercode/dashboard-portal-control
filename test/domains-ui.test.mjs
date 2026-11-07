import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DOMAINS,
  domainDetail,
  domainDnsRecords,
  domainDnsStatus,
  domainError,
  domainProxyStatus,
  domainReadiness,
  domainTls,
  needsCleanup,
} from "../public/ui/core/domains.js";

test("a domain is valid only when DNS, the origin check and its certificate all pass", () => {
  const edge = { passed: true, tls: { status: "valid" } };
  assert.equal(domainReadiness({ status: "ok" }, edge).variant, "ready");
  assert.equal(domainReadiness({ status: "proxied" }, edge).variant, "ready");
  assert.equal(domainReadiness({ status: "ok" }, { passed: true, tls: { status: "invalid" } }).variant, "muted");
  assert.equal(domainReadiness({ status: "ok" }, { passed: false, tls: { status: "valid" } }).variant, "muted");
  for (const status of ["mismatch", "unresolved", "error"])
    assert.equal(domainReadiness({ status }, edge).variant, "needs", status);
  assert.equal(domainReadiness(undefined, undefined).label, "Pending Verification");
});

test("DNS, Cloudflare proxy and origin TLS are reported separately", () => {
  assert.equal(domainDnsStatus({ status: "proxied" }), "DNS ผ่าน Cloudflare");
  assert.equal(domainDnsStatus(undefined), "รอตรวจ DNS");
  assert.equal(domainProxyStatus({ status: "proxied" }), "Proxy: เปิด (Cloudflare)");
  assert.equal(domainProxyStatus({ proxy: { detected: true } }), "Proxy: เปิด (Cloudflare)");
  assert.equal(domainProxyStatus({ resolved: ["192.0.2.1"] }), "Proxy: ไม่พบ Cloudflare");
  assert.equal(domainProxyStatus({}), "Proxy: ยังตรวจไม่ได้");
  assert.deepEqual(domainTls({ tls: { status: "valid" } }), { text: "TLS: พร้อม", ready: true });
  assert.equal(domainTls({ tls: { status: "invalid" } }).text, "TLS: certificate ไม่ผ่าน");
  assert.equal(domainTls({ tls: { status: "unreachable" } }).text, "TLS: ต่อ origin ไม่ได้");
  assert.equal(domainTls({ status: "not-loaded" }).text, "TLS: รอ Verify");
  assert.equal(domainTls({ status: "checking" }).text, "TLS: กำลังตรวจ");
  assert.equal(domainTls(undefined).ready, false);
});

test("DNS records list IPv4 as required and IPv6 as optional when both exist", () => {
  assert.deepEqual(
    domainDnsRecords("app.example.test", { expected: ["192.0.2.1", "2001:db8::1"] }),
    [
      { type: "A", name: "app.example.test", value: "192.0.2.1", optional: false },
      { type: "AAAA", name: "app.example.test", value: "2001:db8::1", optional: true },
    ],
  );
  assert.equal(domainDnsRecords("v6.example.test", { expected: ["2001:db8::1"] })[0].optional, false);
  assert.deepEqual(domainDnsRecords("x.example.test", undefined), []);
  assert.match(domainDetail({ status: "proxied" }), /Cloudflare Proxy/);
  assert.match(domainDetail({ status: "unresolved" }), /กด Verify อีกครั้ง/);
  assert.equal(domainDetail({ detail: "ผลจาก server" }), "ผลจาก server");
});

test("errors are explained in plain Thai, and a refused removal can be retried", () => {
  assert.match(domainError(new Error("Enter a valid DNS hostname.")).message, /api\.example\.com/);
  assert.match(domainError(new Error("Failed to fetch")).message, /ลอง Refresh/);
  const other = new Error("Another error");
  assert.equal(domainError(other), other);
  assert.equal(MAX_DOMAINS, 10);
  assert.equal(needsCleanup({ hosts: ["a.test"], activeHosts: ["a.test"], syncError: null }), false);
  assert.equal(needsCleanup({ hosts: ["a.test"], activeHosts: ["a.test", "b.test"], syncError: "failed" }), true);
  assert.equal(needsCleanup({ hosts: ["a.test"], activeHosts: ["a.test"], syncError: "failed" }), false);
  assert.equal(needsCleanup(undefined), false);
});
