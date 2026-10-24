import { invoke } from '@platform/diagnostics';

export interface ProxyProfile { id: string; name: string; kind: 'http' | 'socks5'; host: string; port: number; username: string; password?: string; hasPassword?: boolean }
export interface ProxyConfiguration { profiles: ProxyProfile[]; defaultId: string | null }
export const getProxies = async () => await invoke<ProxyConfiguration | null>('ssh_proxy_configuration') ?? { profiles: [], defaultId: null };
export const saveProxy = (profile: ProxyProfile) => invoke<void>('ssh_proxy_save', { profile });
export const deleteProxy = (id: string) => invoke<void>('ssh_proxy_delete', { id });
export const setDefaultProxy = (id: string | null) => invoke<void>('ssh_proxy_set_default', { id });
