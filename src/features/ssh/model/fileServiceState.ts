export interface FileServiceFailure {
  kind: 'unavailable' | 'authentication' | 'error';
  title: string;
  message: string;
}

/** Classify only explicit capability failures; transport and directory errors remain distinct. */
export function describeFileServiceFailure(detail: string): FileServiceFailure {
  if (detail.startsWith('SFTP_UNAVAILABLE:') || detail.startsWith('打开 SFTP 失败：')) {
    return { kind: 'unavailable', title: '此连接暂不能浏览文件',
      message: '服务器未提供或拒绝了 SFTP 文件服务。你仍可以继续在终端中操作。' };
  }
  if (detail.startsWith('SFTP_TRANSPORT_UNAVAILABLE:') || /Unable to exchange encryption keys/i.test(detail)) {
    return { kind: 'unavailable', title: '此连接暂不能浏览文件',
      message: '当前文件客户端无法与服务器建立文件通道。文件浏览使用独立的 SFTP 连接，你可以继续在终端中操作。' };
  }
  if (detail.includes('文件管理暂不支持跳板机')) {
    return { kind: 'unavailable', title: '此连接暂不能浏览文件', message: '文件浏览暂不支持跳板机连接。请继续使用交互终端。' };
  }
  if (/认证失败|用户名不能为空|SFTP_AUTH_REQUIRED:/.test(detail)) {
    return { kind: 'authentication', title: '文件服务需要单独认证',
      message: '终端里输入的密码不会自动用于文件连接。请在 SSH 连接配置中检查账户、密码或私钥，然后重试。' };
  }
  return { kind: 'error', title: '暂时无法读取远程文件',
    message: '请检查网络、目录权限或主机信任记录后重试。文件连接的状态不会改变终端会话。' };
}
