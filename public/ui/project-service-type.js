export const workerRuntimes = ['node', 'bun', 'go', 'python'];
export const isWorkerProject = (project) => project?.serviceType === 'worker';
export function serviceFields(project) {
  return isWorkerProject(project)
    ? { serviceType: 'worker', port: null, autoPort: false, healthCheckEnabled: false, healthCheckPath: '/' }
    : { serviceType: 'web' };
}
export function serviceRuntimeError(project) {
  if (!isWorkerProject(project)) return '';
  if (!workerRuntimes.includes(project.runtime || 'node')) return 'Worker รองรับ Node.js, Bun, Go และ Python เท่านั้น เลือก runtime ที่รองรับ หรือเปลี่ยนประเภทเป็น Web';
  if (project.runtime === 'python' && (project.pythonMode || 'script') !== 'script') return 'Python Worker ต้องใช้ Run type: script เพื่อรันงานเบื้องหลัง';
  return '';
}
