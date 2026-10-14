import { request } from '../api/request';

export type DeviceSession = { device: { id: string; name: string } };

export function checkDeviceSession() {
  return request<DeviceSession>('/device/session');
}

export function pairDevice(code: string, name: string) {
  return request<DeviceSession>('/device/pair', { method: 'POST', body: JSON.stringify({ code, name }) });
}
