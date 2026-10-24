import zh from '@i18n/zh';

const catalog: { messages: typeof zh } = import.meta.hot?.data?.catalog ?? { messages: zh };
catalog.messages = zh;
if (import.meta.hot) {
  if (import.meta.hot.data) import.meta.hot.data.catalog = catalog;
  import.meta.hot.accept();
}

function format(message: string, values: readonly unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (placeholder: string, index: string) => Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

/** Route embedded control messages through the same catalog as the surrounding application. */
export function localize(_key: unknown, message: string, ...values: unknown[]): string {
  const translated = catalog.messages[message];
  return format(typeof translated === 'string' ? translated : message, values);
}

export function localize2(key: unknown, message: string, ...values: unknown[]) {
  return { value: localize(key, message, ...values), original: format(message, values) };
}

export const getNLSLanguage = () => 'zh-cn';
export const getNLSMessages = () => undefined;
