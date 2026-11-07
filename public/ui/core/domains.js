export function domainDnsStatus(result) {
  const labels = {
    ok: "DNS ถูกต้อง",
    proxied: "DNS ผ่าน Cloudflare",
    mismatch: "DNS ยังไม่ตรง",
    unresolved: "ยังไม่พบ DNS",
    error: "ตรวจ DNS ไม่สำเร็จ",
    checking: "กำลังตรวจ DNS",
  };
  return labels[result?.status] || "รอตรวจ DNS";
}
export function domainProxyStatus(result) {
  return result?.proxy?.detected || result?.status === "proxied"
    ? "Proxy: เปิด (Cloudflare)"
    : result?.resolved?.length
      ? "Proxy: ไม่พบ Cloudflare"
      : "Proxy: ยังตรวจไม่ได้";
}
export function domainReadiness(dns, edge) {
  if (["mismatch", "unresolved", "error"].includes(dns?.status))
    return { label: "Invalid Configuration", variant: "needs" };
  return edge?.passed &&
    edge?.tls?.status === "valid" &&
    ["ok", "proxied"].includes(dns?.status)
    ? { label: "Valid Configuration", variant: "ready" }
    : { label: "Pending Verification", variant: "muted" };
}
export function domainDnsRecords(hostname, result) {
  const addresses = result?.expected || [];
  const hasIPv4 = addresses.some((x) => !x.includes(":"));
  return addresses.map((value) => ({
    type: value.includes(":") ? "AAAA" : "A",
    name: hostname,
    value,
    optional: hasIPv4 && value.includes(":"),
  }));
}
export const MAX_DOMAINS = 10;
// One sentence on what to do next, for the DNS status of a domain.
export function domainDetail(result) {
  if (result?.status === "proxied")
    return "ตรวจพบ Cloudflare Proxy เปิดอยู่ สามารถกด Verify และออก TLS โดยเปิด Proxy ไว้ได้ เนื่องจาก Proxy ซ่อน IP ปลายทาง ให้ตรวจว่า Origin ใน Cloudflare ชี้มาที่ IP ด้านล่าง";
  if (result?.status === "ok")
    return "DNS ชี้มาที่ host นี้แล้ว กด Verify เพื่อเปิดใช้งาน Nginx และ TLS";
  if (result?.status === "unresolved")
    return "ยังไม่พบ DNS record ตั้งค่าตามตารางแล้วกด Verify อีกครั้ง การกระจาย DNS อาจใช้เวลา";
  if (result?.status === "mismatch")
    return "DNS ปัจจุบันยังไม่ตรงกับ host นี้ เปลี่ยนค่า record ตามตารางแล้วกด Verify อีกครั้ง";
  return result?.detail || "เพิ่มโดเมนแล้ว กำลังตรวจ DNS และ TLS";
}
// TLS is the origin's own certificate, apart from what a CDN shows visitors.
export function domainTls(edge) {
  const tls = edge?.tls;
  if (tls?.status === "valid") return { text: "TLS: พร้อม", ready: true };
  if (edge?.status === "not-loaded") return { text: "TLS: รอ Verify", ready: false };
  if (tls?.status === "invalid")
    return { text: "TLS: certificate ไม่ผ่าน", ready: false };
  if (tls?.status === "unreachable")
    return { text: "TLS: ต่อ origin ไม่ได้", ready: false };
  if (edge?.status === "checking")
    return { text: "TLS: กำลังตรวจ", ready: false };
  return { text: "TLS: ยังไม่พร้อม", ready: false };
}
export function domainError(error) {
  if (error.message === "Enter a valid DNS hostname.")
    return new Error("กรอก hostname เช่น api.example.com โดยไม่ใส่ https:// หรือ path");
  if (/failed to fetch|networkerror/i.test(error.message))
    return new Error("เชื่อมต่อ Portal ไม่สำเร็จ ลอง Refresh เพื่อตรวจว่ารายการถูกบันทึกแล้วหรือไม่");
  return error;
}
// A domain removal that the host refused: the saved list no longer holds a
// host that Nginx still serves, so cleanup can be retried explicitly.
export function needsCleanup(domains) {
  const saved = domains?.hosts || [];
  return (
    !!domains?.syncError &&
    (domains?.activeHosts || []).some((host) => !saved.includes(host))
  );
}
