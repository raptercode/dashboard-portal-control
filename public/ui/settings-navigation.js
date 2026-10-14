export const SETTINGS_SECTIONS = {
  account: { title: 'บัญชีและความปลอดภัย', description: 'จัดการรหัสผ่านของบัญชีที่กำลังใช้งาน' },
  updates: { title: 'ระบบและการอัปเดต', description: 'ตรวจสอบเวอร์ชัน Portal โหมดการทำงาน และขั้นตอนอัปเดตบน host' },
  monitor: { title: 'เชื่อมต่อระบบภายนอก', description: 'จัดการ token สำหรับอ่านสถานะ deploy ของแต่ละโปรเจค' }
};

export function settingsSection(search, master, pathname = '/settings') {
  const requested = pathname.startsWith('/settings/') ? pathname.slice('/settings/'.length) : new URLSearchParams(search).get('section');
  return master && Object.hasOwn(SETTINGS_SECTIONS, requested) ? requested : 'account';
}
