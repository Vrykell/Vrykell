import { t } from '@i18n';
import type { AcpQuestion, AcpQuestionField } from '@platform/api/acp';

export interface HarnessQuestionGroup { field: AcpQuestionField; other?: AcpQuestionField }
const generatedLabels = new Map([
  ['questions', 'Questions'], ['question', 'Question'], ['other', 'Other'], ['type your own answer', 'Type your own answer'],
]);

/** Pair only explicit companion fields; wire keys and validation remain owned by the protocol. */
export function harnessQuestionGroups(fields: AcpQuestionField[]): HarnessQuestionGroup[] {
  const companions = new Set<string>();
  const pairs = new Map<string, AcpQuestionField>();
  for (const field of fields.filter(entry => entry.options.length > 0)) {
    const candidates = fields.filter(entry => entry !== field && !companions.has(entry.key) && entry.kind === 'string' && !entry.options.length
      && entry.title.toLowerCase() === `${field.title} (other)`.toLowerCase());
    const keyed = candidates.find(entry => entry.key === `${field.key}_other`);
    const uniqueTitle = fields.filter(entry => entry.options.length > 0 && entry.title.toLowerCase() === field.title.toLowerCase()).length === 1;
    const other = keyed ?? (uniqueTitle && candidates.length === 1 && candidates[0].description.trim().toLowerCase() === 'type your own answer' ? candidates[0] : undefined);
    if (other) { companions.add(other.key); pairs.set(field.key, other); }
  }
  return fields.filter(field => !companions.has(field.key)).map(field => ({ field, other: pairs.get(field.key) }));
}

export function questionLabel(value: string): string {
  const label = generatedLabels.get(value.trim().toLowerCase());
  if (label) return t(label);
  const companion = /^(.*)\s+\(other\)$/i.exec(value);
  if (companion) return `${companion[1]} (${t('Other answer')})`;
  return value;
}

export function questionPrompt(form: AcpQuestion['form'], group: HarnessQuestionGroup, single: boolean): string {
  const generic = /^(questions?|type your own answer)$/i;
  const message = form.message.trim();
  const description = group.field.description.trim();
  return questionLabel(description && !generic.test(description) ? description
    : single && message && !generic.test(message) ? message : group.field.title || group.field.key);
}
