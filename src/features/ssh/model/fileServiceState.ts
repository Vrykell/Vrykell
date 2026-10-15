import { t } from '@i18n';

export interface FileServiceFailure {
  kind: 'unavailable' | 'authentication' | 'error';
  title: string;
  message: string;
}

/** Authentication errors apply to every service using the saved SSH profile. */
export function isSshAuthenticationFailure(detail: string): boolean {
  return /SSH_AUTH_FAILED:|认证失败|用户名不能为空|SFTP_AUTH_REQUIRED:|\[Session\(-18\)\]|Authentication failed \(username\/password\)|Username\/PublicKey combination invalid/.test(detail);
}

/** Classify only explicit capability failures; transport and directory errors remain distinct. */
export function describeFileServiceFailure(detail: string): FileServiceFailure {
  if (detail.startsWith('SFTP_UNAVAILABLE:') || detail.startsWith('打开 SFTP 失败：')) {
    return { kind: 'unavailable', title: t('File browsing is unavailable for this connection'),
      message: t('The server does not provide or has rejected SFTP. You can continue using the terminal.') };
  }
  if (detail.startsWith('SFTP_TRANSPORT_UNAVAILABLE:') || /Unable to exchange encryption keys/i.test(detail)) {
    return { kind: 'unavailable', title: t('File browsing is unavailable for this connection'),
      message: t('The file client could not establish a channel with the server. File browsing uses a separate SFTP connection; you can continue using the terminal.') };
  }
  if (detail.includes('文件管理暂不支持跳板机')) {
    return { kind: 'unavailable', title: t('File browsing is unavailable for this connection'), message: t('File browsing does not yet support jump hosts. Continue using the interactive terminal.') };
  }
  if (isSshAuthenticationFailure(detail)) {
    return { kind: 'authentication', title: t('Saved SSH authentication failed'),
      message: t('Authenticate these services with the working server password or private key passphrase. The terminal session stays connected.') };
  }
  return { kind: 'error', title: t('Could not read remote files'),
    message: t('Check the network, directory permissions or trusted host key and retry. File connection failures do not change the terminal session.') };
}
