import test from "node:test";
import assert from "node:assert/strict";
import { mailStepAvailable } from "../public/ui/screens/mail.js";
test("mail setup allows identity before DNS but gates activation and mailbox operations on saved state", () => {
  const m = {
    hostname: null,
    domains: [],
    outboundMode: null,
    configure: null,
    mailboxes: [],
  };
  assert.equal(mailStepAvailable(1, m), true);
  assert.equal(mailStepAvailable(2, m), true);
  assert.equal(mailStepAvailable(3, m), false);
  m.hostname = "mail.example.com";
  m.domains.push({ domain: "example.com" });
  assert.equal(mailStepAvailable(3, m), true);
  assert.equal(mailStepAvailable(4, m), true);
  assert.equal(mailStepAvailable(5, m), false);
  m.outboundMode = "relay-587";
  assert.equal(mailStepAvailable(5, m), true);
  assert.equal(mailStepAvailable(6, m), false);
  m.configure = { status: "configured" };
  assert.equal(mailStepAvailable(6, m), true);
  assert.equal(mailStepAvailable(7, m), false);
  m.mailboxes.push({ id: "mailbox" });
  assert.equal(mailStepAvailable(7, m), true);
});
