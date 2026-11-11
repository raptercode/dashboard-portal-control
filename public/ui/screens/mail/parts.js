import { h, icon, button, badge, copy, when } from "../../core/dom.js";
import { DNS_KINDS, dnsStatus } from "./model.js";

const copyable = (label, value) =>
  h(
    "div",
    { class: "copyable" },
    h("code", {}, value),
    button(icon("copy"), () => copy(value), "icon", {
      "aria-label": `คัดลอก ${label}`,
      title: "คัดลอก",
    }),
  );

// One domain's records laid out the way a DNS provider's form asks for them:
// type, host and value are separate fields, each with its own copy button.
export function dnsRecords(entry) {
  if (!entry.records)
    return h(
      "p",
      { class: "muted" },
      "บันทึก mail hostname ก่อน ระบบจึงจะสร้าง DNS records ของโดเมนนี้ได้",
    );
  return h(
    "div",
    { class: "dns-records", role: "list", "aria-label": `DNS records ของ ${entry.domain}` },
    ...DNS_KINDS.map((kind) => {
      const record = entry.records[kind];
      const provider = record.provider || {};
      const result = entry.dns?.[kind];
      const status = dnsStatus(result);
      return h(
        "div",
        { class: "dns-record", role: "listitem", "data-kind": kind },
        h(
          "div",
          { class: "dns-kind" },
          h("strong", {}, kind.toUpperCase()),
          h(
            "small",
            {},
            provider.type +
              (provider.priority != null ? ` · priority ${provider.priority}` : ""),
          ),
        ),
        h(
          "div",
          { class: "dns-field" },
          h("small", {}, "Host / Name"),
          copyable(`${kind.toUpperCase()} host`, provider.host),
        ),
        h(
          "div",
          { class: "dns-field" },
          h("small", {}, "Value"),
          copyable(`${kind.toUpperCase()} value`, provider.value ?? record.value),
        ),
        h(
          "div",
          { class: "dns-state" },
          badge(status.label, status.tone),
          result?.detail && h("small", {}, result.detail),
        ),
      );
    }),
  );
}

const OUTBOUND = {
  open: ["เปิด", "success"],
  filtered: ["ถูกกรอง", "warn"],
  blocked: ["ถูกบล็อก", "danger"],
};
const INBOUND = {
  allowed: ["อนุญาต", "success"],
  blocked: ["ถูกบล็อก", "danger"],
  unknown: ["ไม่ทราบ", "neutral"],
};
const SERVICES = { 25: "SMTP รับเมล", 587: "Submission ส่งจากโปรแกรมเมล", 993: "IMAPS อ่านจากโปรแกรมเมล" };

function portList(title, hint, ports, tones, describe) {
  return h(
    "div",
    { class: "port-group" },
    h("h3", {}, title),
    h("small", {}, hint),
    h(
      "ul",
      { class: "port-list" },
      ...(ports || []).map((item) => {
        const [label, tone] = tones[item.status] || ["ไม่ทราบ", "neutral"];
        return h(
          "li",
          {},
          h("b", { class: "mono" }, item.port),
          h("span", {}, describe(item)),
          badge(label, tone),
        );
      }),
    ),
  );
}

// The result of the connectivity check as two short lists instead of raw JSON.
export function portReadout(readiness) {
  if (!readiness?.outbound && !readiness?.inbound)
    return h("p", { class: "muted" }, "ยังไม่ได้ตรวจ connectivity");
  return h(
    "div",
    { class: "port-readout" },
    readiness.outbound &&
      portList(
        "ขาออก (ส่งเมล)",
        "ต่อออกไปยัง SMTP ภายนอกได้หรือไม่",
        readiness.outbound.ports,
        OUTBOUND,
        (item) => item.detail || item.target || "",
      ),
    readiness.inbound &&
      portList(
        "ขาเข้า (firewall ของ host)",
        "เฉพาะ policy ของ UFW บนเครื่องนี้ ไม่ได้ยืนยัน firewall ของผู้ให้บริการ",
        readiness.inbound.ports,
        INBOUND,
        (item) => SERVICES[item.port] || item.detail || "",
      ),
    readiness.checkedAt && h("small", {}, "ตรวจล่าสุด ", when(readiness.checkedAt)),
  );
}

const MODES = {
  direct: "Direct MX — ส่งตรงผ่านพอร์ต 25",
  "relay-587": "SMTP relay — พอร์ต 587",
  "relay-2525": "SMTP relay — พอร์ต 2525",
};
export const deliveryLabel = (mode) => MODES[mode] || "ยังไม่ได้เลือก";
