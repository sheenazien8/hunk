import {
  ElicitationPropertySchema,
  ElicitationSchema,
  type ElicitationContentValue,
  type EnumOption,
  type MultiSelectItems,
} from "@agentclientprotocol/sdk"

export const CUSTOM_ANSWER_META = "_askUserQuestionCustomAnswer"

export type QuestionFieldType = "single" | "multi" | "boolean" | "number" | "integer" | "text"

export interface QuestionOption {
  value: string
  title: string
  description?: string
}

export interface QuestionField {
  key: string
  type: QuestionFieldType
  title?: string
  description?: string
  options: QuestionOption[]
  min?: number
  max?: number
  custom?: boolean
  customKey?: string
}

export interface QuestionItem {
  kind: "question"
  id: string
  elicitId: string
  message: string
  fields: QuestionField[]
  status: "pending" | "answered" | "skipped" | "cancelled"
  content: Record<string, ElicitationContentValue> | null
}

export function parseElicitationSchema(schema: ElicitationSchema): QuestionField[] {
  const properties = schema.properties ?? {}
  const keys = Object.keys(properties).slice(0, 50)
  const fields: QuestionField[] = []
  const customMap = new Map<string, string>()
  for (const key of keys) {
    const prop = properties[key]
    if (ElicitationPropertySchema.isString(prop) || ElicitationPropertySchema.isArray(prop)) {
      const meta = readCustomMeta(prop)
      if (meta?.isCustomAnswer && meta.questionId) {
        customMap.set(meta.questionId, key)
      }
    }
  }
  for (const key of keys) {
    const field = fieldFromProperty(key, properties[key])
    if (field) {
      if (customMap.has(key)) field.customKey = customMap.get(key)
      fields.push(field)
    }
  }
  return fields.filter(f => !f.custom)
}

function readCustomMeta(prop: ElicitationPropertySchema): { isCustomAnswer?: boolean; questionId?: string } | undefined {
  const meta = (prop as { _meta?: { [key: string]: unknown } | null })._meta?.[CUSTOM_ANSWER_META]
  if (meta && typeof meta === "object") {
    return {
      isCustomAnswer: (meta as { isCustomAnswer?: boolean }).isCustomAnswer,
      questionId: (meta as { questionId?: string }).questionId,
    }
  }
  return undefined
}

function optionsFromProperty(prop: Extract<ElicitationPropertySchema, { type: "string" | "array" }>): QuestionOption[] {
  if (ElicitationPropertySchema.isString(prop)) {
    if (prop.oneOf) return prop.oneOf.map(enumOption).filter(o => o.value != null).slice(0, 100)
    if (prop.enum) return prop.enum.map(v => ({ value: v, title: v })).slice(0, 100)
  }
  if (ElicitationPropertySchema.isArray(prop)) {
    const items = prop.items
    if (isStringEnumItems(items)) return items.enum.map(v => ({ value: v, title: v })).slice(0, 100)
    if (isTitledItems(items)) return items.anyOf.map(enumOption).filter(o => o.value != null).slice(0, 100)
  }
  return []
}

function enumOption(o: EnumOption): QuestionOption {
  return { value: o.const, title: o.title, description: o.description ?? undefined }
}

function isStringEnumItems(items: MultiSelectItems): items is { type: "string"; enum: string[] } {
  return typeof items === "object" && (items as { type?: string }).type === "string" && Array.isArray((items as { enum?: unknown }).enum)
}

function isTitledItems(items: MultiSelectItems): items is { anyOf: EnumOption[] } {
  return typeof items === "object" && Array.isArray((items as { anyOf?: unknown }).anyOf)
}

function fieldFromProperty(key: string, prop: ElicitationPropertySchema): QuestionField | null {
  if (!prop) return null
  const meta = readCustomMeta(prop)
  const custom = meta?.isCustomAnswer === true
  if (ElicitationPropertySchema.isString(prop)) {
    const options = optionsFromProperty(prop)
    if (options.length > 0) {
      return { key, type: "single", title: stringOrUndefined(prop.title), description: stringOrUndefined(prop.description), options, min: numberOrUndefined(prop.minLength), max: numberOrUndefined(prop.maxLength), custom }
    }
    return { key, type: "text", title: stringOrUndefined(prop.title), description: stringOrUndefined(prop.description), options: [], min: numberOrUndefined(prop.minLength), max: numberOrUndefined(prop.maxLength), custom }
  }
  if (ElicitationPropertySchema.isBoolean(prop)) {
    return { key, type: "boolean", title: stringOrUndefined(prop.title), description: stringOrUndefined(prop.description), options: [], custom }
  }
  if (ElicitationPropertySchema.isNumber(prop) || ElicitationPropertySchema.isInteger(prop)) {
    return { key, type: prop.type, title: stringOrUndefined(prop.title), description: stringOrUndefined(prop.description), options: [], min: numberOrUndefined(prop.minimum), max: numberOrUndefined(prop.maximum), custom }
  }
  if (ElicitationPropertySchema.isArray(prop)) {
    const options = optionsFromProperty(prop)
    if (options.length > 0) {
      return { key, type: "multi", title: stringOrUndefined(prop.title), description: stringOrUndefined(prop.description), options, min: numberOrUndefined(prop.minItems), max: numberOrUndefined(prop.maxItems), custom }
    }
  }
  return null
}

function stringOrUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined
}

export function summarizeAnswer(field: QuestionField, content: Record<string, ElicitationContentValue>): string | null {
  const value = content[field.key]
  if (value === undefined || value === null) return null
  if (field.type === "boolean") return value ? "Yes" : "No"
  if (field.type === "single") {
    const customKey = field.customKey
    const custom = customKey ? String(content[customKey] ?? "") : ""
    return custom || String(value)
  }
  if (field.type === "multi") {
    const arr = Array.isArray(value) ? value : [String(value)]
    const customKey = field.customKey
    const custom = customKey ? String(content[customKey] ?? "") : ""
    const all = custom ? [...arr, custom] : arr
    return all.join(", ")
  }
  if (field.type === "number" || field.type === "integer") return String(value)
  return String(value)
}
