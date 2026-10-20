import zh from '@i18n/zh';

function format(message: string, values: readonly unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (placeholder: string, index: string) => Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

/** Route embedded control messages through the same catalog as the surrounding application. */
export function localize(_key: unknown, message: string, ...values: unknown[]): string {
  const translated = zh[message];
  return format(typeof translated === 'string' ? translated : message, values);
}

export function localize2(key: unknown, message: string, ...values: unknown[]) {
  return { value: localize(key, message, ...values), original: format(message, values) };
}

export const getNLSLanguage = () => 'zh-cn';
export const getNLSMessages = () => undefined;
